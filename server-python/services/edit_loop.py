from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional

from services.edit_types import EditGraphDeps, EditResponse
from services.prompts import PROMPT_CONTEXT_CONTRACT

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

    todos: Optional[list[dict]] = None
    todo_status: Dict[str, str] = field(default_factory=dict)
    todos_emitted: bool = False

    apply_started_emitted: bool = False

    # Context extraction window for DB extraction; increased on recovery attempts
    context_size: int = 3

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


def _env_flag(name: str, default: bool = True) -> bool:
    val = os.getenv(name)
    if val is None:
        return default
    return val.strip().lower() not in {"0", "false", "no", "off"}


def _safe_json_dict(text: str) -> Dict[str, Any]:
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    return {}


def _normalize_plan_todos(raw: Any, *, fallback: list[dict]) -> list[dict]:
    todos: list[dict] = []
    if isinstance(raw, list):
        for it in raw:
            if not isinstance(it, dict):
                continue
            tid = str(it.get("id") or "").strip()
            label = str(it.get("label") or "").strip()
            if not tid or not label:
                continue
            todos.append({"id": tid, "label": label, "status": "pending"})
    if not todos:
        todos = [{"id": str(x.get("id")), "label": str(x.get("label")), "status": "pending"} for x in fallback]
    seen: set[str] = set()
    out: list[dict] = []
    for t in todos:
        tid = str(t.get("id") or "")
        if not tid or tid in seen:
            continue
        seen.add(tid)
        out.append(t)
    return out[:12]


def _safe_json_dict(text: str) -> Dict[str, Any]:
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    return {}


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
    verify_recover_enabled = _env_flag("EDIT_VERIFY_RECOVER", True)
    logger.info(
        f"[edit_loop] start project_id={getattr(deps,'project_id',None)} "
        f"prompt={state.user_prompt[:160]!r} iter_max={budgets.max_iterations}"
    )
    await emit({"type": "status", "message": "[Start] Starting edit"})
    if getattr(deps, "global_index", None):
        await emit({"type": "status", "message": "[Index] Using global scene/character index"})

    while state.iterations < budgets.max_iterations:
        state.iterations += 1

        async def todo_update(todo_id: str, status: str) -> None:
            todo_id = str(todo_id or "").strip()
            status = str(status or "").strip()
            if not todo_id or not status:
                return
            if state.todo_status.get(todo_id) == status:
                return
            state.todo_status[todo_id] = status
            label = None
            try:
                for t in (state.todos or []):
                    if str(t.get("id")) == todo_id:
                        label = t.get("label")
                        break
            except Exception:
                label = None
            await emit({"type": "todo_update", "id": todo_id, "status": status, "label": label})

        async def todo_finish_sweep() -> None:
            """Mark any remaining todos as skipped so the UI doesn't show dangling items."""
            try:
                for t in (state.todos or []):
                    tid = str(t.get("id") or "").strip()
                    if not tid:
                        continue
                    cur = state.todo_status.get(tid) or str(t.get("status") or "pending")
                    if cur in ("done", "skipped"):
                        continue
                    await todo_update(tid, "skipped")
            except Exception:
                return

        # ROUTE
        if state.intent is None:
            await emit({"type": "decision", "action": "plan_intent", "why": "intent is not set"})
            selection_bits = []
            if state.selected_text:
                selection_bits.append(f"Selected text:\n{state.selected_text}")
            if state.selected_element_id:
                selection_bits.append(f"Selected element ID: {state.selected_element_id}")
            selection_block = ("\n\n".join(selection_bits) + "\n") if selection_bits else ""

            global_bits = f"{deps.global_index}\n" if getattr(deps, "global_index", None) else ""
            ctx_bits = deps.scene_context or ""

            prompt = (
                f"{PROMPT_CONTEXT_CONTRACT}\n\n"
                "## User request\n"
                f"{state.user_prompt}\n\n"
                + ("## Selection (UI anchor)\n" + selection_block + "\n" if selection_block else "")
                + ("## Global index\n" + global_bits + "\n" if global_bits else "")
                + "## Scene context (verbatim, local excerpt)\n"
                + "BEGIN_SCENE_CONTEXT\n"
                + ctx_bits
                + "\nEND_SCENE_CONTEXT\n"
            )
            await emit({"type": "tool_call", "tool": "llm.plan_intent", "prompt": prompt[:4000]})
            result = await llm_service.plan_intent_agent.run(
                prompt, deps=deps, message_history=state.message_history or None
            )
            plan_obj: dict = {}
            raw_out = ""
            if hasattr(result, "data") and isinstance(getattr(result, "data"), dict):
                plan_obj = dict(getattr(result, "data") or {})
            else:
                raw_out = get_result_output(result)
                plan_obj = _safe_json_dict(raw_out)
            intent_text = str(plan_obj.get("intent") or raw_out or "")
            state.intent = intent_text

            # Emit tool_result immediately so Langfuse shows the LLM step even if we early-exit on clarify.
            logger.info(f"[edit_loop] planned_intent len={len(intent_text)} preview={intent_text[:120]!r}")
            await emit(
                {
                    "type": "tool_result",
                    "tool": "llm.plan_intent",
                    "intent_preview": intent_text[:800],
                    "plan": plan_obj,
                    "raw_output_preview": (raw_out[:1200] if (not plan_obj) and raw_out else None),
                }
            )

            # Emit plan todos once (LLM-provided with fallback).
            if not state.todos_emitted:
                fallback = [
                    {"id": "plan_intent", "label": "Understand edit intent"},
                    {"id": "clarify", "label": "Ask clarifying questions"},
                    {"id": "locate", "label": "Locate relevant elements"},
                    {"id": "load_context", "label": "Load relevant context"},
                    {"id": "propose", "label": "Propose edits"},
                    {"id": "refine", "label": "Refine edits"},
                    {"id": "verify", "label": "Verify constraints"},
                ]
                state.todos = _normalize_plan_todos(plan_obj.get("todos"), fallback=fallback)
                state.todos_emitted = True
                await emit({"type": "plan_todos", "todos": state.todos})
                await todo_update("plan_intent", "done")

            # Clarify early-exit: ask user for missing info rather than editing the wrong target.
            next_action = str(plan_obj.get("next_action") or "proceed").strip().lower()
            if next_action == "clarify":
                await emit({"type": "decision", "action": "clarify", "why": "planner needs more information"})
                await todo_update("clarify", "in_progress")
                qs = plan_obj.get("clarifying_questions")
                questions: list[str] = []
                if isinstance(qs, list):
                    questions = [str(x).strip() for x in qs if str(x).strip()]
                if not questions:
                    questions = ["Which scene/line should I edit, and what tone/intent should the rewrite have?"]
                await emit(
                    {
                        "type": "status",
                        "message": "I need a bit more info before editing:\n- " + "\n- ".join(questions[:3]),
                    }
                )
                await todo_update("clarify", "done")
                await todo_finish_sweep()
                return {"edits": []}
            await emit({"type": "status", "message": f"[Planning] {intent_text[:120]}..."})
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
            await todo_update("locate", "in_progress")

            # 1) extract search terms
            terms_prompt = (
                f"Intent: {state.intent}\n\n"
                + ("Extract broad search terms." if broaden else "Extract search terms.")
                + "\nReturn a JSON array of strings."
            )
            await emit(
                {
                    "type": "tool_call",
                    "tool": "llm.extract_search_terms",
                    "prompt": terms_prompt[:2000],
                    "attempt": state.locate_attempts,
                }
            )
            terms_result = await llm_service.extract_search_terms_agent.run(
                terms_prompt, deps=deps, message_history=state.message_history or None
            )
            state.search_terms = _extract_search_terms(get_result_output(terms_result))
            await emit(
                {
                    "type": "tool_result",
                    "tool": "llm.extract_search_terms",
                    "terms_count": len(state.search_terms),
                    "terms_preview": state.search_terms[:12],
                }
            )

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
                await emit(
                    {
                        "type": "tool_result",
                        "tool": "vec_search",
                        "count": len(element_ids),
                        "ids_preview": element_ids[:10],
                    }
                )

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
                    await emit(
                        {
                            "type": "tool_result",
                            "tool": "db_search",
                            "count": len(element_ids),
                            "ids_preview": element_ids[:10],
                        }
                    )
                if element_ids:
                    state.relevant_element_ids = element_ids
                    await emit({"type": "status", "message": f"[Locating] Found {len(element_ids)} relevant elements via retrieval"})
                    await todo_update("locate", "done")
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
                await emit({"type": "tool_call", "tool": "llm.locate_fallback", "prompt": locate_prompt[:4000]})
                locate_result = await llm_service.locate_scenes_agent.run(
                    locate_prompt, deps=deps, message_history=state.message_history or None
                )
                locate_text = get_result_output(locate_result)
                ids = UUID_RE.findall(locate_text)
                await emit(
                    {
                        "type": "tool_result",
                        "tool": "llm.locate_fallback",
                        "ids_count": len(ids),
                        "ids_preview": ids[:10],
                        "raw_preview": locate_text[:800],
                    }
                )
                if not ids and state.context_element_ids:
                    # Last resort: give the loop *something* to work with; refine/propose steps can narrow.
                    ids = list(state.context_element_ids)[:20]
                state.relevant_element_ids = ids
                await emit({"type": "status", "message": f"[Locating] Found {len(ids)} relevant elements via LLM"})
                await todo_update("locate", "done")
                continue

            await emit(
                {
                    "type": "status",
                    "message": "[Locating] No database matches in the current context window. "
                    "Try selecting the exact dialogue/scene, or switch to full context.",
                }
            )
            await todo_finish_sweep()
            return {"edits": []}

        if state.loaded_context is None:
            await emit({"type": "decision", "action": "load_context", "why": "context not loaded"})
            await todo_update("load_context", "in_progress")

            if deps.project_id and deps.db_pool and state.relevant_element_ids:
                await emit(
                    {
                        "type": "tool_call",
                        "tool": "db_extract_context",
                        "count": len(state.relevant_element_ids),
                        "element_ids_preview": state.relevant_element_ids[:10],
                    }
                )
                context, error_msg = await llm_service._extract_element_context(
                    deps.project_id,
                    state.relevant_element_ids[:20],
                    context_size=state.context_size,
                )
                if context:
                    state.loaded_context = context
                    await emit(
                        {
                            "type": "tool_result",
                            "tool": "db_extract_context",
                            "ok": True,
                            "element_ids_preview": state.relevant_element_ids[:10],
                            "context_len": len(context),
                            "context_preview": context[:800],
                        }
                    )
                    await emit(
                        {
                            "type": "status",
                            "message": f"[Loading Context] ✅ Extracted {len(state.relevant_element_ids)} elements from database",
                        }
                    )
                    await todo_update("load_context", "done")
                    continue
                await emit(
                    {
                        "type": "tool_result",
                        "tool": "db_extract_context",
                        "ok": False,
                        "error": error_msg or "no rows",
                        "element_ids_preview": state.relevant_element_ids[:10],
                    }
                )
                await emit({"type": "status", "message": "[Loading Context] ⚠️ Database extraction failed, using LLM fallback"})

            ids_str = ", ".join(state.relevant_element_ids[:10])
            prompt = f"Extract context for these element IDs: {ids_str}\n\nFull screenplay:\n{deps.scene_context}"
            await emit({"type": "tool_call", "tool": "llm.load_context_fallback", "prompt": prompt[:4000]})
            result = await llm_service.load_context_agent.run(
                prompt, deps=deps, message_history=state.message_history or None
            )
            state.loaded_context = get_result_output(result)
            await emit(
                {
                    "type": "tool_result",
                    "tool": "llm.load_context_fallback",
                    "context_len": len(state.loaded_context or ""),
                    "context_preview": (state.loaded_context or "")[:800],
                }
            )
            await emit({"type": "status", "message": "[Loading Context] Extracted context via LLM"})
            await todo_update("load_context", "done")
            continue

        if state.understanding is None:
            await emit({"type": "decision", "action": "synthesize", "why": "understanding not synthesized"})
            await todo_update("synthesize", "in_progress")
            selection = f"\nSelected text:\n{state.selected_text}\n" if state.selected_text else ""
            prompt = f"""Intent: {state.intent}{selection}
Relevant Context: {state.loaded_context}
Context window: {deps.scene_context}

Synthesize a comprehensive understanding of what needs to change."""
            await emit({"type": "tool_call", "tool": "llm.synthesize", "prompt": prompt[:4000]})
            result = await llm_service.synthesize_agent.run(
                prompt, deps=deps, message_history=state.message_history or None
            )
            state.understanding = get_result_output(result)
            await emit({"type": "tool_result", "tool": "llm.synthesize", "understanding_preview": (state.understanding or "")[:800]})
            await emit({"type": "status", "message": "[Synthesizing] Understanding complete"})
            await todo_update("synthesize", "done")
            continue

        if state.proposed_edits is None:
            await emit({"type": "decision", "action": "propose_edits", "why": "no proposed edits yet"})
            await todo_update("propose", "in_progress")
            selection = f"\nSelected text:\n{state.selected_text}\n" if state.selected_text else ""
            prompt = f"""Understanding: {state.understanding}{selection}
Relevant Context: {state.loaded_context}
Context window: {deps.scene_context}

Generate specific edit proposals."""
            await emit({"type": "tool_call", "tool": "llm.propose_edits", "prompt": prompt[:4000]})
            result = await llm_service.propose_edits_agent.run(
                prompt, deps=deps, message_history=state.message_history or None
            )
            edits = _coerce_edit_response(getattr(result, "data", None) if hasattr(result, "data") else result)
            state.proposed_edits = edits or {"edits": []}
            logger.info(f"[edit_loop] proposed_edits n={len((state.proposed_edits or {}).get('edits', []))}")
            await emit(
                {
                    "type": "tool_result",
                    "tool": "llm.propose_edits",
                    "edits_count": len((state.proposed_edits or {}).get("edits", [])),
                    "edits_preview": (state.proposed_edits or {}).get("edits", [])[:3],
                }
            )
            await emit({"type": "status", "message": "[Proposing] Generated edit proposals"})
            await todo_update("propose", "done")
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
            await todo_update("refine", "in_progress")
            # Cursor-like: this is the phase where we actually generate the rewritten content.
            # Emit apply_started here so the UI shows the \"Edit Dialogue\" pill during refinement+verification.
            if not state.apply_started_emitted:
                state.apply_started_emitted = True
                try:
                    element_ids = [
                        str(e.get("elementId"))
                        for e in (state.proposed_edits or {}).get("edits", [])
                        if isinstance(e, dict) and e.get("elementId")
                    ]
                except Exception:
                    element_ids = []
                await emit({"type": "apply_started", "elementIds": element_ids, "label": "Applying edits"})
            issues = "\n".join(f"- {x}" for x in state.verification_issues) if state.verification_issues else "None"
            edits_json = json.dumps(state.proposed_edits or {"edits": []})
            selection = f"\nSelected text:\n{state.selected_text}\n" if state.selected_text else ""
            prompt = f"""Proposed edits: {edits_json}{selection}
Context window: {deps.scene_context}
Known issues:\n{issues}

Validate and refine these edits."""
            await emit({"type": "tool_call", "tool": "llm.refine_edits", "prompt": prompt[:4000], "attempt": state.refine_attempts})
            result = await llm_service.refine_edits_agent.run(
                prompt, deps=deps, message_history=state.message_history or None
            )
            edits = _coerce_edit_response(getattr(result, "data", None) if hasattr(result, "data") else result)
            state.applied_edits = edits or (state.proposed_edits or {"edits": []})
            logger.info(
                f"[edit_loop] refined_edits attempt={state.refine_attempts} n={len((state.applied_edits or {}).get('edits', []))}"
            )
            await emit(
                {
                    "type": "tool_result",
                    "tool": "llm.refine_edits",
                    "edits_count": len((state.applied_edits or {}).get("edits", [])),
                    "edits_preview": (state.applied_edits or {}).get("edits", [])[:3],
                }
            )
            await emit({"type": "status", "message": "[Refining] Edits validated and refined"})
            await todo_update("refine", "done")
            continue

        # VERIFY: lightweight validation + optional agent verification
        if state.verify_attempts < budgets.max_verify_attempts:
            state.verify_attempts += 1
            await emit({"type": "decision", "action": "verify", "why": f"verification attempt {state.verify_attempts}"})
            await todo_update("verify", "in_progress")
            state.verification_issues = []

            applied = state.applied_edits or {"edits": []}
            # lightweight checks
            for e in applied.get("edits", []):
                if not e.get("elementId"):
                    state.verification_issues.append("Edit is missing elementId")
                if e.get("newContent", "") == "":
                    state.verification_issues.append(f"Edit for {e.get('elementId', '<unknown>')} has empty newContent")

            # Ensure element IDs are grounded in the current context window / retrieved candidates.
            allowed_ids: set[str] = set()
            try:
                allowed_ids.update([str(x) for x in (state.context_element_ids or []) if x])
            except Exception:
                pass
            try:
                allowed_ids.update([str(x) for x in (state.relevant_element_ids or []) if x])
            except Exception:
                pass
            if allowed_ids:
                for e in applied.get("edits", []):
                    eid = e.get("elementId")
                    if eid and str(eid) not in allowed_ids:
                        state.verification_issues.append(f"Edit elementId not in context: {eid}")

            # DB verify IDs if available
            if deps.project_id and deps.db_pool:
                element_ids = [e.get("elementId") for e in applied.get("edits", []) if e.get("elementId")]
                if element_ids:
                    verified = await llm_service._verify_element_ids(deps.project_id, element_ids)
                    invalid = [eid for eid, ok in verified.items() if not ok]
                    if invalid:
                        state.verification_issues.append(f"Invalid element IDs: {', '.join(invalid)}")

            # Agent verify (Cursor-like): structured issues + recovery strategy, only triggers recovery on failure.
            verifier_ok = True
            suggested_recovery = "revise_edits"

            if verify_recover_enabled and hasattr(llm_service, "edit_verify_structured_agent"):
                payload = json.dumps(
                    {
                        "userRequest": state.user_prompt,
                        "selectedText": state.selected_text,
                        "globalIndex": getattr(deps, "global_index", None),
                        "contextWindow": deps.scene_context,
                        "appliedEdits": applied,
                        "precheckIssues": state.verification_issues,
                    }
                )
                await emit({"type": "tool_call", "tool": "llm.verify_structured", "payload": payload[:4000], "attempt": state.verify_attempts})
                result = await llm_service.edit_verify_structured_agent.run(
                    payload, deps=deps, message_history=state.message_history or None
                )
                verify_obj = _safe_json_dict(get_result_output(result))
                await emit({"type": "tool_result", "tool": "llm.verify_structured", "verify": verify_obj})
                verifier_ok = bool(verify_obj.get("ok", True))
                suggested_recovery = str(verify_obj.get("suggested_recovery", "revise_edits"))
                logger.info(
                    f"[edit_loop] verify_structured attempt={state.verify_attempts} ok={verifier_ok} "
                    f"recovery={suggested_recovery!r} issues_n={len(verify_obj.get('issues') or []) if isinstance(verify_obj, dict) else 0}"
                )

                issues = verify_obj.get("issues")
                if isinstance(issues, list):
                    for it in issues[:12]:
                        if not isinstance(it, dict):
                            continue
                        code = it.get("code", "VERIFY_ISSUE")
                        msg = it.get("message", "")
                        sev = it.get("severity", "error")
                        state.verification_issues.append(f"{sev}:{code}:{msg}")

                state.verification_result = json.dumps(verify_obj) if verify_obj else None
            else:
                # Fallback: legacy freeform verifier
                edits_json = json.dumps(applied)
                selection = f"\nSelected text:\n{state.selected_text}\n" if state.selected_text else ""
                prompt = f"""Applied edits: {edits_json}{selection}
Context window: {deps.scene_context}
Pre-check issues: {state.verification_issues if state.verification_issues else 'None'}

Verify continuity and formatting."""
                await emit({"type": "tool_call", "tool": "llm.verify_freeform", "prompt": prompt[:4000], "attempt": state.verify_attempts})
                result = await llm_service.verify_agent.run(
                    prompt, deps=deps, message_history=state.message_history or None
                )
                verify_text = get_result_output(result)
                state.verification_result = verify_text
                await emit({"type": "tool_result", "tool": "llm.verify_freeform", "verify_preview": (verify_text or "")[:1200]})
                verifier_ok = not _looks_like_verify_failure(verify_text)
                if (not verifier_ok) and verify_text and len(verify_text) < 800:
                    state.verification_issues.append(verify_text)

            if state.verification_issues or (not verifier_ok):
                await emit({"type": "status", "message": "[Verifying] Issues found"})

                if not verify_recover_enabled:
                    # Old behavior: retry refinement
                    await emit(
                        {
                            "type": "decision",
                            "action": "backtrack_to_refine",
                            "why": "verification issues detected",
                        }
                    )
                    state.applied_edits = None
                    continue

                # Recovery playbook (only on verification failure)
                await emit(
                    {
                        "type": "decision",
                        "action": "recover",
                        "why": "verification_failed",
                        "strategy": suggested_recovery,
                    }
                )

                if suggested_recovery == "relocate":
                    state.relevant_element_ids = []
                    state.loaded_context = None
                    state.understanding = None
                    state.proposed_edits = None
                    state.applied_edits = None
                    state.context_size = min(state.context_size + 2, 8)
                    continue

                if suggested_recovery == "reload_context":
                    state.loaded_context = None
                    state.understanding = None
                    state.proposed_edits = None
                    state.applied_edits = None
                    state.context_size = min(state.context_size + 2, 8)
                    continue

                if suggested_recovery == "revise_edits" and hasattr(llm_service, "edit_revise_edits_agent"):
                    revise_payload = json.dumps(
                        {
                            "userRequest": state.user_prompt,
                            "selectedText": state.selected_text,
                            "contextWindow": deps.scene_context,
                            "appliedEdits": applied,
                            "issues": state.verification_issues,
                        }
                    )
                    await emit({"type": "tool_call", "tool": "llm.revise_edits", "payload": revise_payload[:4000]})
                    revise_result = await llm_service.edit_revise_edits_agent.run(
                        revise_payload, deps=deps, message_history=state.message_history or None
                    )
                    revised = _coerce_edit_response(
                        getattr(revise_result, "data", None) if hasattr(revise_result, "data") else revise_result
                    )
                    state.applied_edits = revised or applied
                    await emit(
                        {
                            "type": "tool_result",
                            "tool": "llm.revise_edits",
                            "edits_count": len((state.applied_edits or {}).get("edits", [])),
                            "edits_preview": (state.applied_edits or {}).get("edits", [])[:3],
                        }
                    )
                    continue

                # abort
                await emit({"type": "status", "message": "[Verifying] Cannot safely apply edits; aborting"})
                await emit({"type": "apply_done"})
                logger.info("[edit_loop] abort: returning empty edits")
                await todo_finish_sweep()
                return {"edits": []}

            await emit({"type": "status", "message": "[Verifying] Continuity check complete"})
            await todo_update("verify", "done")

        # APPLY PHASE (UI marker): we’re done generating/validating edits; emit completion marker.
        await emit({"type": "apply_done"})

        # FINISH
        logger.info(f"[edit_loop] finish edits_n={len((state.applied_edits or {}).get('edits', []))}")
        await todo_update("finish", "done")
        await todo_finish_sweep()
        return state.applied_edits or {"edits": []}

    # Budget exceeded: return empty edits with a clear status
    await emit({"type": "status", "message": "[Error] Exceeded iteration budget; no edits generated"})
    await todo_finish_sweep()
    return {"edits": []}


