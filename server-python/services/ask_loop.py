from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, Optional, List

from services.edit_types import ChatDeps, EditGraphDeps

logger = logging.getLogger(__name__)

EmitEvent = Callable[[Dict[str, Any]], Awaitable[None]]


def get_result_output(result: Any) -> str:
    """Extract output from PydanticAI agent results across versions."""
    if hasattr(result, "data") and result.data is not None:
        return str(result.data)
    if hasattr(result, "output"):
        return str(result.output)
    if hasattr(result, "text"):
        return str(result.text)
    return str(result)


@dataclass
class AskLoopBudgets:
    max_iterations: int = 12
    max_retrieve_attempts: int = 2
    # Retrieval tuning (accuracy-first)
    k_per_query: int = 5
    max_query_variants: int = 5
    max_query_variants_broaden: int = 8
    max_candidates: int = 30
    rerank_select_min: int = 4
    rerank_select_max: int = 10
    final_context_size: int = 3


@dataclass
class AskLoopState:
    question: str
    scene_context: str
    message_history: list[Any] = field(default_factory=list)

    selected_element_id: Optional[str] = None
    selected_text: Optional[str] = None
    context_policy: str = "scene_plus_adjacent"
    context_element_ids: list[str] = field(default_factory=list)

    retrieve_attempts: int = 0
    iterations: int = 0
    retrieved_context: Optional[str] = None
    evidence_element_ids: list[str] = field(default_factory=list)
    evidence: Optional[list[dict]] = None
    plan: Optional[dict] = None
    todos: Optional[list[dict]] = None
    todo_status: Dict[str, str] = field(default_factory=dict)
    todos_emitted: bool = False


UUID_RE = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)
SCENE_ID_LINE_RE = re.compile(r"^\s*\d+\.\s*(.+?)\s*\(sceneId=([0-9a-f-]{36})\)\s*$", re.I | re.M)


def _extract_search_terms(text: str) -> list[str]:
    """Extract a list of search terms from an agent output."""
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [str(x) for x in parsed if str(x).strip()]
    except Exception:
        pass

    quoted = re.findall(r'"([^"]+)"', text)
    # Fall back to a few meaningful tokens
    words = re.findall(r"[A-Za-z][A-Za-z'-]{2,}", text)
    terms = list(dict.fromkeys([*quoted, *words]))
    return terms[:12]


def _dedupe_preserve_order(items: List[str]) -> List[str]:
    seen: set[str] = set()
    out: List[str] = []
    for x in items:
        if x in seen:
            continue
        seen.add(x)
        out.append(x)
    return out


def _env_flag(name: str, default: bool = True) -> bool:
    val = os.getenv(name)
    if val is None:
        return default
    return val.strip().lower() not in {"0", "false", "no", "off"}


def _safe_json_list(text: str) -> List[str]:
    try:
        parsed = json.loads(text)
        if isinstance(parsed, list):
            return [str(x) for x in parsed if str(x).strip()]
    except Exception:
        pass
    # Best-effort: extract the first JSON array from a noisy response.
    try:
        start = text.find("[")
        end = text.rfind("]")
        if start != -1 and end != -1 and end > start:
            parsed = json.loads(text[start : end + 1])
            if isinstance(parsed, list):
                return [str(x) for x in parsed if str(x).strip()]
    except Exception:
        pass
    return []


def _safe_json_dict(text: str) -> Dict[str, Any]:
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    # Best-effort: extract the first JSON object from a noisy response.
    try:
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end != -1 and end > start:
            parsed = json.loads(text[start : end + 1])
            if isinstance(parsed, dict):
                return parsed
    except Exception:
        pass
    return {}


def _extract_global_index_scenes(global_index: Optional[str]) -> List[Dict[str, str]]:
    """Parse Global Index v1 scene lines into structured candidates for planning."""
    if not global_index:
        return []
    out: List[Dict[str, str]] = []
    for m in SCENE_ID_LINE_RE.finditer(global_index):
        heading = (m.group(1) or "").strip()
        scene_id = (m.group(2) or "").strip()
        if heading and scene_id:
            out.append({"sceneId": scene_id, "heading": heading})
    return out


def _normalize_plan_todos(raw: Any, *, fallback: list[dict]) -> list[dict]:
    """Normalize planner-provided todos to [{id,label,status}] with basic validation."""
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
    # Deduplicate by id, preserve order
    seen: set[str] = set()
    out: list[dict] = []
    for t in todos:
        tid = str(t.get("id") or "")
        if not tid or tid in seen:
            continue
        seen.add(tid)
        out.append(t)
    return out[:10]


async def run_ask_loop(
    llm_service: Any,
    *,
    state: AskLoopState,
    deps: EditGraphDeps,
    emit: EmitEvent,
    budgets: Optional[AskLoopBudgets] = None,
) -> str:
    """Run a lightweight Cursor-like ask loop and return the final answer text."""
    budgets = budgets or AskLoopBudgets()
    ask_rerank_enabled = _env_flag("ASK_RERANK_ENABLED", True)
    ask_grounding_gate = _env_flag("ASK_GROUNDING_GATE", True)

    await emit({"type": "status", "message": "[Start] Answering"})
    if getattr(deps, "global_index", None):
        await emit({"type": "status", "message": "[Index] Using global scene/character index"})

    while state.iterations < budgets.max_iterations:
        state.iterations += 1

        async def todo_update(todo_id: str, status: str) -> None:
            """Emit todo_update only when status changes."""
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

        # RETRIEVE (multi-query vector first, then keyword DB)
        if state.retrieved_context is None and state.retrieve_attempts < budgets.max_retrieve_attempts:
            state.retrieve_attempts += 1
            broaden = state.retrieve_attempts > 1
            await emit(
                {
                    "type": "decision",
                    "action": "retrieve_context",
                    "why": "Multi-query vector retrieval" + ("; broadening" if broaden else ""),
                }
            )

            # Ask planning (generic): coverage targets + query variants + answer outline.
            ask_plan_enabled = _env_flag("ASK_PLAN_ENABLED", True)
            must_include_ids: list[str] = []
            must_include_scene_ids: list[str] = []
            planner_variants: list[str] = []
            answer_outline: list[str] = []

            if (
                ask_plan_enabled
                and state.plan is None
                and hasattr(llm_service, "ask_plan_agent")
                and state.retrieve_attempts == 1
            ):
                await emit({"type": "decision", "action": "plan", "why": "improve retrieval coverage + answer structure"})
                plan_payload = json.dumps(
                    {
                        "question": state.question,
                        "selectedText": state.selected_text,
                        "globalIndex": getattr(deps, "global_index", None),
                        "globalIndexScenes": _extract_global_index_scenes(getattr(deps, "global_index", None)),
                    }
                )
                await emit({"type": "tool_call", "tool": "llm.ask_plan", "payload": plan_payload[:4000]})
                plan_result = await llm_service.ask_plan_agent.run(
                    plan_payload, deps=deps, message_history=state.message_history or None
                )
                # With result_type enabled, PydanticAI may return a dict-like object in result.data.
                plan_obj: dict = {}
                if hasattr(plan_result, "data") and isinstance(getattr(plan_result, "data"), dict):
                    plan_obj = dict(getattr(plan_result, "data") or {})
                    plan_raw = ""
                else:
                    plan_raw = get_result_output(plan_result)
                    plan_obj = _safe_json_dict(plan_raw)
                state.plan = plan_obj
                await emit(
                    {
                        "type": "tool_result",
                        "tool": "llm.ask_plan",
                        "plan": plan_obj,
                        # When parsing fails, this makes it obvious in Langfuse what the model actually returned.
                        "raw_output_preview": (plan_raw[:1200] if not plan_obj else None),
                    }
                )

            if isinstance(state.plan, dict) and state.plan:
                # Emit plan todos once.
                if not state.todos_emitted:
                    next_action = str(state.plan.get("next_action") or "retrieve").strip().lower()
                    fallback = (
                        [{"id": "plan", "label": "Understand the question"}, {"id": "answer", "label": "Write the answer"}]
                        if next_action in ("answer_direct", "answer", "direct")
                        else [
                            {"id": "plan", "label": "Understand the question"},
                            {"id": "retrieve", "label": "Retrieve evidence"},
                            {"id": "answer", "label": "Write the answer"},
                        ]
                    )
                    state.todos = _normalize_plan_todos(state.plan.get("todos"), fallback=fallback)
                    state.todos_emitted = True
                    await emit({"type": "plan_todos", "todos": state.todos})
                    await todo_update("plan", "done")

                cov = state.plan.get("coverage")
                if isinstance(cov, dict):
                    ids = cov.get("must_include_element_ids")
                    if isinstance(ids, list):
                        must_include_ids = [str(x) for x in ids if str(x).strip()]
                    sids = cov.get("must_include_scene_ids")
                    if isinstance(sids, list):
                        must_include_scene_ids = [str(x) for x in sids if str(x).strip()]

                qv = state.plan.get("query_variants")
                if isinstance(qv, list):
                    planner_variants = [str(x) for x in qv if str(x).strip()]

                ao = state.plan.get("answer_outline")
                if isinstance(ao, list):
                    answer_outline = [str(x) for x in ao if str(x).strip()]

                # Optional early exit: skip retrieval entirely for general questions.
                next_action = str(state.plan.get("next_action") or "retrieve").strip().lower()
                use_context = state.plan.get("use_context")
                use_context_bool = True if use_context is None else bool(use_context)
                if next_action in ("clarify", "need_more", "need_more_info"):
                    await emit({"type": "decision", "action": "clarify", "why": "planner needs more information"})
                    await todo_update("clarify", "in_progress")
                    qs = state.plan.get("clarifying_questions")
                    questions: list[str] = []
                    if isinstance(qs, list):
                        questions = [str(x).strip() for x in qs if str(x).strip()]
                    if not questions:
                        questions = ["Can you clarify what you mean (what part of the screenplay or what goal)?"]
                    await emit({"type": "status", "message": "[Clarify] Need more information to answer"})
                    await todo_update("clarify", "done")
                    await todo_finish_sweep()
                    return "I’m not fully sure what you mean yet. Could you clarify:\n- " + "\n- ".join(questions[:3])

                if next_action in ("answer_direct", "answer", "direct"):
                    await emit(
                        {
                            "type": "decision",
                            "action": "skip_retrieval",
                            "why": "planner chose answer_direct",
                        }
                    )
                    # Set retrieved_context so we exit the retrieval phase on the next iteration.
                    # Even when answering directly, keep non-empty project context when available
                    # (e.g., global index) so the model doesn't incorrectly claim it lacks access.
                    ctx_parts: list[str] = []
                    if getattr(deps, "global_index", None):
                        ctx_parts.append("GLOBAL INDEX (project-wide)")
                        ctx_parts.append(str(getattr(deps, "global_index")))
                    if use_context_bool and (state.scene_context or ""):
                        ctx_parts.append("SCENE CONTEXT (local excerpt)")
                        ctx_parts.append(str(state.scene_context or ""))
                    state.retrieved_context = "\n".join(ctx_parts).strip()
                    await emit(
                        {
                            "type": "status",
                            "message": "[Reading] Skipping retrieval (answering directly)",
                        }
                    )
                    await todo_update("retrieve", "skipped")
                    continue

            # 0) Query expansion (Cursor-like): diversify retrieval queries for recall.
            await emit({"type": "decision", "action": "rewrite_queries", "why": "increase recall for retrieval"})
            rewrite_prompt = (
                f"User question: {state.question}\n\n"
                + (f"Selected text: {state.selected_text}\n\n" if state.selected_text else "")
                + (f"Global index:\n{deps.global_index}\n\n" if getattr(deps, "global_index", None) else "")
                + "Return a JSON array of query variants."
            )
            variants: List[str] = []
            if hasattr(llm_service, "ask_query_variants_agent"):
                await emit(
                    {
                        "type": "tool_call",
                        "tool": "llm.ask_query_variants",
                        "prompt": rewrite_prompt[:2000],
                        "attempt": state.retrieve_attempts,
                    }
                )
                rewrite_result = await llm_service.ask_query_variants_agent.run(
                    rewrite_prompt, deps=deps, message_history=state.message_history or None
                )
                variants = _safe_json_list(get_result_output(rewrite_result))
                await emit(
                    {
                        "type": "tool_result",
                        "tool": "llm.ask_query_variants",
                        "variants_count": len(variants),
                        "variants_preview": variants[:5],
                    }
                )
            if not variants:
                variants = [state.question]
            # Ensure original question is first
            if variants[0] != state.question:
                variants = [state.question] + [v for v in variants if v != state.question]
            # Merge planner variants (if any), then cap.
            if planner_variants:
                if planner_variants and planner_variants[0] != state.question:
                    planner_variants = [state.question] + [v for v in planner_variants if v != state.question]
                variants = _dedupe_preserve_order([*variants, *planner_variants])
            variants = variants[: (budgets.max_query_variants_broaden if broaden else budgets.max_query_variants)]

            # Extract search terms using existing extraction agent (cheap + consistent)
            terms_prompt = (
                f"User question: {state.question}\n\n"
                + (f"Selected text: {state.selected_text}\n\n" if state.selected_text else "")
                + (f"Global index:\n{deps.global_index}\n\n" if getattr(deps, "global_index", None) else "")
                + ("Extract broad search terms." if broaden else "Extract search terms.")
                + "\nReturn a JSON array of strings."
            )
            await emit({"type": "tool_call", "tool": "llm.extract_search_terms", "prompt": terms_prompt[:2000]})
            terms_result = await llm_service.extract_search_terms_agent.run(
                terms_prompt, deps=deps, message_history=state.message_history or None
            )
            terms = _extract_search_terms(get_result_output(terms_result))
            await emit(
                {
                    "type": "tool_result",
                    "tool": "llm.extract_search_terms",
                    "terms_count": len(terms),
                    "terms_preview": terms[:12],
                }
            )

            if deps.project_id and deps.db_pool and terms:
                # 1) Semantic retrieval via pgvector (best-effort), per query variant
                # Seed candidates with "must include" IDs so coverage does not depend on query phrasing.
                max_must = int(os.getenv("ASK_PLAN_MUST_INCLUDE_MAX", "12"))
                must = _dedupe_preserve_order([*must_include_ids, *must_include_scene_ids])[:max_must]
                candidate_ids: List[str] = list(must)
                await todo_update("retrieve", "in_progress")
                k_per = budgets.k_per_query + (3 if broaden else 0)
                for qi, q in enumerate(variants):
                    await emit(
                        {
                            "type": "tool_call",
                            "tool": "vec_search",
                            "query": q[:2000],
                            "attempt": state.retrieve_attempts,
                            "query_index": qi,
                            "k": k_per,
                        }
                    )
                    ids = await llm_service.vector_search_elements(
                        deps.project_id,
                        q,
                        top_k=k_per,
                        element_types=["dialogue", "character", "action", "scene-heading"],
                    )
                    await emit(
                        {
                            "type": "tool_result",
                            "tool": "vec_search",
                            "count": len(ids),
                            "query_index": qi,
                            "ids_preview": ids[:10],
                        }
                    )
                    candidate_ids.extend(ids)

                candidate_ids = _dedupe_preserve_order(candidate_ids)[: budgets.max_candidates]

                # 2) Fallback: keyword search
                if not candidate_ids:
                    await emit(
                        {
                            "type": "tool_call",
                            "tool": "db_search",
                            "query": terms,
                            "attempt": state.retrieve_attempts,
                        }
                    )
                    candidate_ids = await llm_service._query_elements_by_search(
                        deps.project_id,
                        terms,
                        element_types=["dialogue", "character", "action", "scene-heading"],
                    )
                    await emit(
                        {
                            "type": "tool_result",
                            "tool": "db_search",
                            "count": len(candidate_ids),
                            "ids_preview": candidate_ids[:10],
                        }
                    )

                if candidate_ids:
                    chosen_ids = candidate_ids
                    # Rerank: select best evidence elements for accuracy.
                    if ask_rerank_enabled and hasattr(llm_service, "ask_rerank_agent"):
                        await todo_update("rerank", "in_progress")
                        await emit({"type": "decision", "action": "rerank", "why": "select best evidence for accuracy"})
                        candidates = await llm_service.db.fetch_elements_by_ids(deps.project_id, candidate_ids)
                        compact = []
                        for c in candidates:
                            compact.append(
                                {
                                    "elementId": c.get("element_id"),
                                    "elementType": c.get("element_type"),
                                    "elementIndex": c.get("element_index"),
                                    "sceneId": c.get("scene_id"),
                                    "sceneHeading": c.get("scene_heading"),
                                    "content": str(c.get("content") or "")[:400],
                                }
                            )
                        rerank_payload = json.dumps(
                            {
                                "question": state.question,
                                "selectedText": state.selected_text,
                                "globalIndex": getattr(deps, "global_index", None),
                                "candidates": compact,
                            }
                        )
                        await emit(
                            {
                                "type": "tool_call",
                                "tool": "llm.ask_rerank",
                                "candidates_count": len(compact),
                                "payload": rerank_payload[:4000],
                            }
                        )
                        rerank_result = await llm_service.ask_rerank_agent.run(
                            rerank_payload, deps=deps, message_history=state.message_history or None
                        )
                        parsed: dict = {}
                        rerank_raw = ""
                        if hasattr(rerank_result, "data") and isinstance(getattr(rerank_result, "data"), dict):
                            parsed = dict(getattr(rerank_result, "data") or {})
                        else:
                            rerank_raw = get_result_output(rerank_result)
                            try:
                                parsed = json.loads(rerank_raw)
                            except Exception:
                                parsed = _safe_json_dict(rerank_raw)
                        await emit(
                            {
                                "type": "tool_result",
                                "tool": "llm.ask_rerank",
                                "selected_count": len(parsed.get("selectedElementIds") or []) if isinstance(parsed, dict) else 0,
                                "has_evidence": bool(parsed.get("evidence")) if isinstance(parsed, dict) else False,
                                "parsed_preview": (parsed if isinstance(parsed, dict) else {}) or {},
                                "raw_output_preview": (rerank_raw[:1200] if not parsed else None),
                            }
                        )
                        ids = parsed.get("selectedElementIds") if isinstance(parsed, dict) else None
                        if isinstance(ids, list) and ids:
                            chosen_ids = [str(x) for x in ids if str(x).strip()]
                        evidence = parsed.get("evidence") if isinstance(parsed, dict) else None
                        if isinstance(evidence, list):
                            state.evidence = evidence
                        await todo_update("rerank", "done")

                    # Enforce coverage after rerank/trimming: keep must-include IDs at the front.
                    if must:
                        chosen_ids = _dedupe_preserve_order([*must, *chosen_ids])

                    chosen_ids = _dedupe_preserve_order(chosen_ids)[:25]
                    # Keep within configured bounds if reranker returned too much/too little
                    if len(chosen_ids) < budgets.rerank_select_min:
                        chosen_ids = candidate_ids[: budgets.rerank_select_min]
                    if len(chosen_ids) > budgets.rerank_select_max:
                        chosen_ids = chosen_ids[: budgets.rerank_select_max]

                    state.evidence_element_ids = chosen_ids
                    await emit(
                        {
                            "type": "tool_call",
                            "tool": "db_extract_context",
                            "count": len(chosen_ids),
                            "element_ids_preview": chosen_ids[:10],
                        }
                    )
                    ctx, error_msg = await llm_service._extract_element_context(
                        deps.project_id,
                        chosen_ids,
                        context_size=budgets.final_context_size + (1 if broaden else 0),
                    )
                    if ctx:
                        state.retrieved_context = ctx
                        await todo_update("retrieve", "done")
                        await emit(
                            {
                                "type": "tool_result",
                                "tool": "db_extract_context",
                                "ok": True,
                                "element_ids_preview": chosen_ids[:10],
                                "context_len": len(ctx),
                                "context_preview": ctx[:800],
                            }
                        )
                        await emit({"type": "status", "message": f"[Reading] Loaded {len(chosen_ids)} evidence elements"})

                        # Grounding gate: answer only when grounded; otherwise broaden retrieval.
                        if ask_grounding_gate and hasattr(llm_service, "ask_grounding_agent"):
                            await todo_update("grounding", "in_progress")
                            await emit({"type": "decision", "action": "grounding_check", "why": "answer only when grounded"})
                            gate_payload = json.dumps(
                                {
                                    "question": state.question,
                                    "globalIndex": getattr(deps, "global_index", None),
                                    "context": ctx,
                                }
                            )
                            await emit(
                                {
                                    "type": "tool_call",
                                    "tool": "llm.ask_grounding_check",
                                    "payload": gate_payload[:4000],
                                }
                            )
                            gate_result = await llm_service.ask_grounding_agent.run(
                                gate_payload, deps=deps, message_history=state.message_history or None
                            )
                            gate: dict = {}
                            gate_raw = ""
                            if hasattr(gate_result, "data") and isinstance(getattr(gate_result, "data"), dict):
                                gate = dict(getattr(gate_result, "data") or {})
                            else:
                                gate_raw = get_result_output(gate_result)
                                try:
                                    gate = json.loads(gate_raw)
                                except Exception:
                                    gate = _safe_json_dict(gate_raw)
                            await emit(
                                {
                                    "type": "tool_result",
                                    "tool": "llm.ask_grounding_check",
                                    "gate": gate,
                                    "raw_output_preview": (gate_raw[:1200] if not gate else None),
                                }
                            )
                            grounded = bool(gate.get("grounded", True))
                            next_action = str(gate.get("next_action", "answer"))
                            if (not grounded) or next_action == "retrieve_more":
                                await emit({"type": "status", "message": "[Reading] Not enough evidence, broadening retrieval"})
                                state.retrieved_context = None
                                continue
                            await todo_update("grounding", "done")

                        continue
                    await emit(
                        {
                            "type": "tool_result",
                            "tool": "db_extract_context",
                            "ok": False,
                            "error": error_msg or "no rows",
                            "element_ids_preview": chosen_ids[:10],
                        }
                    )

            # Fallback: use provided sceneContext window
            # If sceneContext is empty (no selection), fall back to the global index so the model
            # still has screenplay-level grounding (e.g., counting characters).
            fallback_ctx_parts: list[str] = []
            if (state.scene_context or "").strip():
                fallback_ctx_parts.append("SCENE CONTEXT (local excerpt)")
                fallback_ctx_parts.append(str(state.scene_context or ""))
            elif getattr(deps, "global_index", None):
                fallback_ctx_parts.append("GLOBAL INDEX (project-wide)")
                fallback_ctx_parts.append(str(getattr(deps, "global_index")))
            state.retrieved_context = "\n".join(fallback_ctx_parts).strip()
            await emit(
                {
                    "type": "status",
                    "message": "[Reading] Using provided context window" if (state.scene_context or "").strip() else "[Reading] Using global index context",
                }
            )
            await todo_update("retrieve", "skipped")
            continue

        # ANSWER
        await emit({"type": "decision", "action": "answer", "why": "compose answer grounded in retrieved context"})
        await emit({"type": "status", "message": "[Writing] Drafting response"})
        await todo_update("answer", "in_progress")

        context = state.retrieved_context or state.scene_context or ""
        if (not (context or "").strip()) and getattr(deps, "global_index", None):
            context = "GLOBAL INDEX (project-wide)\n" + str(getattr(deps, "global_index"))
        selection_bits = []
        if state.selected_text:
            selection_bits.append(f"Selected text:\n{state.selected_text}")
        if state.selected_element_id:
            selection_bits.append(f"Selected element ID: {state.selected_element_id}")
        selection_block = ("\n\n".join(selection_bits) + "\n\n") if selection_bits else ""

        prompt = (
            f"{selection_block}"
            f"User question:\n{state.question}\n\n"
            "Instructions:\n"
            "- Answer concisely and directly.\n"
            "- Ground your answer in the provided screenplay context.\n"
            "- When referencing specific lines, include a short cue like a scene heading or element ID if available.\n"
            "- If the user is asking for a count (e.g., 'how many', 'number of', 'count'), compute it from the context.\n"
            "- If the user is asking about characters, treat elements with type 'character' as the primary source of character names.\n"
            "- Do not output placeholder brackets like '[list here]'. If the context is insufficient, ask a targeted follow-up.\n"
        )
        if isinstance(state.plan, dict):
            ao = state.plan.get("answer_outline")
            if isinstance(ao, list) and ao:
                outline = "\n".join(f"- {str(x)}" for x in ao[:12] if str(x).strip())
                if outline:
                    prompt += f"\nAnswer outline (follow this structure):\n{outline}\n"

        # Include the context in the user prompt as well (not just system prompt injection).
        # This makes the final model call robust even if system prompt injection is misapplied.
        if context:
            prompt += "\nScreenplay context (verbatim):\nBEGIN_CONTEXT\n" + context + "\nEND_CONTEXT\n"
        # Also include the global index in the final answer call (compact, high-signal),
        # so the model can answer screenplay-wide questions even when the retrieved context is narrow.
        if getattr(deps, "global_index", None):
            gi = str(getattr(deps, "global_index") or "")
            if gi and gi not in (context or ""):
                prompt += "\nGlobal index:\nBEGIN_GLOBAL_INDEX\n" + gi + "\nEND_GLOBAL_INDEX\n"

        # Use the existing ask_agent; we still also inject context via ChatDeps.scene_context.
        chat_deps = ChatDeps(scene_context=context, mode="ask")
        # Emit a single tool_result-style event so observability can show what the final model saw.
        # (We don't stream this as text; it stays as typed events for Langfuse + debugging.)
        ctx_preview = ""
        try:
            if _env_flag("LANGFUSE_LOG_CONTENT", False):
                ctx_preview = (context or "")[:1200]
        except Exception:
            ctx_preview = ""
        await emit(
            {
                "type": "tool_call",
                "tool": "llm.ask_answer",
                # Use payload so Langfuse spans show structured input (not just a prompt string).
                "payload": {
                    "prompt": prompt[:4000],
                    "context_len": len(context),
                    "context_preview": ctx_preview or None,
                    "message_history_len": len(state.message_history or []),
                },
            }
        )
        result = await llm_service.ask_agent.run(prompt, deps=chat_deps, message_history=state.message_history or None)
        answer = get_result_output(result)
        await emit(
            {
                "type": "tool_result",
                "tool": "llm.ask_answer",
                "answer_preview": str(answer)[:800],
            }
        )
        await todo_update("answer", "done")
        await todo_finish_sweep()
        return answer

    await emit({"type": "status", "message": "[Error] Exceeded iteration budget"})
    # Finish sweep on error paths too.
    try:
        if state.todos_emitted:
            for t in (state.todos or []):
                tid = str(t.get("id") or "").strip()
                if not tid:
                    continue
                cur = state.todo_status.get(tid) or str(t.get("status") or "pending")
                if cur in ("done", "skipped"):
                    continue
                await emit({"type": "todo_update", "id": tid, "status": "skipped", "label": t.get("label")})
    except Exception:
        pass
    return "I couldn't complete that request within the iteration budget. Try selecting the relevant part of the screenplay and ask again."


