from __future__ import annotations

import json
import logging
import asyncio
from typing import Any, Awaitable, Callable, Dict, List, Optional, Union

logger = logging.getLogger(__name__)


def format_status_text(message: str) -> str:
    """Legacy progress output: plain text line."""
    return message + "\n"


def format_buffer_item(buffer_item: Any, stream_events: bool) -> Optional[str]:
    """Format a buffered stream item for output."""
    if stream_events:
        return json.dumps(buffer_item)

    if not isinstance(buffer_item, dict):
        return None

    evt_type = buffer_item.get("type")

    if evt_type == "status":
        msg = buffer_item.get("message") or ""
        if msg:
            return format_status_text(str(msg))
        return None

    if evt_type == "plan_updated":
        plan = buffer_item.get("plan") or {}
        todos = plan.get("todos") if isinstance(plan, dict) else []
        if isinstance(todos, list) and todos:
            labels = []
            for t in todos[:8]:
                if isinstance(t, dict) and t.get("title"):
                    status = t.get("status", "pending")
                    labels.append(f"{t.get('title')} ({status})")
            if labels:
                return format_status_text("[Plan] " + " → ".join(labels))
        summary = plan.get("summary") if isinstance(plan, dict) else ""
        if summary:
            return format_status_text(f"[Plan] {summary}")
        return None

    if evt_type == "plan_todos":
        todos = buffer_item.get("todos") or []
        if isinstance(todos, list) and todos:
            labels = []
            for t in todos[:8]:
                if isinstance(t, dict) and t.get("label"):
                    labels.append(str(t.get("label")))
            if labels:
                return format_status_text("[Plan] " + " → ".join(labels))
        return None

    if evt_type == "todo_update":
        tid = buffer_item.get("id") or ""
        status = buffer_item.get("status") or ""
        label = buffer_item.get("label") or tid
        if tid and status:
            return format_status_text(f"[Todo] {label}: {status}")
        return None

    if evt_type == "apply_started":
        label = buffer_item.get("label") or "Applying edits"
        element_ids = buffer_item.get("elementIds") or []
        count = len(element_ids) if isinstance(element_ids, list) else 0
        return format_status_text(f"[Applying] {label} ({count} elements)")

    if evt_type == "apply_done":
        return format_status_text("[Applying] Done")

    if evt_type == "text_delta":
        content = buffer_item.get("content") or ""
        return content if content else None

    return None


def format_final_payload(
    stream_events: bool,
    *,
    applied_edits: Optional[Dict[str, Any]] = None,
    beat_ops: Optional[List[Dict[str, Any]]] = None,
    content: Optional[str] = None,
) -> str:
    """Format final payload for chat output (edits, beat ops, and/or text)."""
    if stream_events:
        payload: Dict[str, Any] = {"type": "final"}
        if applied_edits:
            payload["edits"] = applied_edits
        if beat_ops:
            payload["beatOps"] = {"ops": beat_ops}
        if content:
            payload["content"] = content
        return json.dumps(payload)

    legacy: Dict[str, Any] = {}
    if applied_edits:
        legacy.update(applied_edits)
    if beat_ops:
        legacy["ops"] = beat_ops
    if content and not legacy:
        return content
    return json.dumps(legacy)


EmitFn = Callable[[Dict[str, Any]], Awaitable[None]]

TOOL_STATUS_START: Dict[str, str] = {
    "update_plan": "[Planning] Updating plan",
    "web_search": "[Searching] Searching the web",
    "code_interpreter": "[Computing] Running Python analysis",
    "search_screenplay": "[Searching] Querying screenplay",
    "list_scenes": "[Scenes] Listing scene headings",
    "find_character_scenes": "[Scenes] Finding character scenes",
    "load_elements": "[Loading] Fetching element context",
    "submit_edits": "[Editing] Submitting edits",
    "verify_edits": "[Verifying] Checking edits",
    "manage_beats": "[Beats] Processing beat operations",
    "count_elements": "[Counting] Querying element counts",
}

TOOL_STATUS_DONE: Dict[str, str] = {
    "update_plan": "[Planning] Plan updated",
    "web_search": "[Searching] Web search complete",
    "code_interpreter": "[Computing] Analysis complete",
    "search_screenplay": "[Searching] Done",
    "list_scenes": "[Scenes] Scene list ready",
    "find_character_scenes": "[Scenes] Character scenes found",
    "load_elements": "[Loading] Context loaded",
    "submit_edits": "[Editing] Edits submitted",
    "verify_edits": "[Verifying] Verification complete",
    "manage_beats": "[Beats] Operations complete",
    "count_elements": "[Counting] Done",
}


def _tool_name_from_call_item(item: Any) -> str:
    name = getattr(item, "tool_name", None)
    if name:
        return str(name)
    raw = getattr(item, "raw_item", None)
    if raw is not None:
        if isinstance(raw, dict):
            return str(raw.get("name") or raw.get("type") or "unknown")
        return str(getattr(raw, "name", None) or getattr(raw, "type", None) or "unknown")
    return "unknown"


def _tool_call_id_from_item(item: Any) -> str:
    call_id = getattr(item, "call_id", None)
    if call_id:
        return str(call_id)
    raw = getattr(item, "raw_item", None)
    if raw is not None:
        if isinstance(raw, dict):
            cid = raw.get("call_id") or raw.get("id")
            return str(cid) if cid is not None else ""
        cid = getattr(raw, "call_id", None) or getattr(raw, "id", None)
        return str(cid) if cid is not None else ""
    return ""


def _extract_submit_edit_ids(item: Any) -> List[str]:
    raw = getattr(item, "raw_item", None)
    args: Any = None
    if raw is not None:
        if isinstance(raw, dict):
            args = raw.get("arguments")
        else:
            args = getattr(raw, "arguments", None)
    if not args:
        return []
    try:
        parsed = json.loads(args) if isinstance(args, str) else args
        edits_list = parsed.get("edits", []) if isinstance(parsed, dict) else []
        return [
            str(e.get("elementId", ""))
            for e in edits_list
            if isinstance(e, dict) and e.get("elementId")
        ]
    except Exception:
        return []


def _plan_event_payload(plan: Any) -> Dict[str, Any]:
    if hasattr(plan, "model_dump"):
        return plan.model_dump()
    if isinstance(plan, dict):
        return plan
    return {}


async def _emit_plan_updated(plan: Any, emit: EmitFn) -> None:
    payload = _plan_event_payload(plan)
    if not payload:
        return
    await emit({"type": "plan_updated", "plan": payload})
    # Legacy checklist events for older clients.
    todos = payload.get("todos") or []
    if isinstance(todos, list) and todos:
        await emit({
            "type": "plan_todos",
            "todos": [
                {
                    "id": str(t.get("id", "")),
                    "label": str(t.get("title") or t.get("label") or ""),
                    "status": str(t.get("status", "pending")),
                }
                for t in todos
                if isinstance(t, dict) and t.get("id")
            ],
        })


async def run_unified_agent_streaming(
    agent: Any,
    agent_input: Union[str, List[Any]],
    *,
    context: Any,
    emit: EmitFn,
    max_turns: int = 15,
    trace_metadata: Optional[Dict[str, Any]] = None,
) -> str:
    """Run the unified screenplay agent and translate OpenAI Agents SDK events."""
    from agents import ItemHelpers, Runner
    from agents.stream_events import AgentUpdatedStreamEvent, RawResponsesStreamEvent, RunItemStreamEvent
    from openai.types.responses.response_text_delta_event import ResponseTextDeltaEvent

    await emit({"type": "status", "message": "[Start] Processing request"})

    final_output: str = ""
    _pending_tools: Dict[str, str] = {}
    _tool_call_count = 0
    _streamed_text_deltas = False
    result: Any = None

    try:
        result = Runner.run_streamed(
            agent,
            input=agent_input,
            context=context,
            max_turns=max_turns,
        )

        try:
            async for event in result.stream_events():
                try:
                    if isinstance(event, RawResponsesStreamEvent):
                        if isinstance(event.data, ResponseTextDeltaEvent):
                            delta = event.data.delta or ""
                            if delta:
                                _streamed_text_deltas = True
                                await emit({"type": "text_delta", "content": delta})

                    elif isinstance(event, RunItemStreamEvent):
                        item = event.item
                        item_type = getattr(item, "type", "")

                        if item_type == "tool_call_item":
                            tool_name = _tool_name_from_call_item(item)
                            tool_call_id = _tool_call_id_from_item(item)
                            if tool_call_id:
                                _pending_tools[tool_call_id] = tool_name
                            _tool_call_count += 1

                            call_evt: Dict[str, Any] = {
                                "type": "tool_call",
                                "tool": tool_name,
                                "tool_call_id": tool_call_id,
                            }
                            raw = getattr(item, "raw_item", None)
                            args_str = ""
                            if raw is not None:
                                args_str = str(
                                    raw.get("arguments") if isinstance(raw, dict) else getattr(raw, "arguments", "")
                                )
                            if args_str and len(args_str) < 4000:
                                call_evt["payload"] = args_str
                            await emit(call_evt)

                            if tool_name == "submit_edits":
                                await emit({
                                    "type": "apply_started",
                                    "elementIds": _extract_submit_edit_ids(item),
                                    "label": "Applying edits",
                                })

                            if tool_name in TOOL_STATUS_START:
                                await emit({"type": "status", "message": TOOL_STATUS_START[tool_name]})

                        elif item_type == "tool_call_output_item":
                            tool_call_id = _tool_call_id_from_item(item)
                            tool_name = _pending_tools.pop(tool_call_id, "unknown")

                            result_evt: Dict[str, Any] = {
                                "type": "tool_result",
                                "tool": tool_name,
                                "tool_call_id": tool_call_id,
                            }
                            output = getattr(item, "output", None)
                            if output is not None:
                                result_evt["result_preview"] = str(output)[:800]
                            await emit(result_evt)

                            if tool_name == "submit_edits":
                                await emit({"type": "apply_done"})

                            if tool_name in TOOL_STATUS_DONE:
                                await emit({"type": "status", "message": TOOL_STATUS_DONE[tool_name]})

                            if tool_name == "update_plan":
                                plan = getattr(context, "_plan", None)
                                if plan is not None:
                                    await _emit_plan_updated(plan, emit)

                        elif item_type == "message_output_item":
                            # Avoid duplicating text already streamed via ResponseTextDeltaEvent.
                            if not _streamed_text_deltas:
                                text = ItemHelpers.text_message_output(item)
                                if text:
                                    await emit({"type": "text_delta", "content": text})

                    elif isinstance(event, AgentUpdatedStreamEvent):
                        await emit({
                            "type": "status",
                            "message": f"[Agent] Switched to {event.new_agent.name}",
                        })

                except Exception as inner_e:
                    logger.warning(f"[streaming] event error: {inner_e}")
        except asyncio.CancelledError:
            if result is not None and hasattr(result, "cancel"):
                try:
                    result.cancel()
                except Exception as cancel_e:
                    logger.warning(f"[streaming] agent cancel failed: {cancel_e}")
            logger.info("[streaming] agent run cancelled")
            raise

        if result is not None:
            if result.final_output is not None:
                final_output = str(result.final_output)
            elif result.is_complete:
                for item in reversed(getattr(result, "new_items", []) or []):
                    if getattr(item, "type", "") == "message_output_item":
                        text = ItemHelpers.text_message_output(item)
                        if text:
                            final_output = text
                            break

    except Exception as run_e:
        logger.exception(f"[streaming] agent run failed: {run_e}")
        raise

    try:
        from services.observability.langfuse_client import langfuse_client

        run_items = getattr(result, "new_items", None) if result is not None else None
        if run_items:
            langfuse_client.log_agent_run(
                input_prompt=_input_preview(agent_input),
                output_text=final_output,
                run_items=run_items,
                metadata=trace_metadata,
                tags=trace_metadata.get("tags") if trace_metadata else None,
            )
    except Exception as lf_err:
        logger.warning(f"[streaming] Langfuse logging failed: {lf_err}")

    await emit({
        "type": "agent_done",
        "tool_calls": _tool_call_count,
        "has_output": bool(final_output),
    })

    if not final_output:
        final_output = "I couldn't complete the request. Please try again."

    return final_output


def _input_preview(agent_input: Union[str, List[Any]]) -> str:
    if isinstance(agent_input, str):
        return agent_input
    for item in reversed(agent_input):
        if isinstance(item, dict) and item.get("role") == "user":
            return str(item.get("content", ""))
    return str(agent_input)
