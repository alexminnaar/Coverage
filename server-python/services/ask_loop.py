from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, Optional

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

    await emit({"type": "status", "message": "[Start] Answering"})

    while state.iterations < budgets.max_iterations:
        state.iterations += 1

        # RETRIEVE (vector first, then keyword DB)
        if state.retrieved_context is None and state.retrieve_attempts < budgets.max_retrieve_attempts:
            state.retrieve_attempts += 1
            broaden = state.retrieve_attempts > 1
            await emit(
                {
                    "type": "decision",
                    "action": "retrieve_context",
                    "why": "Vector-first retrieval" + ("; broadening" if broaden else ""),
                }
            )

            # Extract search terms using existing extraction agent (cheap + consistent)
            terms_prompt = (
                f"User question: {state.question}\n\n"
                + (f"Selected text: {state.selected_text}\n\n" if state.selected_text else "")
                + ("Extract broad search terms." if broaden else "Extract search terms.")
                + "\nReturn a JSON array of strings."
            )
            terms_result = await llm_service.extract_search_terms_agent.run(terms_prompt, deps=deps)
            terms = _extract_search_terms(get_result_output(terms_result))

            if deps.project_id and deps.db_pool and terms:
                # 1) Semantic retrieval via pgvector (best-effort)
                vec_query = state.question + (f"\n\nSelected: {state.selected_text}" if state.selected_text else "")
                await emit(
                    {
                        "type": "tool_call",
                        "tool": "vec_search",
                        "query": vec_query[:2000],
                        "attempt": state.retrieve_attempts,
                    }
                )
                element_ids = await llm_service.vector_search_elements(
                    deps.project_id,
                    vec_query,
                    top_k=12 if not broaden else 20,
                    element_types=["dialogue", "character", "action", "scene-heading"],
                )
                await emit({"type": "tool_result", "tool": "vec_search", "count": len(element_ids)})

                # 2) Fallback: keyword search
                if not element_ids:
                    await emit(
                        {
                            "type": "tool_call",
                            "tool": "db_search",
                            "query": terms,
                            "attempt": state.retrieve_attempts,
                        }
                    )
                    element_ids = await llm_service._query_elements_by_search(
                        deps.project_id,
                        terms,
                        element_types=["dialogue", "character", "action", "scene-heading"],
                    )
                    await emit({"type": "tool_result", "tool": "db_search", "count": len(element_ids)})

                if element_ids:
                    await emit({"type": "tool_call", "tool": "db_extract_context", "count": len(element_ids)})
                    ctx, error_msg = await llm_service._extract_element_context(
                        deps.project_id,
                        element_ids[:25],
                        context_size=3,
                    )
                    if ctx:
                        state.retrieved_context = ctx
                        await emit({"type": "tool_result", "tool": "db_extract_context", "ok": True})
                        await emit({"type": "status", "message": f"[Reading] Loaded {len(element_ids)} relevant elements"})
                        continue
                    await emit({"type": "tool_result", "tool": "db_extract_context", "ok": False, "error": error_msg or "no rows"})

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


