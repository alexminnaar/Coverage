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
    return []


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
                rewrite_result = await llm_service.ask_query_variants_agent.run(rewrite_prompt, deps=deps)
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
            variants = variants[: (budgets.max_query_variants_broaden if broaden else budgets.max_query_variants)]

            # Extract search terms using existing extraction agent (cheap + consistent)
            terms_prompt = (
                f"User question: {state.question}\n\n"
                + (f"Selected text: {state.selected_text}\n\n" if state.selected_text else "")
                + ("Extract broad search terms." if broaden else "Extract search terms.")
                + "\nReturn a JSON array of strings."
            )
            terms_result = await llm_service.extract_search_terms_agent.run(terms_prompt, deps=deps)
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
                candidate_ids: List[str] = []
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
                        await emit({"type": "decision", "action": "rerank", "why": "select best evidence for accuracy"})
                        candidates = await llm_service.db.fetch_elements_by_ids(deps.project_id, candidate_ids)
                        compact = []
                        for c in candidates:
                            compact.append(
                                {
                                    "elementId": c.get("element_id"),
                                    "elementType": c.get("element_type"),
                                    "elementIndex": c.get("element_index"),
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
                        rerank_result = await llm_service.ask_rerank_agent.run(rerank_payload, deps=deps)
                        try:
                            parsed = json.loads(get_result_output(rerank_result))
                        except Exception:
                            parsed = {}
                        await emit(
                            {
                                "type": "tool_result",
                                "tool": "llm.ask_rerank",
                                "selected_count": len(parsed.get("selectedElementIds") or []) if isinstance(parsed, dict) else 0,
                                "has_evidence": bool(parsed.get("evidence")) if isinstance(parsed, dict) else False,
                                "parsed_preview": (parsed if isinstance(parsed, dict) else {}) or {},
                            }
                        )
                        ids = parsed.get("selectedElementIds") if isinstance(parsed, dict) else None
                        if isinstance(ids, list) and ids:
                            chosen_ids = [str(x) for x in ids if str(x).strip()]
                        evidence = parsed.get("evidence") if isinstance(parsed, dict) else None
                        if isinstance(evidence, list):
                            state.evidence = evidence

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
                            gate_result = await llm_service.ask_grounding_agent.run(gate_payload, deps=deps)
                            try:
                                gate = json.loads(get_result_output(gate_result))
                            except Exception:
                                gate = {}
                            await emit({"type": "tool_result", "tool": "llm.ask_grounding_check", "gate": gate})
                            grounded = bool(gate.get("grounded", True))
                            next_action = str(gate.get("next_action", "answer"))
                            if (not grounded) or next_action == "retrieve_more":
                                await emit({"type": "status", "message": "[Reading] Not enough evidence, broadening retrieval"})
                                state.retrieved_context = None
                                continue

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
            await emit({"type": "status", "message": "[Reading] Using provided context window"})
            state.retrieved_context = state.scene_context or ""
            continue

        # ANSWER
        await emit({"type": "decision", "action": "answer", "why": "compose answer grounded in retrieved context"})
        await emit({"type": "status", "message": "[Writing] Drafting response"})

        context = state.retrieved_context or state.scene_context or ""
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
        )

        # Use the existing ask_agent but inject retrieved context via ChatDeps.scene_context
        chat_deps = ChatDeps(scene_context=context, mode="ask")
        result = await llm_service.ask_agent.run(prompt, deps=chat_deps, message_history=state.message_history or None)
        answer = get_result_output(result)
        return answer

    await emit({"type": "status", "message": "[Error] Exceeded iteration budget"})
    return "I couldn't complete that request within the iteration budget. Try selecting the relevant part of the screenplay and ask again."


