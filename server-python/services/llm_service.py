from __future__ import annotations

import os
import json
import re
import logging
import sys
import asyncio
from typing import AsyncGenerator, Optional, List, Dict, Any
from openai import AsyncOpenAI
from dotenv import load_dotenv
import asyncpg

from services.prompts import (
    COMPLETION_SYSTEM_PROMPT,
    CHAT_SYSTEM_PROMPT,
    EDIT_MODE_SYSTEM_PROMPT,
    COMMAND_SYSTEM_PROMPT,
)
from services.db_service import DBService
from services.edit_types import ScreenplayDeps
from services.streaming import format_buffer_item, format_final_payload, run_unified_agent_streaming
from services.screenplay_agent import create_screenplay_agent

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
            self.default_chat_model = os.getenv("AI_DEFAULT_CHAT_MODEL", "gpt-4.1").strip() or "gpt-4.1"
            self._unified_agents: Dict[str, Any] = {}
        else:
            self.openai = None
            self._unified_agents = {}

        # DB access wrapper (pool is created on first use)
        self.db = DBService()
        self.db_pool: Optional[asyncpg.Pool] = None  # kept for compatibility with existing deps

    async def _ensure_db_pool(self):
        """Ensure PostgreSQL connection pool is initialized"""
        await self.db.ensure_pool()
        self.db_pool = self.db.pool

    async def _search_elements(
        self,
        project_id: str,
        search_terms: List[str],
        *,
        match_mode: str = "any",
        element_types: Optional[List[str]] = None,
        limit: int = 25,
    ) -> List[Dict[str, Any]]:
        """Full-text search over screenplay elements."""
        hits = await self.db.search_elements(
            project_id,
            terms=search_terms,
            match_mode=match_mode,
            element_types=element_types,
            limit=limit,
        )
        return [
            {
                "element_id": h.element_id,
                "element_type": h.element_type,
                "element_index": h.element_index,
                "content": h.content,
                "rank": h.rank,
                "snippet": h.snippet,
            }
            for h in hits
        ]

    async def _list_scenes(
        self,
        project_id: str,
        search_terms: Optional[List[str]] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """List scene headings for a project."""
        scenes = await self.db.list_scenes(
            project_id,
            search_terms=search_terms,
            limit=limit,
        )
        return [
            {
                "element_id": s.element_id,
                "element_index": s.element_index,
                "heading": s.heading,
                "scene_number": s.scene_number,
            }
            for s in scenes
        ]

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
        """No-op kept for compatibility."""
        self._unified_agents = {}

    def _to_agent_input(self, messages: List[dict]) -> List[dict]:
        """Convert frontend chat messages to OpenAI Agents SDK input format."""
        input_items: List[dict] = []
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content", "")
            if role in ("user", "assistant") and content is not None:
                input_items.append({"role": role, "content": str(content)})
        return input_items

    def _ensure_unified_agent(self, model: str) -> Any:
        """Return (and lazily create) the unified screenplay agent for a model."""
        model = self._normalize_chat_model(model)
        if model in self._unified_agents:
            return self._unified_agents[model]
        agent = create_screenplay_agent(model)
        self._unified_agents[model] = agent
        return agent

    # --- Model selection helpers (chat) ---
    def _allowed_chat_models(self) -> set[str]:
        # Keep this small and explicit. UI should match this allowlist.
        return {"gpt-4.1", "gpt-5", "gpt-5-mini"}

    def _normalize_chat_model(self, model: Optional[str]) -> str:
        m = str(model or "").strip()
        if m.startswith("openai:"):
            m = m.split("openai:", 1)[1].strip()
        allowed = self._allowed_chat_models()
        if m in allowed:
            return m
        # Fallback to default if invalid/unknown
        if self.default_chat_model in allowed:
            return self.default_chat_model
        return "gpt-4.1"

    async def _stream_chat_fallback(
        self,
        *,
        messages: List[dict],
        scene_context: Optional[str],
        mode: str,
        model: str,
        stream_events: bool,
    ) -> AsyncGenerator[str, None]:
        """Direct OpenAI chat completion fallback when the agent run fails."""
        system_prompt = EDIT_MODE_SYSTEM_PROMPT if mode == "edit" else CHAT_SYSTEM_PROMPT
        if scene_context:
            system_prompt += f"\n\nCurrent screenplay context:\n{scene_context}"

        chat_messages: List[dict] = [{"role": "system", "content": system_prompt}]
        for msg in messages:
            if msg.get("role") in ("user", "assistant"):
                chat_messages.append({"role": msg["role"], "content": msg.get("content", "")})

        if mode == "edit":
            response = await self.openai.chat.completions.create(
                model=model,
                messages=chat_messages,
                temperature=0.7,
            )
            text = response.choices[0].message.content or ""
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
            yield format_final_payload(stream_events, applied_edits=applied_edits)
            return

        stream = await self.openai.chat.completions.create(
            model=model,
            messages=chat_messages,
            temperature=0.7,
            stream=True,
        )
        async for chunk in stream:
            content = chunk.choices[0].delta.content
            if content:
                yield content

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
        model: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """Chat response (streaming) using the OpenAI Agents SDK."""
        if not self.openai:
            raise ValueError('OpenAI not configured. Add OPENAI_API_KEY to server/.env')

        selected_model = self._normalize_chat_model(model)
        effective_stream_events = True if stream_events is None else bool(stream_events)
        agent_input = self._to_agent_input(messages)
        if not agent_input:
            return

        try:
            if project_id:
                try:
                    await self._ensure_db_pool()
                except Exception as db_error:
                    logger.warning(f"[unified_agent] DB unavailable: {db_error}")
                    self.db_pool = None

            ua = self._ensure_unified_agent(selected_model)
            ua_context = ScreenplayDeps(
                scene_context=scene_context or "",
                project_id=project_id,
                db_pool=self.db_pool,
                global_index=global_index,
                selected_element_id=selected_element_id,
                selected_text=selected_text,
            )

            queue: "asyncio.Queue[dict]" = asyncio.Queue()

            async def ua_emit(evt: dict) -> None:
                await queue.put(evt)

            async def _run_ua() -> str:
                return await run_unified_agent_streaming(
                    ua,
                    agent_input,
                    context=ua_context,
                    emit=ua_emit,
                    max_turns=15,
                    trace_metadata={
                        "tags": ["ai-service", "chat", mode],
                        "mode": mode,
                        "model": selected_model,
                        "project_id": project_id or "",
                    },
                )

            ua_task = asyncio.create_task(_run_ua())

            try:
                while True:
                    if ua_task.done() and queue.empty():
                        break
                    try:
                        evt = await asyncio.wait_for(queue.get(), timeout=0.1)
                    except asyncio.TimeoutError:
                        continue
                    rendered = format_buffer_item(evt, effective_stream_events)
                    if rendered:
                        yield rendered

                answer = await ua_task
            except asyncio.CancelledError:
                logger.info("[unified_agent] client disconnected; cancelling agent task")
                ua_task.cancel()
                try:
                    await ua_task
                except asyncio.CancelledError:
                    pass
                raise

            if mode == "edit" and (ua_context._submitted_edits or ua_context._beat_ops):
                yield format_final_payload(
                    effective_stream_events,
                    applied_edits={"edits": ua_context._submitted_edits} if ua_context._submitted_edits else None,
                    beat_ops=ua_context._beat_ops or None,
                )
            else:
                if effective_stream_events:
                    yield json.dumps({"type": "final", "content": answer})
                else:
                    yield answer
            return
        except Exception as ua_error:
            logger.exception(f"[unified_agent] error: {ua_error}")

        async for chunk in self._stream_chat_fallback(
            messages=messages,
            scene_context=scene_context,
            mode=mode,
            model=selected_model,
            stream_events=effective_stream_events,
        ):
            yield chunk

    async def stream_beat_chat(
        self,
        messages: List[dict],
        beats: List[dict],
        act_names: List[str],
        selected_beat_id: Optional[str] = None,
        scenes: Optional[List[dict]] = None,
        project_id: Optional[str] = None,
        model: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """Beat AI chat response (streaming JSON ops only).

        Simplified streaming: yields only the final JSON ops object incrementally.
        No intermediate events, no status messages - just the JSON response.
        """
        if not self.openai:
            raise ValueError('OpenAI not configured. Add OPENAI_API_KEY to server/.env')

        selected_model = self._normalize_chat_model(model)
        agent_input = self._to_agent_input(messages)
        if not agent_input:
            return

        from services.beat_loop_helpers import build_beat_context, BeatLoopState as _BLS

        user_question = next(
            (str(msg.get("content", "")) for msg in reversed(messages) if msg.get("role") == "user"),
            "",
        )

        beat_state = _BLS(
            question=user_question,
            beats=beats,
            act_names=act_names,
            selected_beat_id=selected_beat_id,
            scenes=scenes or [],
        )
        beat_ctx = build_beat_context(beat_state)

        if project_id:
            try:
                await self._ensure_db_pool()
            except Exception:
                self.db_pool = None

        ua = self._ensure_unified_agent(selected_model)
        ua_context = ScreenplayDeps(
            scene_context="",
            project_id=project_id,
            db_pool=self.db_pool if project_id else None,
            beat_context=beat_ctx,
        )

        async def _noop_emit(evt: dict) -> None:
            pass

        try:
            answer = await run_unified_agent_streaming(
                ua,
                agent_input,
                context=ua_context,
                emit=_noop_emit,
                max_turns=10,
                trace_metadata={
                    "tags": ["ai-service", "beat-chat"],
                    "mode": "beat",
                    "model": selected_model,
                    "project_id": project_id or "",
                },
            )

            if ua_context._beat_ops:
                yield json.dumps({"ops": ua_context._beat_ops}, indent=2)
            else:
                yield answer
        except Exception as e:
            error_response = json.dumps({"ops": [], "notes": f"Error: {str(e)}"})
            yield error_response

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
