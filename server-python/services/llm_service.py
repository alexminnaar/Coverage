from __future__ import annotations

import os
import json
import re
import logging
import sys
import asyncio
from typing import AsyncGenerator, Optional, List, Dict, Any
from dataclasses import dataclass, field
from openai import AsyncOpenAI
from dotenv import load_dotenv
from pydantic_ai import Agent, RunContext
from pydantic_ai.messages import ModelMessage
from pydantic_graph import End
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
)
from services.db_service import DBService
from services.edit_types import ChatDeps, EditGraphDeps, EditGraphState, EditResponse
from services.edit_graph import build_edit_graph
from services.edit_loop import EditLoopState, run_edit_loop
from services.streaming import format_buffer_item, format_final_payload

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

    async def _ensure_db_pool(self):
        """Ensure PostgreSQL connection pool is initialized"""
        await self.db.ensure_pool()
        self.db_pool = self.db.pool

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

        # Build the graph
        self._build_edit_graph()

    def _build_edit_graph(self):
        """Build the edit graph with 8 sequential nodes using stable API"""
        graph, plan_node_cls = build_edit_graph(self)
        self.edit_graph = graph
        self._PlanIntentNode = plan_node_cls

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
        mode: str = 'ask',
        project_id: Optional[str] = None,
        stream_events: Optional[bool] = None,
        selected_element_id: Optional[str] = None,
        selected_text: Optional[str] = None,
        context_policy: Optional[str] = None,
        context_element_ids: Optional[List[str]] = None,
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

        # For edit mode, prefer the explicit loop (Cursor-like) unless explicitly disabled.
        if mode == 'edit':
            # Default typed events for edit mode unless client explicitly opts out.
            effective_stream_events = True if stream_events is None else bool(stream_events)
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
                    )

                    # Stream events incrementally from the loop via an async queue.
                    queue: "asyncio.Queue[dict]" = asyncio.Queue()

                    async def emit(evt: dict) -> None:
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
                    # Fall back to graph if loop fails
                    logger.exception(f"[edit_loop] error: {loop_error}")
                    yield f"Edit loop error: {str(loop_error)}. Falling back to edit graph."
                else:
                    return

        # For edit mode, use graph-based approach (fallback path)
        if mode == 'edit' and hasattr(self, 'edit_graph'):
            try:
                # Create graph state and dependencies
                graph_state = EditGraphState(
                    user_prompt=user_prompt,
                    scene_context=scene_context or '',
                    message_history=message_history
                )
                # Ensure DB pool is initialized before creating deps
                await self._ensure_db_pool()
                logger.info(f'[stream_chat] Initializing graph: project_id={project_id}, db_pool={bool(self.db_pool)}')
                
                graph_deps = EditGraphDeps(
                    scene_context=scene_context or '',
                    message_history=message_history,
                    project_id=project_id,
                    db_pool=self.db_pool
                )

                # Start with first node (PlanIntentNode)
                start_node = self._PlanIntentNode(self)

                # Default typed events for edit mode unless client explicitly opts out.
                effective_stream_events = True if stream_events is None else bool(stream_events)

                # Iterate through graph nodes and stream intermediate results
                # Use graph.iter() to get step-by-step execution
                end_node_handled = False  # Track if we've already handled the End node
                async with self.edit_graph.iter(start_node, state=graph_state, deps=graph_deps) as run:
                    async for node in run:
                        # Stream intermediate results from state buffer as steps complete
                        if effective_stream_events:
                            while graph_state.stream_buffer:
                                buffer_item = graph_state.stream_buffer.pop(0)
                                rendered = format_buffer_item(buffer_item, True)
                                if rendered:
                                    yield rendered
                        else:
                            # Legacy behavior: emit progress as plain text (so UI can display it),
                            # but avoid streaming multiple JSON objects which breaks legacy JSON parsing.
                            while graph_state.stream_buffer:
                                buffer_item = graph_state.stream_buffer.pop(0)
                                rendered = format_buffer_item(buffer_item, False)
                                if rendered:
                                    yield rendered
                        
                        # Check if we've reached the end
                        from pydantic_graph import End
                        if isinstance(node, End):
                            end_node_handled = True  # Mark that we've handled the End node
                            
                            # Stream any remaining buffer items (intermediate status messages) first
                            if effective_stream_events:
                                while graph_state.stream_buffer:
                                    buffer_item = graph_state.stream_buffer.pop(0)
                                    rendered = format_buffer_item(buffer_item, True)
                                    if rendered:
                                        yield rendered
                            else:
                                while graph_state.stream_buffer:
                                    buffer_item = graph_state.stream_buffer.pop(0)
                                    rendered = format_buffer_item(buffer_item, False)
                                    if rendered:
                                        yield rendered
                            
                            # Stream final output - prioritize applied_edits
                            # Use typed event format for final output
                            if graph_state.applied_edits:
                                _edits = graph_state.applied_edits.get('edits', []) if isinstance(graph_state.applied_edits, dict) else []
                                logger.info(
                                    f"[EditGraph] Streaming final edits ({len(_edits) if isinstance(_edits, list) else 0} edits)"
                                )

                                yield format_final_payload(graph_state.applied_edits, effective_stream_events)
                            elif graph_state.final_summary:
                                # If no edits but we have a summary, check if summary contains JSON
                                json_match = re.search(r'\{[\s\S]*"edits"[\s\S]*?\}', graph_state.final_summary, re.DOTALL)
                                if json_match:
                                    yield json_match.group(0)
                                else:
                                    yield graph_state.final_summary
                            elif node.data:
                                # Try to parse node.data - might be JSON string
                                try:
                                    data_str = str(node.data)
                                    # Check if it's already JSON
                                    if data_str.strip().startswith('{'):
                                        # Validate it's valid JSON
                                        parsed = json.loads(data_str)
                                        yield json.dumps(parsed, indent=2)
                                    else:
                                        yield data_str
                                except json.JSONDecodeError:
                                    yield str(node.data)
                                except:
                                    yield str(node.data)
                            else:
                                yield "No edits generated"
                            break
                    
                    # Final check: ONLY if we didn't hit End node but have edits, stream them
                    # This is a safety net in case End node wasn't properly detected
                    if not end_node_handled and graph_state.applied_edits:
                        logger.info("[EditGraph] Safety check - streaming edits (End node not detected)")
                        yield format_final_payload(graph_state.applied_edits, effective_stream_events)
                    elif not end_node_handled and graph_state.final_summary:
                        # Stream summary as status event
                        yield json.dumps({"type": "status", "message": graph_state.final_summary})
            except Exception as graph_error:
                # If graph execution fails, fall back to simple agent
                yield f"Graph error: {str(graph_error)}. Falling back to simple edit agent."
                # Fall through to simple agent approach below
                pass
            except Exception as e:
                yield f"Error: {str(e)}"
            return

        # For ask mode, use existing agent-based approach
        # Create dependencies
        deps = ChatDeps(
            scene_context=scene_context or '',
            mode=mode
        )

        # Select agent based on mode
        agent = self.ask_agent

        try:
            async with agent.run_stream(user_prompt, deps=deps, message_history=message_history if message_history else None) as result:
                # Use delta=True to send only new text portions (not full progressive text)
                async for text in result.stream_text(delta=True):
                    yield text
        except Exception as e:
            # Fallback: yield error as text
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
