"""
Lightweight helpers extracted from the old beat_loop.py.

Only ``BeatLoopState`` and ``build_beat_context`` are preserved — just enough
to build the beat-board context string that the unified agent needs.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class BeatLoopState:
    question: str
    beats: List[Dict[str, Any]]
    act_names: List[str]
    selected_beat_id: Optional[str] = None
    scenes: List[Dict[str, Any]] = field(default_factory=list)
    message_history: list[Any] = field(default_factory=list)


def _truncate(text: str, max_len: int = 180) -> str:
    if not text:
        return ""
    return text if len(text) <= max_len else f"{text[:max_len]}…"


def build_beat_context(state: BeatLoopState) -> str:
    """Build beat board context string from structured data."""
    lines: List[str] = []

    lines.append("Beat Board Context:")
    for act_index, act_name in enumerate(state.act_names):
        lines.append(f"ACT {act_index + 1}: {act_name}")
        act_beats = [b for b in state.beats if b.get("actIndex") == act_index]
        act_beats = sorted(act_beats, key=lambda b: b.get("order", 0))[:25]

        for idx, beat in enumerate(act_beats):
            marker = "*FOCUS* " if beat.get("id") == state.selected_beat_id else ""
            beat_id = beat.get("id", "")
            title = beat.get("title", "Untitled")
            desc = _truncate(beat.get("description", ""), 140)
            lines.append(f"{marker}#{idx + 1} [id={beat_id}] {title} — {desc}")

        if len([b for b in state.beats if b.get("actIndex") == act_index]) > len(act_beats):
            lines.append("… (more beats not shown)")
        lines.append("")

    # Selected beat details
    if state.selected_beat_id:
        selected_beat = next((b for b in state.beats if b.get("id") == state.selected_beat_id), None)
        if selected_beat:
            lines.append("Selected Beat Details:")
            lines.append(f"id: {selected_beat.get('id', '')}")
            lines.append(f"actIndex: {selected_beat.get('actIndex', 0)}")
            lines.append(f"order: {selected_beat.get('order', 0)}")
            lines.append(f"title: {selected_beat.get('title', 'Untitled beat')}")
            lines.append(f"description: {selected_beat.get('description', '(empty)')}")
            if selected_beat.get("color"):
                lines.append(f"color: {selected_beat.get('color')}")
            linked_scene_id = selected_beat.get("linkedSceneId")
            if linked_scene_id:
                scene = next((s for s in state.scenes if s.get("id") == linked_scene_id), None)
                if scene:
                    lines.append(f"linkedScene: {scene.get('name', '')}")
            lines.append("")

    # Optional scene headings for linking
    if state.scenes:
        lines.append("Scene Headings (optional; for linking only):")
        limited_scenes = state.scenes[:15]
        scene_list = " | ".join(f"[id={s.get('id', '')}] {s.get('name', '')}" for s in limited_scenes)
        lines.append(scene_list)
        if len(state.scenes) > len(limited_scenes):
            lines.append("… (more scenes not shown)")
        lines.append("")

    # Schema example
    lines.append("Return ONLY one JSON object. Prefer this schema:")
    example = {
        "ops": [
            {
                "op": "update",
                "id": "existing-beat-id",
                "updates": {"title": "...", "description": "...", "linkedSceneId": "optional", "color": "#hex-optional"},
                "reason": "optional",
            },
            {
                "op": "create",
                "actIndex": 1,
                "insertAfterOrder": 2,
                "beat": {"title": "...", "description": "...", "linkedSceneId": "optional", "color": "#hex-optional"},
                "reason": "optional",
            },
            {"op": "move", "id": "existing-beat-id", "targetActIndex": 1, "targetOrder": 0, "reason": "optional"},
            {"op": "delete", "id": "existing-beat-id", "reason": "optional"},
        ],
        "notes": "optional short plain text",
    }
    lines.append(json.dumps(example, indent=2))
    lines.append("")
    lines.append("Rules:")
    lines.append("- Output MUST be valid JSON only (no prose).")
    lines.append("- Use existing beat ids when updating/moving/deleting.")
    lines.append("- Keep descriptions 1-2 sentences.")
    lines.append("- Do not invent scene ids; only use the scene ids provided above.")
    lines.append("- Keep ops to <= 12. If you need more, summarize in notes.")

    return "\n".join(lines)

