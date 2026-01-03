from __future__ import annotations

import os
import json
import re
import logging
import sys
import asyncio
import time
from typing import AsyncGenerator, Optional, List, Dict, Any
from dataclasses import dataclass, field
from openai import AsyncOpenAI
from dotenv import load_dotenv
from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import ModelMessage
import asyncpg

from services.prompts import (
    COMPLETION_SYSTEM_PROMPT,
    CHAT_SYSTEM_PROMPT,
    EDIT_MODE_SYSTEM_PROMPT,
    COMMAND_SYSTEM_PROMPT,
    PLAN_INTENT_PROMPT,
    EXTRACT_SEARCH_TERMS_PROMPT,
    LOCATE_SCENES_PROMPT,
    LOAD_CONTEXT_PROMPT,
    SYNTHESIZE_PROMPT,
    PROPOSE_EDITS_PROMPT,
    APPLY_EDITS_PROMPT,
    VERIFY_PROMPT,
    SUMMARIZE_PROMPT,
    ASK_QUERY_VARIANTS_PROMPT,
    ASK_RERANK_PROMPT,
    ASK_GROUNDING_CHECK_PROMPT,
    ASK_PLAN_PROMPT,
    EDIT_VERIFY_STRUCTURED_PROMPT,
    EDIT_REVISE_EDITS_PROMPT,
)
from services.db_service import DBService
from services.edit_types import (
    ChatDeps,
    EditGraphDeps,
    EditResponse,
    AskPlanResponse,
    AskRerankResponse,
    AskGroundingResponse,
    PlanIntentResponse,
)
from services.edit_loop import EditLoopState, run_edit_loop
from services.ask_loop import AskLoopState, run_ask_loop
from services.streaming import format_buffer_item, format_final_payload
from services.embedding_service import EmbeddingService, EmbeddingConfig
from services.observability.langfuse_client import LangfuseCtx, langfuse_client

# Configure logging to stdout with immediate flushing
logging.basicConfig(
    level=logging.INFO,
    format='%(message)s',
    stream=sys.stdout,
    force=True
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()


class LLMService:
    def __init__(self):
        api_key = os.getenv('OPENAI_API_KEY')
        if api_key and api_key != 'sk-your-key-here':
            self.openai = AsyncOpenAI(api_key=api_key)
            self._init_agents()
        else:
            self.openai = None
            self.ask_agent = None
            self.edit_agent = None
        
        # DB access wrapper (pool is created on first use)
        self.db = DBService()
        self.db_pool: Optional[asyncpg.Pool] = None  # kept for compatibility with existing deps

        self.embedding_service: Optional[EmbeddingService] = None
        if self.openai is not None:
            self.embedding_service = EmbeddingService(openai=self.openai, db=self.db, config=EmbeddingConfig())
        # Track on-demand embedding backfills so we don't schedule duplicates.
        self._embed_backfill_inflight: set[str] = set()
        self._embed_backfill_last_started: Dict[str, float] = {}

    async def _maybe_trigger_embed_backfill(self, project_id: str) -> None:
        """Kick off a background embedding backfill when embeddings are missing or stale."""
        if not self.embedding_service:
            return
        auto = os.getenv("EMBED_AUTO_ON_DEMAND", "1").strip().lower() not in ("0", "false", "no", "off")
        if not auto:
            return
        if not project_id:
            return
        # Guard against duplicates.
        if project_id in self._embed_backfill_inflight:
            return
        # Cooldown to avoid thrashing on repeated requests.
        min_interval_s = int(os.getenv("EMBED_AUTO_MIN_INTERVAL_SECONDS", "60"))
        now = time.time()
        last = float(self._embed_backfill_last_started.get(project_id) or 0.0)
        if (now - last) < min_interval_s:
            return

        # Check whether embeddings exist and whether they're stale vs the project.
        # Staleness heuristics:
        # - embeddings_count == 0: never embedded
        # - embeddings_count < element_count: incomplete
        # - max_embedding_updated_at < projects.updated_at - grace: likely stale
        grace_s = int(os.getenv("EMBED_STALE_GRACE_SECONDS", "5"))
        try:
            stats = await self.embedding_service.get_project_embedding_stats(project_id)
        except Exception:
            stats = {"count": 0, "max_updated_at": None}
        emb_count = int(stats.get("count") or 0)
        emb_max_iso = stats.get("max_updated_at")

        try:
            await self._ensure_db_pool()
            if not self.db_pool:
                return
            row = await self.db_pool.fetchrow(
                "SELECT updated_at, jsonb_array_length(data->'elements')::int AS n_elements FROM projects WHERE id = $1::uuid",
                project_id,
            )
        except Exception:
            row = None

        n_elements = int(row.get("n_elements") or 0) if row else 0
        proj_updated_at = row.get("updated_at") if row else None

        stale = False
        if emb_count <= 0:
            stale = True
        elif n_elements and emb_count < n_elements:
            stale = True
        elif proj_updated_at and emb_max_iso:
            try:
                from datetime import datetime, timezone

                emb_max_dt = datetime.fromisoformat(str(emb_max_iso).replace("Z", "+00:00"))
                if emb_max_dt.tzinfo is None:
                    emb_max_dt = emb_max_dt.replace(tzinfo=timezone.utc)
                # proj_updated_at is already a datetime from asyncpg (tz-aware)
                if (proj_updated_at - emb_max_dt).total_seconds() > grace_s:
                    stale = True
            except Exception:
                pass

        if not stale:
            return

        self._embed_backfill_inflight.add(project_id)
        self._embed_backfill_last_started[project_id] = now

        async def _run() -> None:
            try:
                logger.info(f"[Embeddings] On-demand backfill starting project_id={project_id}")
                await self.embed_project_elements(project_id)
                logger.info(f"[Embeddings] On-demand backfill done project_id={project_id}")
            except Exception as e:
                logger.warning(f"[Embeddings] On-demand backfill failed project_id={project_id}: {type(e).__name__}: {e}")
            finally:
                self._embed_backfill_inflight.discard(project_id)

        try:
            asyncio.create_task(_run())
        except Exception:
            # If we can't schedule, just drop it; request can still proceed without embeddings.
            self._embed_backfill_inflight.discard(project_id)

    async def _ensure_db_pool(self):
        """Ensure PostgreSQL connection pool is initialized"""
        await self.db.ensure_pool()
        self.db_pool = self.db.pool

    async def embed_project_elements(
        self,
        project_id: str,
        *,
        element_types: Optional[List[str]] = None,
        limit: Optional[int] = None,
    ) -> Dict[str, int]:
        """Compute and upsert embeddings for a project (best-effort)."""
        if not self.embedding_service:
            return {"total": 0, "embedded": 0, "skipped": 0}
        await self._ensure_db_pool()
        return await self.embedding_service.upsert_project_embeddings(
            project_id, element_types=element_types, limit=limit
        )

    async def vector_search_elements(
        self,
        project_id: str,
        query_text: str,
        *,
        top_k: int = 12,
        element_types: Optional[List[str]] = None,
    ) -> List[str]:
        """Return element IDs ordered by semantic similarity."""
        if not self.embedding_service:
            return []
        await self._ensure_db_pool()
        # If embeddings have never been created for this project, schedule a background backfill.
        # This keeps vec_search from being permanently useless without manual intervention.
        await self._maybe_trigger_embed_backfill(project_id)
        rows = await self.embedding_service.vector_search(
            project_id, query_text, top_k=top_k, element_types=element_types
        )
        return [str(r["element_id"]) for r in rows]

    async def _query_elements_by_search(
        self,
        project_id: str,
        search_terms: List[str],
        element_types: Optional[List[str]] = None
    ) -> List[str]:
        """Find element IDs matching search terms"""
        return await self.db.query_elements_by_search(project_id, search_terms, element_types)

    async def _extract_element_context(
        self,
        project_id: str,
        element_ids: List[str],
        context_size: int = 3
    ) -> tuple:
        """Extract elements with surrounding context from PostgreSQL
        
        Returns:
            tuple: (context_string, error_message)
            - context_string: The formatted context, or empty string if failed
            - error_message: None if successful, error description if failed
        """
        return await self.db.extract_element_context(project_id, element_ids, context_size)

    async def _verify_element_ids(
        self,
        project_id: str,
        element_ids: List[str]
    ) -> Dict[str, bool]:
        """Verify that element IDs exist in the screenplay"""
        return await self.db.verify_element_ids(project_id, element_ids)

    def _init_agents(self):
        """Initialize PydanticAI agents"""
        # Ask mode agent - returns plain text
        self.ask_agent = Agent(
            'openai:gpt-4.1',
            deps_type=ChatDeps,
            system_prompt=CHAT_SYSTEM_PROMPT,
        )

        # Edit mode agent - returns text (JSON format enforced by prompt)
        # Using text output instead of structured output to work with frontend streaming
        self.edit_agent = Agent(
            'openai:gpt-4.1',
            deps_type=ChatDeps,
            system_prompt=EDIT_MODE_SYSTEM_PROMPT,
        )

        # Inject scene context dynamically
        @self.ask_agent.system_prompt
        def inject_ask_context(ctx: RunContext[ChatDeps]) -> str:
            if ctx.deps.scene_context:
                return f"\n\nCurrent screenplay context:\n{ctx.deps.scene_context}"
            return ""

        @self.edit_agent.system_prompt
        def inject_edit_context(ctx: RunContext[ChatDeps]) -> str:
            if ctx.deps.scene_context:
                return f"\n\nCurrent screenplay context:\n{ctx.deps.scene_context}"
            return ""

        # Initialize graph node agents
        self._init_graph_agents()

    def _init_graph_agents(self):
        """Initialize agents for graph nodes"""
        # Node 1: Plan Intent Agent
        self.plan_intent_agent = Agent(
            'openai:gpt-4.1',
            deps_type=EditGraphDeps,
            system_prompt=PLAN_INTENT_PROMPT,
            result_type=PlanIntentResponse,
        )

        # Node 2: Locate Scenes Agent
        self.extract_search_terms_agent = Agent(
            'openai:gpt-4.1',
            deps_type=EditGraphDeps,
            system_prompt=EXTRACT_SEARCH_TERMS_PROMPT,
        )
        
        self.locate_scenes_agent = Agent(
            'openai:gpt-4.1',
            deps_type=EditGraphDeps,
            system_prompt=LOCATE_SCENES_PROMPT,
        )

        @self.locate_scenes_agent.tool
        async def search_screenplay_elements(ctx: RunContext[EditGraphDeps], query: str) -> str:
            """Search the screenplay context for elements matching the query."""
            scene_context = ctx.deps.scene_context
            # Simple text search - can be enhanced with regex or more sophisticated matching
            lines = scene_context.split('\n')
            matches = []
            for i, line in enumerate(lines):
                if query.lower() in line.lower():
                    # Extract surrounding context
                    start = max(0, i - 2)
                    end = min(len(lines), i + 3)
                    context = '\n'.join(lines[start:end])
                    matches.append(f"Line {i+1}: {context}")
            return '\n\n'.join(matches[:10]) if matches else "No matches found"

        # Node 3: Load Context Agent
        self.load_context_agent = Agent(
            'openai:gpt-4.1',
            deps_type=EditGraphDeps,
            system_prompt=LOAD_CONTEXT_PROMPT,
        )

        @self.load_context_agent.tool
        async def extract_element_context(ctx: RunContext[EditGraphDeps], element_ids: List[str]) -> str:
            """Extract context around specific element IDs from the screenplay."""
            scene_context = ctx.deps.scene_context
            # Find elements by ID in context
            import re
            extracted = []
            for element_id in element_ids[:10]:  # Limit to first 10
                # Look for element ID in context
                pattern = f'Element.*ID.*{element_id}'
                match = re.search(pattern, scene_context, re.IGNORECASE)
                if match:
                    # Extract surrounding lines
                    start_pos = match.start()
                    lines_before = scene_context[:start_pos].count('\n')
                    context_lines = scene_context.split('\n')
                    start_idx = max(0, lines_before - 3)
                    end_idx = min(len(context_lines), lines_before + 10)
                    extracted.append('\n'.join(context_lines[start_idx:end_idx]))
            return '\n\n---\n\n'.join(extracted) if extracted else "Elements not found in context"

        # Node 4: Synthesize Agent
        self.synthesize_agent = Agent(
            'openai:gpt-4.1',
            deps_type=EditGraphDeps,
            system_prompt=SYNTHESIZE_PROMPT,
        )

        # Node 5: Propose Edits Agent (with structured output)
        self.propose_edits_agent = Agent(
            'openai:gpt-4.1',
            deps_type=EditGraphDeps,
            system_prompt=PROPOSE_EDITS_PROMPT,
            result_type=EditResponse,
        )

        # Node 6: Refine Edits Agent (with structured output)
        self.refine_edits_agent = Agent(
            'openai:gpt-4.1',
            deps_type=EditGraphDeps,
            system_prompt=APPLY_EDITS_PROMPT,
            result_type=EditResponse,
        )

        @self.refine_edits_agent.tool
        async def validate_edit_format(ctx: RunContext[EditGraphDeps], edits_json: str) -> str:
            """Validate that edit proposals match the required format."""
            try:
                edits = json.loads(edits_json)
                if not isinstance(edits, dict) or 'edits' not in edits:
                    return "Invalid format: missing 'edits' key"
                if not isinstance(edits['edits'], list):
                    return "Invalid format: 'edits' must be a list"
                for edit in edits['edits']:
                    required = ['elementId', 'elementType', 'originalContent', 'newContent']
                    if not all(key in edit for key in required):
                        return f"Invalid format: missing required fields in edit"
                return "Format validation passed"
            except json.JSONDecodeError as e:
                return f"Invalid JSON: {str(e)}"

        # Node 7: Verify Agent
        self.verify_agent = Agent(
            'openai:gpt-4.1',
            deps_type=EditGraphDeps,
            system_prompt=VERIFY_PROMPT,
        )

        @self.verify_agent.tool
        async def check_screenplay_continuity(ctx: RunContext[EditGraphDeps], edits_json: str) -> str:
            """Check screenplay continuity and formatting rules."""
            try:
                edits = json.loads(edits_json)
                issues = []
                scene_context = ctx.deps.scene_context
                
                if 'edits' in edits:
                    for edit in edits['edits']:
                        # Check if element ID exists in context
                        element_id = edit.get('elementId', '')
                        if element_id and element_id not in scene_context:
                            issues.append(f"Element ID {element_id} not found in screenplay")
                        
                        # Check element type validity
                        valid_types = ['action', 'dialogue', 'character', 'scene-heading', 'parenthetical', 'transition']
                        if edit.get('elementType') not in valid_types:
                            issues.append(f"Invalid element type: {edit.get('elementType')}")
                
                if issues:
                    return f"Issues found:\n" + "\n".join(f"- {issue}" for issue in issues)
                return "Continuity check passed - no issues found"
            except json.JSONDecodeError:
                return "Cannot verify: invalid JSON format"

        # Node 8: Summarize Agent
        self.summarize_agent = Agent(
            'openai:gpt-4.1',
            deps_type=EditGraphDeps,
            system_prompt=SUMMARIZE_PROMPT,
        )

        # Ask loop helpers (Cursor-like retrieval + gating)
        self.ask_plan_agent = Agent(
            'openai:gpt-4.1',
            deps_type=EditGraphDeps,
            system_prompt=ASK_PLAN_PROMPT,
            result_type=AskPlanResponse,
        )

        self.ask_query_variants_agent = Agent(
            'openai:gpt-4.1',
            deps_type=EditGraphDeps,
            system_prompt=ASK_QUERY_VARIANTS_PROMPT,
        )

        self.ask_rerank_agent = Agent(
            'openai:gpt-4.1',
            deps_type=EditGraphDeps,
            system_prompt=ASK_RERANK_PROMPT,
            result_type=AskRerankResponse,
        )

        self.ask_grounding_agent = Agent(
            'openai:gpt-4.1',
            deps_type=EditGraphDeps,
            system_prompt=ASK_GROUNDING_CHECK_PROMPT,
            result_type=AskGroundingResponse,
        )

        # Edit loop: structured verification + revise pass
        self.edit_verify_structured_agent = Agent(
            'openai:gpt-4.1',
            deps_type=EditGraphDeps,
            system_prompt=EDIT_VERIFY_STRUCTURED_PROMPT,
        )

        self.edit_revise_edits_agent = Agent(
            'openai:gpt-4.1',
            deps_type=EditGraphDeps,
            system_prompt=EDIT_REVISE_EDITS_PROMPT,
            result_type=EditResponse,
        )

    def is_configured(self) -> bool:
        return self.openai is not None

    def _build_context_string(self, context) -> str:
        """Build context string for the LLM"""
        lines = []

        # Add preceding elements as context (last 8)
        for el in context.precedingElements[-8:]:
            lines.append(f"[{el.type.upper()}] {el.content}")

        # Add current element being written
        lines.append(f"[{context.elementType.upper()}] {context.currentContent}")

        return '\n'.join(lines)

    async def stream_completion(self, context) -> AsyncGenerator[str, None]:
        """Inline completion (streaming) - kept as-is for now"""
        if not self.openai:
            raise ValueError('OpenAI not configured. Add OPENAI_API_KEY to server/.env')

        context_str = self._build_context_string(context)

        stream = await self.openai.chat.completions.create(
            model='gpt-4.1',
            messages=[
                {'role': 'system', 'content': COMPLETION_SYSTEM_PROMPT},
                {
                    'role': 'user',
                    'content': f'Complete this {context.elementType}. Only output the completion text:\n\n{context_str}'
                }
            ],
            max_tokens=150,
            temperature=0.7,
            stream=True,
        )

        async for chunk in stream:
            content = chunk.choices[0].delta.content
            if content:
                yield content

    async def stream_chat(
        self,
        messages: List[dict],
        scene_context: Optional[str] = None,
        global_index: Optional[str] = None,
        mode: str = 'ask',
        project_id: Optional[str] = None,
        stream_events: Optional[bool] = None,
        selected_element_id: Optional[str] = None,
        selected_text: Optional[str] = None,
        context_policy: Optional[str] = None,
        context_element_ids: Optional[List[str]] = None,
        trace_ctx: Optional[LangfuseCtx] = None,
    ) -> AsyncGenerator[str, None]:
        """Chat response (streaming) using PydanticAI.

        Streaming contract (especially important for Docker deployments and backwards compatibility):

        - Ask mode (`mode='ask'`): yields plain text deltas.
        - Edit mode (`mode='edit'`):
          - If `stream_events=True`: yields typed JSON event strings:
            - status events: {"type":"status","message":"..."}
            - final event: {"type":"final","edits":{"edits":[...]}}
          - If `stream_events` is falsy/omitted: yields human-readable status lines as plain text,
            then yields a single final JSON object: {"edits":[...]}.

        The legacy behavior avoids streaming multiple JSON objects (which can break clients that try
        to `JSON.parse` the entire response at once).
        """
        if not self.openai or not self.ask_agent or not self.edit_agent:
            raise ValueError('OpenAI not configured. Add OPENAI_API_KEY to server/.env')

        # Get the last user message
        user_messages = [msg for msg in messages if msg['role'] == 'user']
        if not user_messages:
            return
        
        user_prompt = user_messages[-1]['content']

        # Default typed events for agentic modes unless client explicitly opts out.
        effective_stream_events = True if stream_events is None else bool(stream_events)

        # Build message history from previous messages
        # Convert frontend message format to PydanticAI format
        from pydantic_ai.messages import ModelRequest, ModelResponse, UserPromptPart, TextPart
        
        message_history = []
        i = 0
        while i < len(messages) - 1:  # All except the last user message
            msg = messages[i]
            if msg['role'] == 'user':
                # Collect consecutive user messages into one request
                user_parts = [UserPromptPart(msg['content'])]
                i += 1
                while i < len(messages) - 1 and messages[i]['role'] == 'user':
                    user_parts.append(UserPromptPart(messages[i]['content']))
                    i += 1
                
                # Look for corresponding assistant response
                response_parts = []
                if i < len(messages) - 1 and messages[i]['role'] == 'assistant':
                    response_parts.append(TextPart(messages[i]['content']))
                    i += 1
                    # Collect consecutive assistant messages
                    while i < len(messages) - 1 and messages[i]['role'] == 'assistant':
                        response_parts.append(TextPart(messages[i]['content']))
                        i += 1
                
                # Create ModelRequest
                message_history.append(ModelRequest(parts=user_parts))
                # Create ModelResponse if we have one
                if response_parts:
                    message_history.append(ModelResponse(parts=response_parts))
            else:
                i += 1

        # Ask mode: prefer explicit ask loop (Cursor-like) unless disabled.
        if mode == 'ask':
            use_ask_loop = os.getenv("ASK_LOOP_ENABLED", "1").lower() not in ("0", "false", "no")
            if use_ask_loop:
                try:
                    # Ask loop should work even without DB; only attempt to init DB when a project is provided.
                    if project_id:
                        try:
                            await self._ensure_db_pool()
                        except Exception as db_error:
                            logger.warning(f"[ask_loop] DB unavailable, continuing without DB: {db_error}")
                            self.db_pool = None
                    deps = EditGraphDeps(
                        scene_context=scene_context or '',
                        message_history=message_history,
                        project_id=project_id,
                        db_pool=self.db_pool,
                        global_index=global_index,
                    )

                    queue: "asyncio.Queue[dict]" = asyncio.Queue()
                    # Langfuse: store tool_call inputs until we see tool_result so we can emit a single span
                    # with clear input/output (instead of 2 spans and lots of status noise).
                    _pending_tool_inputs: Dict[str, List[Any]] = {}

                    async def emit(evt: dict) -> None:
                        # Langfuse: only log high-signal steps (tools/decisions) and attach real inputs/outputs.
                        # Avoid logging status/todos as spans; those are useful for the UI but create too much noise in Langfuse.
                        try:
                            if trace_ctx and isinstance(evt, dict) and evt.get("type") in ("decision", "tool_call", "tool_result"):
                                evt_type = str(evt.get("type"))
                                if evt_type == "tool_call":
                                    tool = str(evt.get("tool") or "tool")
                                    inp = evt.get("payload") or evt.get("prompt") or evt.get("query") or evt.get("text") or None
                                    _pending_tool_inputs.setdefault(tool, []).append(inp)
                                elif evt_type == "tool_result":
                                    tool = str(evt.get("tool") or "tool")
                                    pending = _pending_tool_inputs.get(tool) or []
                                    inp = pending.pop(0) if pending else None
                                    _pending_tool_inputs[tool] = pending
                                    # Emit a single span per tool with clear input/output.
                                    langfuse_client.span(
                                        trace_ctx,
                                        name=f"ask.{tool}",
                                        metadata={k: v for k, v in evt.items() if k not in ("message", "payload", "prompt")},
                                        input=inp,
                                        output=evt,
                                    )
                                elif evt_type == "decision":
                                    name = f"decision.{evt.get('action', 'step')}"
                                    langfuse_client.span(
                                        trace_ctx,
                                        name=f"ask.{name}",
                                        metadata={k: v for k, v in evt.items() if k not in ("message",)},
                                        input=None,
                                        output=evt,
                                    )
                        except Exception:
                            pass
                        await queue.put(evt)

                    ask_state = AskLoopState(
                        question=user_prompt,
                        scene_context=scene_context or '',
                        message_history=message_history,
                        selected_element_id=selected_element_id,
                        selected_text=selected_text,
                        context_policy=context_policy or "scene_plus_adjacent",
                        context_element_ids=context_element_ids or [],
                    )

                    loop_task = asyncio.create_task(run_ask_loop(self, state=ask_state, deps=deps, emit=emit))

                    while True:
                        if loop_task.done() and queue.empty():
                            break
                        try:
                            evt = await asyncio.wait_for(queue.get(), timeout=0.1)
                        except asyncio.TimeoutError:
                            continue
                        rendered = format_buffer_item(evt, effective_stream_events)
                        if rendered:
                            yield rendered

                    answer = await loop_task
                    if effective_stream_events:
                        yield json.dumps({"type": "final", "content": answer})
                    else:
                        # Legacy ask: just stream plain text answer (status lines already emitted above).
                        yield answer
                except Exception as ask_error:
                    logger.exception(f"[ask_loop] error: {ask_error}")
                    # Fall back to legacy streaming below
                else:
                    return

        # For edit mode, prefer the explicit loop (Cursor-like) unless explicitly disabled.
        if mode == 'edit':
            # Default typed events for edit mode unless client explicitly opts out.
            use_loop = os.getenv("EDIT_LOOP_ENABLED", "1").lower() not in ("0", "false", "no")

            if use_loop:
                try:
                    # Ensure DB pool is initialized before creating deps
                    await self._ensure_db_pool()
                    logger.info(
                        f'[stream_chat] Using edit_loop: project_id={project_id}, db_pool={bool(self.db_pool)}, stream_events={effective_stream_events}'
                    )

                    deps = EditGraphDeps(
                        scene_context=scene_context or '',
                        message_history=message_history,
                        project_id=project_id,
                        db_pool=self.db_pool,
                        global_index=global_index,
                    )

                    # Stream events incrementally from the loop via an async queue.
                    queue: "asyncio.Queue[dict]" = asyncio.Queue()
                    _pending_tool_inputs: Dict[str, List[Any]] = {}

                    async def emit(evt: dict) -> None:
                        # Langfuse: only log high-signal steps (tools/decisions/apply) and attach real inputs/outputs.
                        # Avoid logging status/todos as spans; those create too much noise.
                        try:
                            if trace_ctx and isinstance(evt, dict) and evt.get("type") in ("decision", "tool_call", "tool_result", "apply_started", "apply_done"):
                                evt_type = str(evt.get("type"))
                                if evt_type == "tool_call":
                                    tool = str(evt.get("tool") or "tool")
                                    inp = evt.get("payload") or evt.get("prompt") or evt.get("query") or evt.get("text") or None
                                    _pending_tool_inputs.setdefault(tool, []).append(inp)
                                elif evt_type == "tool_result":
                                    tool = str(evt.get("tool") or "tool")
                                    pending = _pending_tool_inputs.get(tool) or []
                                    inp = pending.pop(0) if pending else None
                                    _pending_tool_inputs[tool] = pending
                                    langfuse_client.span(
                                        trace_ctx,
                                        name=f"edit.{tool}",
                                        metadata={k: v for k, v in evt.items() if k not in ("message", "payload", "prompt")},
                                        input=inp,
                                        output=evt,
                                    )
                                elif evt_type == "decision":
                                    name = f"decision.{evt.get('action', 'step')}"
                                    langfuse_client.span(
                                        trace_ctx,
                                        name=f"edit.{name}",
                                        metadata={k: v for k, v in evt.items() if k not in ("message",)},
                                        input=None,
                                        output=evt,
                                    )
                                elif evt_type in ("apply_started", "apply_done"):
                                    name = evt_type
                                    langfuse_client.span(
                                        trace_ctx,
                                        name=f"edit.{name}",
                                        metadata={k: v for k, v in evt.items() if k not in ("message",)},
                                        input=None,
                                        output=evt,
                                    )
                        except Exception:
                            pass
                        await queue.put(evt)

                    loop_state = EditLoopState(
                        user_prompt=user_prompt,
                        scene_context=scene_context or '',
                        message_history=message_history,
                        selected_element_id=selected_element_id,
                        selected_text=selected_text,
                        context_policy=context_policy or "scene_plus_adjacent",
                        context_element_ids=context_element_ids or [],
                    )

                    loop_task = asyncio.create_task(run_edit_loop(self, state=loop_state, deps=deps, emit=emit))

                    # Drain queue while the loop runs (Cursor-like incremental updates)
                    while True:
                        if loop_task.done() and queue.empty():
                            break
                        try:
                            evt = await asyncio.wait_for(queue.get(), timeout=0.1)
                        except asyncio.TimeoutError:
                            continue
                        rendered = format_buffer_item(evt, effective_stream_events)
                        if rendered:
                            yield rendered

                    applied_edits = await loop_task
                    yield format_final_payload(applied_edits, effective_stream_events)
                except Exception as loop_error:
                    logger.exception(f"[edit_loop] error: {loop_error}")
                    # Fall back to legacy single-pass edit agent below
                    if effective_stream_events:
                        yield json.dumps(
                            {
                                "type": "status",
                                "message": f"[Error] edit_loop failed; falling back to simple edit agent ({type(loop_error).__name__})",
                            }
                        )
                    else:
                        yield f"[Error] edit_loop failed; falling back to simple edit agent ({type(loop_error).__name__})\n"
                else:
                    return

        # Legacy agent-based approach (used when loops are disabled or fail)
        deps = ChatDeps(scene_context=scene_context or '', mode=mode)

        def _result_text(res: Any) -> str:
            if hasattr(res, "data") and res.data is not None:
                return str(res.data)
            if hasattr(res, "output"):
                return str(res.output)
            if hasattr(res, "text"):
                return str(res.text)
            return str(res)

        if mode == "edit":
            try:
                result = await self.edit_agent.run(
                    user_prompt, deps=deps, message_history=message_history if message_history else None
                )
                text = _result_text(result)
                # Best-effort: extract a JSON object that contains `"edits"`.
                json_candidate = text
                m = re.search(r'\{[\s\S]*"edits"[\s\S]*\}', text, re.DOTALL)
                if m:
                    json_candidate = m.group(0)
                try:
                    applied_edits = json.loads(json_candidate)
                    if not isinstance(applied_edits, dict) or "edits" not in applied_edits:
                        applied_edits = {"edits": []}
                except Exception:
                    applied_edits = {"edits": []}
                yield format_final_payload(applied_edits, effective_stream_events)
            except Exception as e:
                yield f"Error: {str(e)}"
            return

        # Ask mode: stream deltas from ask_agent
        try:
            async with self.ask_agent.run_stream(
                user_prompt, deps=deps, message_history=message_history if message_history else None
            ) as result:
                async for text in result.stream_text(delta=True):
                    yield text
        except Exception as e:
            yield f"Error: {str(e)}"

    async def execute_command(self, request) -> str:
        """Command execution (non-streaming) - kept as-is for now"""
        if not self.openai:
            raise ValueError('OpenAI not configured. Add OPENAI_API_KEY to server/.env')

        context_str = '\n'.join(
            f"[{el.type.upper()}] {el.content}"
            for el in request.context[-5:]
        )

        response = await self.openai.chat.completions.create(
            model='gpt-4.1',
            messages=[
                {'role': 'system', 'content': COMMAND_SYSTEM_PROMPT},
                {
                    'role': 'user',
                    'content': f'Context:\n{context_str}\n\nElement type: {request.elementType}\nCommand: "{request.command}"\nText to transform:\n{request.selectedText}\n\nOutput only the transformed text:'
                }
            ],
            max_tokens=500,
            temperature=0.7,
        )

        return response.choices[0].message.content or request.selectedText


# Singleton instance
llm_service = LLMService()
