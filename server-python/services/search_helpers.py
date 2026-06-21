from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, Sequence

_TSQUERY_SPECIAL = re.compile(r"[&|!():*'\"\\]")


def normalize_search_terms(terms: List[str], *, max_terms: int = 8) -> List[str]:
    """Clean and dedupe agent-provided search terms."""
    seen: set[str] = set()
    out: List[str] = []
    for raw in terms:
        term = " ".join(str(raw).split()).strip()
        if len(term) < 2:
            continue
        key = term.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(term)
        if len(out) >= max_terms:
            break
    return out


def build_tsquery(terms: List[str], match_mode: str = "any") -> str:
    """Build a Postgres tsquery string from search terms."""
    parts: List[str] = []
    for term in terms:
        safe = _TSQUERY_SPECIAL.sub(" ", term).strip()
        if not safe:
            continue
        words = [w for w in safe.split() if w]
        if not words:
            continue
        if len(words) == 1:
            parts.append(words[0])
        else:
            parts.append(" & ".join(words))
    if not parts:
        return ""
    joiner = " | " if match_mode != "all" else " & "
    return joiner.join(parts)


def make_snippet(content: str, terms: List[str], max_len: int = 120) -> str:
    """Return a short excerpt centered on the first matching term."""
    text = " ".join((content or "").split())
    if not text:
        return ""
    if len(text) <= max_len:
        return text

    lower = text.lower()
    for term in terms:
        pos = lower.find(term.lower())
        if pos < 0:
            continue
        half = max_len // 2
        start = max(0, pos - half)
        end = min(len(text), start + max_len)
        if end - start < max_len:
            start = max(0, end - max_len)
        snippet = text[start:end]
        if start > 0:
            snippet = f"…{snippet}"
        if end < len(text):
            snippet = f"{snippet}…"
        return snippet

    return f"{text[: max_len - 1]}…"


def format_search_hits_grouped(
    hits: Sequence[Any],
    scene_by_element_id: Mapping[str, Mapping[str, Any]],
    *,
    terms: List[str],
    mode: str,
    type_filter: List[str],
) -> str:
    """Format search hits grouped by parent scene heading."""
    if not hits:
        return ""

    groups: Dict[str, List[Any]] = {}
    group_labels: Dict[str, str] = {}

    for hit in hits:
        if isinstance(hit, dict):
            eid = str(hit.get("element_id", ""))
            etype = str(hit.get("element_type", ""))
        else:
            eid = str(getattr(hit, "element_id", ""))
            etype = str(getattr(hit, "element_type", ""))
        meta = scene_by_element_id.get(eid) or {}
        scene_id = str(meta.get("scene_id") or meta.get("sceneId") or "")
        scene_heading = str(meta.get("scene_heading") or meta.get("sceneHeading") or "").strip()
        if etype == "scene-heading":
            if isinstance(hit, dict):
                content = str(hit.get("content", "")).strip()
            else:
                content = str(getattr(hit, "content", "")).strip()
            scene_heading = scene_heading or content
            scene_id = scene_id or eid

        key = scene_id or scene_heading or "unknown"
        if key not in groups:
            label = scene_heading or "Unknown scene"
            if scene_id:
                label = f"{label} (sceneId={scene_id})"
            group_labels[key] = label
        groups.setdefault(key, []).append(hit)

    lines: List[str] = [
        f"Found {len(hits)} match(es) in {len(groups)} scene(s) for terms={terms} "
        f"(mode={mode}, types={type_filter}):",
        "",
    ]

    item_num = 1
    for key, group_hits in groups.items():
        lines.append(f"## {group_labels.get(key, 'Unknown scene')}")
        for hit in group_hits:
            if isinstance(hit, dict):
                etype = str(hit.get("element_type", ""))
                eid = str(hit.get("element_id", ""))
                idx = hit.get("element_index", "")
                snippet = str(hit.get("snippet", ""))
            else:
                etype = str(getattr(hit, "element_type", ""))
                eid = str(getattr(hit, "element_id", ""))
                idx = getattr(hit, "element_index", "")
                snippet = str(getattr(hit, "snippet", ""))
            lines.append(f"  {item_num}. [{etype}] id={eid} idx={idx} — \"{snippet}\"")
            item_num += 1
        lines.append("")

    if len(hits) >= 20:
        lines.append("Many results — narrow with match_mode=\"all\" or more specific terms.")
        lines.append("")

    lines.extend(
        [
            "Next: call load_elements with the relevant IDs for full context.",
            "If results look wrong, call search_screenplay again with different terms.",
            "Use list_scenes to browse scene headings when you need an overview.",
        ]
    )
    return "\n".join(lines)

