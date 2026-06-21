"""
Unified screenplay agent.

A single OpenAI Agents SDK tool-calling agent that handles ask, edit, and beat
requests.  The LLM decides which tools to call and in what order.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional

from agents import (
    Agent,
    CodeInterpreterTool,
    RunContextWrapper,
    WebSearchTool,
    function_tool,
)

from services.edit_types import (
    BeatOperationInput,
    EditProposalInput,
    ScreenplayDeps,
)
from services.plan_types import PlanState, TodoStatus
from services.prompts import UNIFIED_SYSTEM_PROMPT

logger = logging.getLogger(__name__)

UUID_RE = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
    re.I,
)



def _dynamic_instructions(
    ctx: RunContextWrapper[ScreenplayDeps],
    agent: Agent[ScreenplayDeps],
) -> str:
    parts = [UNIFIED_SYSTEM_PROMPT]
    deps = ctx.context
    if deps.selected_text:
        parts.append(f"## Selected text\n{deps.selected_text}")
    if deps.selected_element_id:
        parts.append(f"Selected element ID: {deps.selected_element_id}")
    if deps.global_index:
        parts.append(f"## Global index (scene list + characters)\n{deps.global_index}")
    if deps.scene_context:
        parts.append(f"## Scene context (local excerpt around cursor)\n{deps.scene_context}")
    if deps.beat_context:
        parts.append(f"## Beat board context\n{deps.beat_context}")
    if deps._plan is not None:
        parts.append(
            "## Current plan (maintain via update_plan)\n"
            + json.dumps(deps._plan.model_dump(), indent=2)
        )
    return "\n\n".join(parts)


@function_tool
async def search_screenplay(
    wrapper: RunContextWrapper[ScreenplayDeps],
    search_terms: List[str],
    match_mode: str = "any",
    element_types: Optional[List[str]] = None,
) -> str:
    """Search the screenplay for elements matching specific text terms.

    Args:
        search_terms: Keywords YOU choose (character names, locations, phrases, props).
                      Provide 1–8 terms. Call again with different terms if results are poor.
        match_mode: "any" (default) matches elements containing at least one term;
                    "all" requires every term to appear in the same element.
        element_types: Optional filter, e.g. ["dialogue", "scene-heading", "action", "character"].

    Returns matching element IDs with snippets and guidance for refining the search.
    """
    from services.db_service import DBService
    from services.search_helpers import format_search_hits_grouped, normalize_search_terms

    deps = wrapper.context
    terms = normalize_search_terms(search_terms)
    if not terms:
        return (
            "No valid search terms provided. Pass 1–8 specific terms "
            "(character names, locations, quoted phrases, scene keywords)."
        )

    mode = "all" if match_mode == "all" else "any"
    type_filter = element_types or ["dialogue", "character", "action", "scene-heading"]

    hits = []
    if deps.project_id and deps.db_pool:
        try:
            db = DBService()
            db.pool = deps.db_pool
            hits = await db.search_elements(
                deps.project_id,
                terms=terms,
                match_mode=mode,
                element_types=type_filter,
                limit=25,
            )
        except Exception as e:
            logger.warning(f"[screenplay_agent] search failed: {e}")
            return f"Search error: {type(e).__name__}: {e}. Try simpler terms or call list_scenes / find_character_scenes."

    if not hits:
        tips = [
            "0 results — try broader terms: synonyms, character/location names, or fewer words.",
            "Try match_mode=\"any\" instead of \"all\".",
            "Remove element_types filter to search all element types.",
        ]
        if deps.scene_context:
            ids_in_ctx = UUID_RE.findall(deps.scene_context)
            if ids_in_ctx:
                return (
                    f"No matches for terms {terms} (mode={mode}, types={type_filter}).\n\n"
                    + "\n".join(f"- {t}" for t in tips)
                    + f"\n\nScene context contains {len(ids_in_ctx)} element(s) — "
                    "use load_elements with IDs from scene context to inspect nearby content."
                )
        return (
            f"No matches for terms {terms} (mode={mode}, types={type_filter}).\n\n"
            + "\n".join(f"- {t}" for t in tips)
            + "\n- Try list_scenes to browse scene headings, then search within a scene."
        )

    scene_by_id: Dict[str, Dict[str, Any]] = {}
    if deps.project_id and deps.db_pool:
        try:
            db = DBService()
            db.pool = deps.db_pool
            enriched = await db.fetch_elements_by_ids(
                deps.project_id, [h.element_id for h in hits]
            )
            scene_by_id = {str(el["element_id"]): el for el in enriched}
        except Exception as e:
            logger.warning(f"[screenplay_agent] scene enrichment failed: {e}")

    return format_search_hits_grouped(
        hits,
        scene_by_id,
        terms=terms,
        mode=mode,
        type_filter=type_filter,
    )


@function_tool
async def list_scenes(
    wrapper: RunContextWrapper[ScreenplayDeps],
    search_terms: Optional[List[str]] = None,
) -> str:
    """List scene headings in script order.

    Args:
        search_terms: Optional keywords to filter scene headings (location, time of day, etc.).
                      Omit to list all scenes.

    Returns scene numbers, element IDs, and headings. Use IDs with load_elements to read a scene.
    """
    from services.db_service import DBService
    from services.search_helpers import normalize_search_terms

    deps = wrapper.context
    if not deps.project_id or not deps.db_pool:
        return "Cannot list scenes: no project or database available."

    terms = normalize_search_terms(search_terms or []) if search_terms else None

    try:
        db = DBService()
        db.pool = deps.db_pool
        scenes = await db.list_scenes(
            deps.project_id,
            search_terms=terms,
            limit=50,
        )
    except Exception as e:
        logger.warning(f"[screenplay_agent] list_scenes failed: {e}")
        return f"Error listing scenes: {e}"

    if not scenes:
        if terms:
            return (
                f"No scene headings matched {terms}. "
                "Try broader location keywords or call list_scenes without filters."
            )
        return "No scene headings found in this project."

    lines = [f"Found {len(scenes)} scene(s):"]
    for scene in scenes:
        heading = scene.heading.strip() or "Untitled scene"
        lines.append(
            f"  {scene.scene_number}. id={scene.element_id} idx={scene.element_index} — {heading}"
        )
    lines.append("")
    lines.append("Use load_elements with a scene heading id to load that scene's content.")
    if terms:
        lines.append("Remove search_terms to see the full scene list.")
    return "\n".join(lines)


@function_tool
async def find_character_scenes(
    wrapper: RunContextWrapper[ScreenplayDeps],
    character_terms: List[str],
) -> str:
    """List scenes where a character appears (on-screen or V.O.).

    Args:
        character_terms: Name variants to match, e.g. ["ARNOLD", "BENEDICT", "BENEDICT (V.O.)"].
                         Use ALL spelling variants you know (screenplay character slug vs. prose name).

    Returns a de-duplicated scene list in script order with match counts and sample lines.
    Prefer this over search_screenplay when the user asks which scenes feature a character.
    """
    from services.db_service import DBService
    from services.search_helpers import normalize_search_terms

    deps = wrapper.context
    terms = normalize_search_terms(character_terms)
    if not terms:
        return "Provide 1–8 character name variants (e.g. ARNOLD, BENEDICT, BENEDICT (V.O.))."

    if not deps.project_id or not deps.db_pool:
        return "Cannot find character scenes: no project or database available."

    try:
        db = DBService()
        db.pool = deps.db_pool
        scenes = await db.find_character_scenes(deps.project_id, terms)
    except Exception as e:
        logger.warning(f"[screenplay_agent] find_character_scenes failed: {e}")
        return f"Character scene lookup error: {type(e).__name__}: {e}"

    if not scenes:
        return (
            f"No scenes found for terms {terms}.\n"
            "- Try alternate spellings (ARNOLD vs BENEDICT vs BENEDICT (V.O.))\n"
            "- Try search_screenplay with broader terms\n"
            "- Use list_scenes to browse all scene headings"
        )

    lines = [f"Found {len(scenes)} scene(s) with matches for {terms}:"]
    for scene in scenes:
        num = scene.scene_number or "?"
        lines.append(
            f"  Scene {num}. id={scene.scene_id} idx={scene.element_index} — "
            f"{scene.heading} ({scene.match_count} match(es))"
        )
        for sample in scene.sample_matches:
            lines.append(f"      • {sample}")
    lines.append("")
    lines.append("Use load_elements with a scene heading id to read full scene content.")
    return "\n".join(lines)


@function_tool
async def load_elements(
    wrapper: RunContextWrapper[ScreenplayDeps],
    element_ids: List[str],
    context_size: int = 3,
) -> str:
    """Load full content and surrounding context for specific element IDs.

    Args:
        element_ids: List of element UUIDs (from search_screenplay results).
        context_size: Number of surrounding elements to include (default 3).

    Returns formatted screenplay context with element IDs, types, and content.
    """
    deps = wrapper.context
    if not element_ids:
        return "No element IDs provided."

    element_ids = element_ids[:25]

    if deps.project_id and deps.db_pool:
        try:
            from services.db_service import DBService

            db = DBService()
            db.pool = deps.db_pool
            context_str, error = await db.extract_element_context(
                deps.project_id, element_ids, context_size
            )
            if context_str:
                return context_str
            if error:
                return f"Could not load elements: {error}"
        except Exception as e:
            logger.warning(f"[screenplay_agent] load_elements DB failed: {e}")

    if deps.scene_context:
        found: List[str] = []
        for eid in element_ids:
            if eid in deps.scene_context:
                found.append(eid)
        if found:
            return (
                f"Database unavailable. {len(found)}/{len(element_ids)} element(s) "
                f"are present in the current scene context window.\n\n"
                f"Scene context:\n{deps.scene_context}"
            )

    return "Could not load elements: no database available and IDs not in scene context."


@function_tool
async def submit_edits(
    wrapper: RunContextWrapper[ScreenplayDeps],
    edits: List[EditProposalInput],
) -> str:
    """Submit structured edit proposals for validation.

    Each edit dict must have:
      - elementId: exact UUID from loaded context
      - elementType: action|dialogue|character|scene-heading|parenthetical|transition
      - originalContent: verbatim current text
      - newContent: replacement text
      - reason: short explanation
      - newElements (optional): list of {type, content} to insert after this element

    Returns a validation summary.  If issues are found, fix them and call
    submit_edits again.
    """
    deps = wrapper.context

    if not edits:
        return "No edits provided."

    issues: List[str] = []

    edit_dicts = [e.model_dump(exclude_none=True) for e in edits]

    for i, edit in enumerate(edit_dicts):
        eid = edit.get("elementId", "")
        if not eid:
            issues.append(f"Edit {i}: missing elementId")
        if not edit.get("newContent") and edit.get("newContent") != "":
            issues.append(f"Edit {i} ({eid}): missing newContent")
        if not edit.get("originalContent") and edit.get("originalContent") != "":
            issues.append(f"Edit {i} ({eid}): missing originalContent")
        new_elems = edit.get("newElements")
        if new_elems is not None:
            if not isinstance(new_elems, list):
                issues.append(f"Edit {i} ({eid}): newElements must be a list")
            else:
                for j, ne in enumerate(new_elems):
                    if not isinstance(ne, dict) or "type" not in ne or "content" not in ne:
                        issues.append(
                            f"Edit {i} ({eid}): newElements[{j}] must have 'type' and 'content'"
                        )

    if deps.project_id and deps.db_pool and not issues:
        try:
            from services.db_service import DBService

            db = DBService()
            db.pool = deps.db_pool
            eids = [e.get("elementId", "") for e in edit_dicts if e.get("elementId")]
            if eids:
                verified = await db.verify_element_ids(deps.project_id, eids)
                invalid = [eid for eid, ok in verified.items() if not ok]
                if invalid:
                    issues.append(f"Invalid element IDs (not found in DB): {', '.join(invalid)}")
        except Exception as e:
            logger.warning(f"[screenplay_agent] DB verify failed: {e}")

    if issues:
        return "Validation FAILED:\n- " + "\n- ".join(issues)

    deps._submitted_edits = [
        {
            "elementId": str(e.get("elementId", "")),
            "elementType": str(e.get("elementType", "")),
            "originalContent": str(e.get("originalContent", "")),
            "newContent": str(e.get("newContent", "")),
            **({"reason": e.get("reason")} if e.get("reason") is not None else {}),
            **({"newElements": e.get("newElements")} if e.get("newElements") is not None else {}),
        }
        for e in edit_dicts
    ]

    return (
        f"Edits validated and submitted successfully ({len(edit_dicts)} edit(s)).\n"
        "You can now explain the changes to the user."
    )


@function_tool
async def verify_edits(wrapper: RunContextWrapper[ScreenplayDeps]) -> str:
    """Run additional verification on the most recently submitted edits.

    Checks element ID existence, content matching, and formatting.
    Returns issues or a confirmation that edits look good.
    """
    deps = wrapper.context

    if not deps._submitted_edits:
        return "No edits have been submitted yet. Call submit_edits first."

    issues: List[str] = []
    edits = deps._submitted_edits

    valid_types = {"action", "dialogue", "character", "scene-heading", "parenthetical", "transition"}
    for i, e in enumerate(edits):
        etype = e.get("elementType", "")
        if etype and etype not in valid_types:
            issues.append(f"Edit {i}: invalid elementType '{etype}'")
        if e.get("newContent", "") == e.get("originalContent", "") and not e.get("newElements"):
            issues.append(f"Edit {i}: no-op (newContent == originalContent and no newElements)")

    if deps.project_id and deps.db_pool:
        try:
            from services.db_service import DBService

            db = DBService()
            db.pool = deps.db_pool
            eids = [e.get("elementId", "") for e in edits if e.get("elementId")]
            if eids:
                verified = await db.verify_element_ids(deps.project_id, eids)
                invalid = [eid for eid, ok in verified.items() if not ok]
                if invalid:
                    issues.append(f"Invalid element IDs: {', '.join(invalid)}")
        except Exception as e:
            logger.warning(f"[screenplay_agent] verify DB check failed: {e}")

    if issues:
        return "Verification found issues:\n- " + "\n- ".join(issues)
    return f"All {len(edits)} edit(s) verified successfully. No issues found."


@function_tool
async def manage_beats(
    wrapper: RunContextWrapper[ScreenplayDeps],
    operations: List[BeatOperationInput],
) -> str:
    """Create, update, delete, or move beats on the beat board.

    Each operation dict must have:
      - op: "create" | "update" | "delete" | "move"
      - For create: actIndex, insertAfterOrder, beat: {title, description, ...}
      - For update: id, updates: {title?, description?, color?, linkedSceneId?}
      - For delete: id
      - For move: id, targetActIndex, targetOrder

    Returns a validation summary.
    """
    deps = wrapper.context

    if not operations:
        return "No operations provided."

    valid_ops = {"create", "update", "delete", "move"}
    issues: List[str] = []
    op_dicts = [o.model_dump(exclude_none=True) for o in operations]

    for i, op in enumerate(op_dicts):
        op_type = op.get("op", "")
        if op_type not in valid_ops:
            issues.append(f"Op {i}: invalid op '{op_type}'. Must be one of: {', '.join(valid_ops)}")
            continue
        if op_type == "create":
            if "actIndex" not in op:
                issues.append(f"Op {i} (create): missing actIndex")
            beat = op.get("beat", {})
            if not isinstance(beat, dict) or not beat.get("title"):
                issues.append(f"Op {i} (create): beat must have a title")
        elif op_type in ("update", "delete", "move"):
            if not op.get("id"):
                issues.append(f"Op {i} ({op_type}): missing id")
        if op_type == "move":
            if "targetActIndex" not in op:
                issues.append(f"Op {i} (move): missing targetActIndex")

    if issues:
        return "Validation FAILED:\n- " + "\n- ".join(issues)

    deps._beat_ops = list(op_dicts)
    return f"Beat operations validated and submitted ({len(op_dicts)} op(s))."


@function_tool
async def count_elements(
    wrapper: RunContextWrapper[ScreenplayDeps],
    element_types: Optional[List[str]] = None,
) -> str:
    """Count screenplay elements, optionally filtered by type.

    Args:
        element_types: Optional list of types to count.
                       Valid types: dialogue, character, action, scene-heading,
                       parenthetical, transition.
                       If omitted, counts ALL element types and returns a
                       breakdown by type.

    Use this for questions like "how many dialogue lines?", "how many scenes?",
    "how many elements total?", etc.
    """
    deps = wrapper.context

    if not deps.project_id or not deps.db_pool:
        return "Cannot count elements: no project or database available."

    try:
        from services.db_service import DBService

        db = DBService()
        db.pool = deps.db_pool

        async with db.pool.acquire() as conn:
            if element_types:
                rows = await conn.fetch(
                    """
                    SELECT elem->>'type' AS element_type, count(*) AS cnt
                    FROM projects p,
                         LATERAL jsonb_array_elements(p.data->'elements') t(elem)
                    WHERE p.id = $1::uuid
                      AND elem->>'type' = ANY($2::text[])
                    GROUP BY elem->>'type'
                    ORDER BY cnt DESC
                    """,
                    deps.project_id,
                    element_types,
                )
            else:
                rows = await conn.fetch(
                    """
                    SELECT elem->>'type' AS element_type, count(*) AS cnt
                    FROM projects p,
                         LATERAL jsonb_array_elements(p.data->'elements') t(elem)
                    WHERE p.id = $1::uuid
                    GROUP BY elem->>'type'
                    ORDER BY cnt DESC
                    """,
                    deps.project_id,
                )

        if not rows:
            return "No elements found for this project."

        total = sum(int(r["cnt"]) for r in rows)
        lines = [f"Total elements: {total}"]
        lines.append("Breakdown by type:")
        for r in rows:
            lines.append(f"  {r['element_type']}: {r['cnt']}")
        return "\n".join(lines)

    except Exception as e:
        logger.warning(f"[screenplay_agent] count_elements failed: {e}")
        return f"Error counting elements: {e}"


@function_tool
async def update_plan(
    wrapper: RunContextWrapper[ScreenplayDeps],
    plan: PlanState,
) -> str:
    """Replace the current visible plan state.

    Use this whenever you:
    - create the initial plan for a multi-step request
    - start working on a task (mark exactly one todo in_progress)
    - complete, block, or cancel a task
    - learn new facts that change the plan (revise todos, known_facts, or risks)

    Rules:
    - Prefer 3–8 concrete, ordered todos for non-trivial requests.
    - Only one todo should be in_progress at a time.
    - Do not mark a todo done until its work is actually complete.
    - Add known_facts when tool results reveal something important.
    - Add risks when uncertainty or validation issues remain.
    """
    deps = wrapper.context

    if not plan.todos and not plan.summary.strip():
        return "ERROR: plan must include a summary or at least one todo."

    in_progress = [t for t in plan.todos if t.status == TodoStatus.in_progress]
    if len(in_progress) > 1:
        return (
            f"ERROR: only one todo may be in_progress (found {len(in_progress)}). "
            "Fix statuses and call update_plan again."
        )

    deps._plan = plan
    done = sum(1 for t in plan.todos if t.status == TodoStatus.done)
    total = len(plan.todos)
    return (
        f"Plan updated ({done}/{total} todos done). "
        "Continue with the in_progress task or start the next pending one."
    )


def _hosted_tools() -> list[Any]:
    return [
        WebSearchTool(),
        CodeInterpreterTool(
            tool_config={"type": "code_interpreter", "container": {"type": "auto"}},
        ),
    ]


def create_screenplay_agent(model: str = "gpt-4.1") -> Agent[ScreenplayDeps]:
    """Create and return the unified screenplay agent with all tools registered."""
    return Agent[ScreenplayDeps](
        name="ScreenplayAssistant",
        model=model,
        instructions=_dynamic_instructions,
        tools=[
            *_hosted_tools(),
            update_plan,
            search_screenplay,
            list_scenes,
            find_character_scenes,
            load_elements,
            submit_edits,
            verify_edits,
            manage_beats,
            count_elements,
        ],
    )
