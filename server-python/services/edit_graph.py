from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Optional, Type

from pydantic_ai import RunContext
from pydantic_graph import BaseNode, End, Graph, GraphRunContext

from services.edit_types import EditGraphDeps, EditGraphState

logger = logging.getLogger(__name__)


def get_result_output(result: Any) -> str:
    """Extract output from PydanticAI agent results across versions."""
    if hasattr(result, "data") and result.data is not None:
        return str(result.data)
    if hasattr(result, "output"):
        return str(result.output)
    if hasattr(result, "text"):
        return str(result.text)
    return str(result)


def build_edit_graph(llm_service: Any) -> tuple[Graph, Type[BaseNode]]:
    """Build the edit graph and return (graph, PlanIntentNodeClass).

    The returned PlanIntentNodeClass is used as the entry node for graph runs.
    """

    @dataclass
    class PlanIntentNode(BaseNode[EditGraphState, EditGraphDeps, str]):
        """Node 1: Plan intent."""

        llm_service: Any

        async def run(self, ctx: GraphRunContext[EditGraphState, EditGraphDeps]) -> "LocateScenesNode":
            prompt = f"User request: {ctx.state.user_prompt}\n\nScreenplay context:\n{ctx.deps.scene_context}"
            result = await self.llm_service.plan_intent_agent.run(prompt, deps=ctx.deps)
            output = get_result_output(result)
            ctx.state.intent = output
            ctx.state.stream_buffer.append({"type": "status", "message": f"[Planning] {output[:100]}..."})
            return LocateScenesNode(self.llm_service)

    @dataclass
    class LocateScenesNode(BaseNode[EditGraphState, EditGraphDeps, str]):
        """Node 2: Locate relevant scenes/elements."""

        llm_service: Any

        async def run(self, ctx: GraphRunContext[EditGraphState, EditGraphDeps]) -> "LoadContextNode":
            prompt = (
                f"Intent: {ctx.state.intent}\n\n"
                "Extract search terms that would help find relevant screenplay elements in the database."
            )
            result = await self.llm_service.extract_search_terms_agent.run(prompt, deps=ctx.deps)
            result_text = get_result_output(result)

            search_terms: list[str] = []
            try:
                terms = json.loads(result_text)
                if isinstance(terms, list):
                    search_terms = terms
            except Exception:
                quoted = re.findall(r'"([^"]+)"', result_text)
                capitalized = re.findall(r"\\b([A-Z][a-z]+)\\b", result_text)
                search_terms = list(set(quoted + capitalized[:5]))

            element_ids: list[str] = []
            db_query_used = False
            logger.info(
                f"[LocateScenesNode] Checking DB conditions: project_id={bool(ctx.deps.project_id)}, "
                f"db_pool={bool(ctx.deps.db_pool)}, search_terms={len(search_terms) if search_terms else 0}"
            )
            if ctx.deps.project_id and ctx.deps.db_pool and search_terms:
                logger.info("[LocateScenesNode] ✅ All conditions met, querying database...")
                element_ids = await self.llm_service._query_elements_by_search(
                    ctx.deps.project_id,
                    search_terms,
                    element_types=["dialogue", "character", "action", "scene-heading"],
                )
                db_query_used = True
            else:
                missing = []
                if not ctx.deps.project_id:
                    missing.append("project_id")
                if not ctx.deps.db_pool:
                    missing.append("db_pool")
                if not search_terms:
                    missing.append("search_terms")
                logger.warning(f"[LocateScenesNode] ⚠️ DB query skipped - missing: {', '.join(missing)}")

            if element_ids:
                ctx.state.relevant_scene_ids = element_ids
                ctx.state.stream_buffer.append(
                    {"type": "status", "message": f"[Locating] Found {len(element_ids)} relevant elements via database"}
                )
            else:
                fallback_reason = "Database query returned 0 results" if db_query_used else "Database unavailable"
                ctx.state.stream_buffer.append(
                    {"type": "status", "message": f"[Locating] {fallback_reason}, using LLM fallback"}
                )
                prompt = f"Intent: {ctx.state.intent}\n\nFind relevant element IDs in this screenplay:\n{ctx.deps.scene_context}"
                result = await self.llm_service.locate_scenes_agent.run(prompt, deps=ctx.deps)
                result_text = get_result_output(result)
                try:
                    ids = json.loads(result_text)
                    if isinstance(ids, list):
                        ctx.state.relevant_scene_ids = ids
                except Exception:
                    uuid_pattern = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
                    ctx.state.relevant_scene_ids = re.findall(uuid_pattern, result_text)
                ctx.state.stream_buffer.append(
                    {"type": "status", "message": f"[Locating] Found {len(ctx.state.relevant_scene_ids)} relevant elements via LLM"}
                )

            return LoadContextNode(self.llm_service)

    @dataclass
    class LoadContextNode(BaseNode[EditGraphState, EditGraphDeps, str]):
        """Node 3: Load minimal context."""

        llm_service: Any

        async def run(self, ctx: GraphRunContext[EditGraphState, EditGraphDeps]) -> "SynthesizeNode":
            logger.info(
                f"[LoadContextNode] Checking DB conditions: project_id={bool(ctx.deps.project_id)}, "
                f"db_pool={bool(ctx.deps.db_pool)}, relevant_scene_ids={len(ctx.state.relevant_scene_ids) if ctx.state.relevant_scene_ids else 0}"
            )
            if ctx.deps.project_id and ctx.deps.db_pool and ctx.state.relevant_scene_ids:
                logger.info("[LoadContextNode] ✅ All conditions met, extracting context from database...")
                context, error_msg = await self.llm_service._extract_element_context(
                    ctx.deps.project_id,
                    ctx.state.relevant_scene_ids[:20],
                    context_size=3,
                )
                if context:
                    ctx.state.loaded_context = context
                    ctx.state.stream_buffer.append(
                        {
                            "type": "status",
                            "message": f"[Loading Context] ✅ Extracted {len(ctx.state.relevant_scene_ids)} elements from database",
                        }
                    )
                    return SynthesizeNode(self.llm_service)

                fallback_reason = f"Database query failed: {error_msg}" if error_msg else "Database query returned 0 rows"
                logger.warning(f"[LoadContextNode] ⚠️ {fallback_reason}")
                ctx.state.stream_buffer.append(
                    {"type": "status", "message": f"[Loading Context] ⚠️ {fallback_reason}, using LLM fallback"}
                )
            else:
                missing = []
                if not ctx.deps.project_id:
                    missing.append("project_id")
                if not ctx.deps.db_pool:
                    missing.append("db_pool")
                if not ctx.state.relevant_scene_ids:
                    missing.append("relevant_scene_ids")
                logger.warning(f"[LoadContextNode] ⚠️ DB query skipped - missing: {', '.join(missing)}")
                if not ctx.deps.db_pool:
                    ctx.state.stream_buffer.append(
                        {"type": "status", "message": "[Loading Context] ⚠️ Database unavailable, using LLM fallback"}
                    )
                elif not ctx.state.relevant_scene_ids:
                    ctx.state.stream_buffer.append(
                        {"type": "status", "message": "[Loading Context] ⚠️ No element IDs to extract, using LLM fallback"}
                    )

            element_ids_str = ", ".join(ctx.state.relevant_scene_ids[:10])
            prompt = f"Extract context for these element IDs: {element_ids_str}\n\nFull screenplay:\n{ctx.deps.scene_context}"
            result = await self.llm_service.load_context_agent.run(prompt, deps=ctx.deps)
            ctx.state.loaded_context = get_result_output(result)
            ctx.state.stream_buffer.append({"type": "status", "message": "[Loading Context] Extracted context via LLM"})
            return SynthesizeNode(self.llm_service)

    @dataclass
    class SynthesizeNode(BaseNode[EditGraphState, EditGraphDeps, str]):
        """Node 4: Synthesize understanding."""

        llm_service: Any

        async def run(self, ctx: GraphRunContext[EditGraphState, EditGraphDeps]) -> "ProposeEditsNode":
            prompt = f"""Intent: {ctx.state.intent}
Relevant Context: {ctx.state.loaded_context}
Full Screenplay: {ctx.deps.scene_context}

Synthesize a comprehensive understanding of what needs to change."""
            result = await self.llm_service.synthesize_agent.run(prompt, deps=ctx.deps)
            ctx.state.understanding = get_result_output(result)
            ctx.state.stream_buffer.append({"type": "status", "message": "[Synthesizing] Understanding complete"})
            return ProposeEditsNode(self.llm_service)

    @dataclass
    class ProposeEditsNode(BaseNode[EditGraphState, EditGraphDeps, str]):
        """Node 5: Propose edits."""

        llm_service: Any

        async def run(self, ctx: GraphRunContext[EditGraphState, EditGraphDeps]) -> "RefineEditsNode":
            prompt = f"""Understanding: {ctx.state.understanding}
Relevant Context: {ctx.state.loaded_context}
Full Screenplay: {ctx.deps.scene_context}

Generate specific edit proposals."""
            result = await self.llm_service.propose_edits_agent.run(prompt, deps=ctx.deps)

            if hasattr(result, "data") and result.data:
                data = result.data
                edits_list = data.get("edits", []) if isinstance(data, dict) else getattr(data, "edits", [])
                ctx.state.proposed_edits = {
                    "edits": [
                        {
                            "elementId": str(edit.get("elementId", "") if isinstance(edit, dict) else getattr(edit, "elementId", "")),
                            "elementType": str(edit.get("elementType", "") if isinstance(edit, dict) else getattr(edit, "elementType", "")),
                            "originalContent": str(edit.get("originalContent", "") if isinstance(edit, dict) else getattr(edit, "originalContent", "")),
                            "newContent": str(edit.get("newContent", "") if isinstance(edit, dict) else getattr(edit, "newContent", "")),
                            "reason": edit.get("reason") if isinstance(edit, dict) else getattr(edit, "reason", None),
                            "newElements": edit.get("newElements") if isinstance(edit, dict) else getattr(edit, "newElements", None),
                        }
                        for edit in edits_list
                    ]
                }
            else:
                ctx.state.proposed_edits = None

            ctx.state.stream_buffer.append({"type": "status", "message": "[Proposing] Generated edit proposals"})
            return RefineEditsNode(self.llm_service)

    @dataclass
    class RefineEditsNode(BaseNode[EditGraphState, EditGraphDeps, str]):
        """Node 6: Refine and validate edits."""

        llm_service: Any

        async def run(self, ctx: GraphRunContext[EditGraphState, EditGraphDeps]) -> "VerifyNode":
            if not ctx.state.proposed_edits:
                return VerifyNode(self.llm_service)
            edits_json = json.dumps(ctx.state.proposed_edits)
            prompt = f"""Proposed edits: {edits_json}
Full Screenplay: {ctx.deps.scene_context}

Validate and refine these edits."""
            result = await self.llm_service.refine_edits_agent.run(prompt, deps=ctx.deps)

            if hasattr(result, "data") and result.data:
                data = result.data
                edits_list = data.get("edits", []) if isinstance(data, dict) else getattr(data, "edits", [])
                ctx.state.applied_edits = {
                    "edits": [
                        {
                            "elementId": str(edit.get("elementId", "") if isinstance(edit, dict) else getattr(edit, "elementId", "")),
                            "elementType": str(edit.get("elementType", "") if isinstance(edit, dict) else getattr(edit, "elementType", "")),
                            "originalContent": str(edit.get("originalContent", "") if isinstance(edit, dict) else getattr(edit, "originalContent", "")),
                            "newContent": str(edit.get("newContent", "") if isinstance(edit, dict) else getattr(edit, "newContent", "")),
                            "reason": edit.get("reason") if isinstance(edit, dict) else getattr(edit, "reason", None),
                            "newElements": edit.get("newElements") if isinstance(edit, dict) else getattr(edit, "newElements", None),
                        }
                        for edit in edits_list
                    ]
                }
            else:
                ctx.state.applied_edits = ctx.state.proposed_edits

            # Include element IDs so the frontend can show "Editing ..." only during this phase.
            element_ids: list[str] = []
            try:
                if ctx.state.applied_edits and isinstance(ctx.state.applied_edits, dict):
                    element_ids = [
                        str(e.get("elementId"))
                        for e in (ctx.state.applied_edits.get("edits", []) or [])
                        if isinstance(e, dict) and e.get("elementId")
                    ]
            except Exception:
                element_ids = []

            if element_ids:
                shown = element_ids[:5]
                suffix = f" (+{len(element_ids) - len(shown)} more)" if len(element_ids) > len(shown) else ""
                ctx.state.stream_buffer.append(
                    {
                        "type": "status",
                        "message": f"[Applying] Editing {len(element_ids)} elements: {', '.join(shown)}{suffix}",
                    }
                )
            else:
                ctx.state.stream_buffer.append({"type": "status", "message": "[Applying] Edits validated and refined"})
            return VerifyNode(self.llm_service)

    @dataclass
    class VerifyNode(BaseNode[EditGraphState, EditGraphDeps, str]):
        """Node 7: Verify continuity/format."""

        llm_service: Any

        async def run(self, ctx: GraphRunContext[EditGraphState, EditGraphDeps]) -> "SummarizeNode":
            if not ctx.state.applied_edits:
                return SummarizeNode(self.llm_service)

            verification_issues: list[str] = []
            if ctx.deps.project_id and ctx.deps.db_pool:
                element_ids = [edit.get("elementId") for edit in ctx.state.applied_edits.get("edits", []) if edit.get("elementId")]
                if element_ids:
                    verified = await self.llm_service._verify_element_ids(ctx.deps.project_id, element_ids)
                    invalid_ids = [eid for eid, valid in verified.items() if not valid]
                    if invalid_ids:
                        verification_issues.append(f"Invalid element IDs: {', '.join(invalid_ids)}")

            edits_json = json.dumps(ctx.state.applied_edits)
            prompt = f"""Applied edits: {edits_json}
Full Screenplay: {ctx.deps.scene_context}
{'Verification issues: ' + '; '.join(verification_issues) if verification_issues else ''}

Verify continuity and formatting."""
            result = await self.llm_service.verify_agent.run(prompt, deps=ctx.deps)
            result_text = get_result_output(result)
            ctx.state.verification_result = (
                f"Database verification issues:\n" + "\n".join(verification_issues) + "\n\n" + result_text
                if verification_issues
                else result_text
            )
            ctx.state.stream_buffer.append({"type": "status", "message": "[Verifying] Continuity check complete"})
            return SummarizeNode(self.llm_service)

    @dataclass
    class SummarizeNode(BaseNode[EditGraphState, EditGraphDeps, str]):
        """Node 8: Summarize."""

        llm_service: Any

        async def run(self, ctx: GraphRunContext[EditGraphState, EditGraphDeps]) -> End[str]:
            edits_json = json.dumps(ctx.state.applied_edits) if ctx.state.applied_edits else "No edits"
            verification = ctx.state.verification_result or "Verification passed"
            prompt = f"""Edits made: {edits_json}
Verification: {verification}

Create a summary of the changes."""
            result = await self.llm_service.summarize_agent.run(prompt, deps=ctx.deps)
            result_text = get_result_output(result)
            ctx.state.final_summary = result_text
            if ctx.state.applied_edits:
                return End(json.dumps(ctx.state.applied_edits))
            return End(result_text)

    graph = Graph(
        nodes=[
            PlanIntentNode,
            LocateScenesNode,
            LoadContextNode,
            SynthesizeNode,
            ProposeEditsNode,
            RefineEditsNode,
            VerifyNode,
            SummarizeNode,
        ]
    )
    return graph, PlanIntentNode


