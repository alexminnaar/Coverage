from __future__ import annotations

import json
from typing import Any, Dict, Optional


def format_status_text(message: str) -> str:
    """Legacy progress output: plain text line.

    This is rendered as normal assistant text by older clients.
    """
    return message + "\n"


def format_buffer_item(buffer_item: Any, stream_events: bool) -> Optional[str]:
    """Format a buffered stream item for output.

    Typed events (stream_events=True)
    - Emit a single JSON object per yield.
    - Common event types:
      - status: {\"type\":\"status\",\"message\":\"...\"}
      - decision: {\"type\":\"decision\",\"action\":\"...\",\"why\":\"...\"}
      - tool_call/tool_result: structured tool telemetry
      - apply_started/apply_done: UI \"Edit …\" phase markers

    Legacy (stream_events=False)
    - Emit *only* plain-text progress lines (status-like events).
    - Final payload is handled separately via `format_final_payload`.
    """
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

    # Minimal legacy mapping for apply markers so old clients still see \"editing\" progress.
    if evt_type == "apply_started":
        label = buffer_item.get("label") or "Applying edits"
        element_ids = buffer_item.get("elementIds") or []
        count = len(element_ids) if isinstance(element_ids, list) else 0
        return format_status_text(f"[Applying] {label} ({count} elements)")

    if evt_type == "apply_done":
        return format_status_text("[Applying] Done")

    return None


def format_final_payload(applied_edits: Dict[str, Any], stream_events: bool) -> str:
    """Format final edits payload for output.

    - stream_events=True: typed wrapper {\"type\":\"final\",\"edits\":{...}}
    - stream_events=False: raw {\"edits\":[...]} object
    """
    if stream_events:
        return json.dumps({"type": "final", "edits": applied_edits})
    return json.dumps(applied_edits)


