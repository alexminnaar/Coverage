from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional

from services.edit_types import EditGraphDeps, EditResponse

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


EmitEvent = Callable[[Dict[str, Any]], Awaitable[None]]


@dataclass
class EditLoopBudgets:
    """Hard limits to keep the loop bounded and predictable."""

    max_iterations: int = 20
    max_locate_attempts: int = 3
    max_refine_attempts: int = 2
    max_verify_attempts: int = 2


@dataclass
class EditLoopState:
    """State accumulated across an explicit router→action→observe edit loop."""

    user_prompt: str
    scene_context: str
    message_history: list[Any] = field(default_factory=list)
    selected_element_id: Optional[str] = None
    selected_text: Optional[str] = None
    context_policy: str = "scene_plus_adjacent"
    context_element_ids: list[str] = field(default_factory=list)

    intent: Optional[str] = None
    search_terms: list[str] = field(default_factory=list)
    relevant_element_ids: list[str] = field(default_factory=list)
    loaded_context: Optional[str] = None
    understanding: Optional[str] = None

    proposed_edits: Optional[EditResponse] = None
    applied_edits: Optional[EditResponse] = None
    verification_result: Optional[str] = None
    verification_issues: list[str] = field(default_factory=list)

    apply_started_emitted: bool = False

    iterations: int = 0
    locate_attempts: int = 0
    refine_attempts: int = 0
    verify_attempts: int = 0


def _coerce_edit_response(data: Any) -> Optional[EditResponse]:
    """Best-effort normalize a result to our `EditResponse` shape."""
    if not data:
        return None
    if isinstance(data, dict) and isinstance(data.get("edits"), list):
        edits: list[dict] = []
        for e in data.get("edits", []):
            if not isinstance(e, dict):
                continue
            edits.append(
                {
                    "elementId": str(e.get("elementId", "")),
                    "elementType": str(e.get("elementType", "")),
                    "originalContent": str(e.get("originalContent", "")),
                    "newContent": str(e.get("newContent", "")),
                    **({"reason": e.get("reason")} if e.get("reason") is not None else {}),
                    **({"newElements": e.get("newElements")} if e.get("newElements") is not None else {}),
                }
            )
        return {"edits": edits}  # type: ignore[return-value]
    # Some agent results may serialize as a stringified dict
    if isinstance(data, str) and data.strip().startswith("{"):
        try:
            parsed = json.loads(data)
            return _coerce_edit_response(parsed)
        except Exception:
            return None
    return None


UUID_RE = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)


def _extract_search_terms(text: str) -> list[str]:
    """Extract a list of search terms from an agent output."""
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [str(x) for x in parsed if str(x).strip()]
    except Exception:
        pass
    quoted = re.findall(r'"([^"]+)"', text)
    capitalized = re.findall(r"\b([A-Z][a-z]+)\b", text)
    terms = list(dict.fromkeys([*quoted, *capitalized]))
    return terms[:12]


def _looks_like_verify_failure(text: str) -> bool:
    t = (text or "").lower()
    return any(
        s in t
        for s in [
            "issues found",
            "invalid element id",
            "invalid element ids",
            "cannot verify",
            "missing required",
            "not found in screenplay",
        ]
    )


async def run_edit_loop(
    llm_service: Any,
    *,
    state: EditLoopState,
    deps: EditGraphDeps,
    emit: EmitEvent,
    budgets: Optional[EditLoopBudgets] = None,
) -> EditResponse:
    """Run the explicit edit loop and return a normalized final `EditResponse`.

    The loop emits typed events via `emit(...)`.
    """
    budgets = budgets or EditLoopBudgets()
    await emit({"type": "status", "message": "[Start] Starting edit"})

    while state.iterations < budgets.max_iterations:
        state.iterations += 1

        # ROUTE
        if state.intent is None:
            await emit({"type": "decision", "action": "plan_intent", "why": "intent is not set"})
            selection = f"\n\nSelected text:\n{state.selected_text}" if state.selected_text else ""
            prompt = f"User request: {state.user_prompt}{selection}\n\nContext window:\n{deps.scene_context}"
            result = await llm_service.plan_intent_agent.run(prompt, deps=deps)
            out = get_result_output(result)
            state.intent = out
            await emit({"type": "status", "message": f"[Planning] {out[:120]}..."})
            continue

        if not state.relevant_element_ids and state.locate_attempts < budgets.max_locate_attempts:
            state.locate_attempts += 1
            broaden = state.locate_attempts > 1
            await emit(
                {
                    "type": "decision",
                    "action": "locate_candidates",
                    "why": "no candidates yet" + ("; broadening" if broaden else ""),
                }
            )

            # 1) extract search terms
            terms_prompt = (
                f"Intent: {state.intent}\n\n"
                + ("Extract broad search terms." if broaden else "Extract search terms.")
                + "\nReturn a JSON array of strings."
            )
            terms_result = await llm_service.extract_search_terms_agent.run(terms_prompt, deps=deps)
            state.search_terms = _extract_search_terms(get_result_output(terms_result))

            # 2) try vector retrieval first (best-effort), then keyword DB
            element_ids: list[str] = []
            if deps.project_id and deps.db_pool and state.search_terms:
                vec_query = state.user_prompt + (f"\n\nSelected: {state.selected_text}" if state.selected_text else "")
                await emit(
                    {
                        "type": "tool_call",
                        "tool": "vec_search",
                        "query": vec_query[:2000],
                        "attempt": state.locate_attempts,
                    }
                )
                element_ids = await llm_service.vector_search_elements(
                    deps.project_id,
                    vec_query,
                    top_k=12 if not broaden else 25,
                    element_types=["dialogue", "character", "action", "scene-heading"],
                )
                await emit({"type": "tool_result", "tool": "vec_search", "count": len(element_ids)})

                if not element_ids:
                    await emit(
                        {
                            "type": "tool_call",
                            "tool": "db_search",
                            "query": state.search_terms,
                            "attempt": state.locate_attempts,
                        }
                    )
                    element_ids = await llm_service._query_elements_by_search(
                        deps.project_id,
                        state.search_terms,
                        element_types=["dialogue", "character", "action", "scene-heading"],
                    )
                    await emit({"type": "tool_result", "tool": "db_search", "count": len(element_ids)})
                if element_ids:
                    state.relevant_element_ids = element_ids
                    await emit({"type": "status", "message": f"[Locating] Found {len(element_ids)} relevant elements via retrieval"})
                    continue

            # LLM fallback locate: safe even in "scene_plus_adjacent" because deps.scene_context is a bounded window.
            if deps.scene_context:
                await emit({"type": "status", "message": "[Locating] No database matches, using LLM fallback in current context window"})
                locate_prompt = (
                    f"Intent: {state.intent}\n\n"
                    "Find the most relevant element IDs to edit in this context window. "
                    "Only return IDs that appear in the window.\n\n"
                    f"Context window:\n{deps.scene_context}"
                )
                locate_result = await llm_service.locate_scenes_agent.run(locate_prompt, deps=deps)
                locate_text = get_result_output(locate_result)
                ids = UUID_RE.findall(locate_text)
                if not ids and state.context_element_ids:
                    # Last resort: give the loop *something* to work with; refine/propose steps can narrow.
                    ids = list(state.context_element_ids)[:20]
                state.relevant_element_ids = ids
                await emit({"type": "status", "message": f"[Locating] Found {len(ids)} relevant elements via LLM"})
                continue

            await emit(
                {
                    "type": "status",
                    "message": "[Locating] No database matches in the current context window. "
                    "Try selecting the exact dialogue/scene, or switch to full context.",
                }
            )
            return {"edits": []}

        if state.loaded_context is None:
            await emit({"type": "decision", "action": "load_context", "why": "context not loaded"})

            if deps.project_id and deps.db_pool and state.relevant_element_ids:
                await emit({"type": "tool_call", "tool": "db_extract_context", "count": len(state.relevant_element_ids)})
                context, error_msg = await llm_service._extract_element_context(
                    deps.project_id,
                    state.relevant_element_ids[:20],
                    context_size=3,
                )
                if context:
                    state.loaded_context = context
                    await emit({"type": "tool_result", "tool": "db_extract_context", "ok": True})
                    await emit(
                        {
                            "type": "status",
                            "message": f"[Loading Context] ✅ Extracted {len(state.relevant_element_ids)} elements from database",
                        }
                    )
                    continue
                await emit(
                    {
                        "type": "tool_result",
                        "tool": "db_extract_context",
                        "ok": False,
                        "error": error_msg or "no rows",
                    }
                )
                await emit({"type": "status", "message": "[Loading Context] ⚠️ Database extraction failed, using LLM fallback"})

            ids_str = ", ".join(state.relevant_element_ids[:10])
            prompt = f"Extract context for these element IDs: {ids_str}\n\nFull screenplay:\n{deps.scene_context}"
            result = await llm_service.load_context_agent.run(prompt, deps=deps)
            state.loaded_context = get_result_output(result)
            await emit({"type": "status", "message": "[Loading Context] Extracted context via LLM"})
            continue

        if state.understanding is None:
            await emit({"type": "decision", "action": "synthesize", "why": "understanding not synthesized"})
            selection = f"\nSelected text:\n{state.selected_text}\n" if state.selected_text else ""
            prompt = f"""Intent: {state.intent}{selection}
Relevant Context: {state.loaded_context}
Context window: {deps.scene_context}

Synthesize a comprehensive understanding of what needs to change."""
            result = await llm_service.synthesize_agent.run(prompt, deps=deps)
            state.understanding = get_result_output(result)
            await emit({"type": "status", "message": "[Synthesizing] Understanding complete"})
            continue

        if state.proposed_edits is None:
            await emit({"type": "decision", "action": "propose_edits", "why": "no proposed edits yet"})
            selection = f"\nSelected text:\n{state.selected_text}\n" if state.selected_text else ""
            prompt = f"""Understanding: {state.understanding}{selection}
Relevant Context: {state.loaded_context}
Context window: {deps.scene_context}

Generate specific edit proposals."""
            result = await llm_service.propose_edits_agent.run(prompt, deps=deps)
            edits = _coerce_edit_response(getattr(result, "data", None) if hasattr(result, "data") else result)
            state.proposed_edits = edits or {"edits": []}
            await emit({"type": "status", "message": "[Proposing] Generated edit proposals"})
            continue

        if state.applied_edits is None and state.refine_attempts < budgets.max_refine_attempts:
            state.refine_attempts += 1
            await emit(
                {
                    "type": "decision",
                    "action": "refine_edits",
                    "why": "refining proposed edits" + (f" (attempt {state.refine_attempts})" if state.refine_attempts > 1 else ""),
                }
            )
            # Cursor-like: this is the phase where we actually generate the rewritten content.
            # Emit apply_started here so the UI shows the \"Edit Dialogue\" pill during refinement+verification.
            if not state.apply_started_emitted:
                state.apply_started_emitted = True
                await emit({"type": "apply_started", "elementIds": [], "label": "Edit Dialogue"})
            issues = "\n".join(f"- {x}" for x in state.verification_issues) if state.verification_issues else "None"
            edits_json = json.dumps(state.proposed_edits or {"edits": []})
            selection = f"\nSelected text:\n{state.selected_text}\n" if state.selected_text else ""
            prompt = f"""Proposed edits: {edits_json}{selection}
Context window: {deps.scene_context}
Known issues:\n{issues}

Validate and refine these edits."""
            result = await llm_service.refine_edits_agent.run(prompt, deps=deps)
            edits = _coerce_edit_response(getattr(result, "data", None) if hasattr(result, "data") else result)
            state.applied_edits = edits or (state.proposed_edits or {"edits": []})
            await emit({"type": "status", "message": "[Refining] Edits validated and refined"})
            continue

        # VERIFY: lightweight validation + optional agent verification
        if state.verify_attempts < budgets.max_verify_attempts:
            state.verify_attempts += 1
            await emit({"type": "decision", "action": "verify", "why": f"verification attempt {state.verify_attempts}"})
            state.verification_issues = []

            applied = state.applied_edits or {"edits": []}
            # lightweight checks
            for e in applied.get("edits", []):
                if not e.get("elementId"):
                    state.verification_issues.append("Edit is missing elementId")
                if e.get("newContent", "") == "":
                    state.verification_issues.append(f"Edit for {e.get('elementId', '<unknown>')} has empty newContent")

            # DB verify IDs if available
            if deps.project_id and deps.db_pool:
                element_ids = [e.get("elementId") for e in applied.get("edits", []) if e.get("elementId")]
                if element_ids:
                    verified = await llm_service._verify_element_ids(deps.project_id, element_ids)
                    invalid = [eid for eid, ok in verified.items() if not ok]
                    if invalid:
                        state.verification_issues.append(f"Invalid element IDs: {', '.join(invalid)}")

            # Agent verify (adds formatting/continuity checks)
            edits_json = json.dumps(applied)
            selection = f"\nSelected text:\n{state.selected_text}\n" if state.selected_text else ""
            prompt = f"""Applied edits: {edits_json}{selection}
Context window: {deps.scene_context}
Pre-check issues: {state.verification_issues if state.verification_issues else 'None'}

Verify continuity and formatting."""
            result = await llm_service.verify_agent.run(prompt, deps=deps)
            verify_text = get_result_output(result)
            state.verification_result = verify_text

            if state.verification_issues or _looks_like_verify_failure(verify_text):
                await emit({"type": "status", "message": "[Verifying] Issues found, retrying refinement"})
                await emit(
                    {
                        "type": "decision",
                        "action": "backtrack_to_refine",
                        "why": "verification issues detected",
                    }
                )
                # carry forward verify text as an issue so refine can correct
                if verify_text and len(verify_text) < 800:
                    state.verification_issues.append(verify_text)
                # allow refinement again if budget permits
                state.applied_edits = None
                continue

            await emit({"type": "status", "message": "[Verifying] Continuity check complete"})

        # APPLY PHASE (UI marker): we’re done generating/validating edits; emit completion marker.
        await emit({"type": "apply_done"})

        # FINISH
        return state.applied_edits or {"edits": []}

    # Budget exceeded: return empty edits with a clear status
    await emit({"type": "status", "message": "[Error] Exceeded iteration budget; no edits generated"})
    return {"edits": []}


