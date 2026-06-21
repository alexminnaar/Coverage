# Ask + Edit Agent Flow (ai-service)

This document describes the current Python AI service. Retrieval no longer uses
embeddings, pgvector, vector search, or an embedding backfill service. The
screenplay agent uses explicit tool calls over PostgreSQL full-text search,
ILIKE fallback, and bounded screenplay context supplied by the client.

## Where To Look In Code

- Entrypoint / orchestration: `server-python/services/llm_service.py`
- Unified tool-calling agent: `server-python/services/screenplay_agent.py`
- Streaming event bridge: `server-python/services/streaming.py`
- DB access / full-text search: `server-python/services/db_service.py`
- Search formatting helpers: `server-python/services/search_helpers.py`
- Tool input / dependency types: `server-python/services/edit_types.py`

## Key Concepts

- A single OpenAI Agents SDK agent handles ask, edit, and beat-board requests.
- The agent receives request-scoped dependencies through `ScreenplayDeps`.
- The agent chooses search terms and may re-search with broader or narrower terms.
- Search is lexical, not semantic:
  - first PostgreSQL FTS over JSONB screenplay elements
  - then ILIKE fallback over the same element data
  - then local `sceneContext` fallback when DB context is unavailable
- Structured edits are not parsed from prose. They are collected when the agent
  calls `submit_edits`.
- Beat-board operations are collected when the agent calls `manage_beats`.
- Streaming is translated into typed UI events so the frontend can show tool
  progress, plan updates, apply markers, text deltas, and final payloads.

## Streaming Event Model

Typed chat events are emitted by `server-python/services/streaming.py` and sent
directly as SSE payloads by `/api/chat`:

- `status`: `{"type":"status","message":"..."}`
- `tool_call`: `{"type":"tool_call","tool":"search_screenplay", ...}`
- `tool_result`: `{"type":"tool_result","tool":"search_screenplay", ...}`
- `plan_updated`: `{"type":"plan_updated","plan":{...}}`
- `apply_started`: `{"type":"apply_started","label":"Applying edits","elementIds":[...]}`
- `apply_done`: `{"type":"apply_done"}`
- `text_delta`: `{"type":"text_delta","content":"..."}`
- `final`:
  - ask: `{"type":"final","content":"..."}`
  - edit: `{"type":"final","edits":{"edits":[...]}}`
  - beat ops: `{"type":"final","beatOps":{"ops":[...]}}`

Legacy mode (`streamEvents=false`) is still supported for compatibility and
wraps chunks in the old `{ "content": "..." }` shape.

## Ask Requests

For in-project questions, the agent should use the narrowest reliable tool:

1. `count_elements` for counts and element-type breakdowns.
2. `list_scenes` to orient around scene headings.
3. `find_character_scenes` for character appearance questions.
4. `search_screenplay` for keyword/phrase retrieval.
5. `load_elements` to fetch exact content and surrounding context.

The global index and scene context are orientation aids. When exact content or
element IDs matter, the agent should verify with DB tools.

## Edit Requests

For edit requests, the expected flow is:

1. `update_plan` for non-trivial work.
2. `search_screenplay`, `list_scenes`, or `find_character_scenes` to locate targets.
3. `load_elements` to fetch exact content and element IDs.
4. `submit_edits` to validate structured edit proposals.
5. Optional `verify_edits` for additional checks.
6. Final response explaining the proposed changes.

`submit_edits` validates required fields, exact element IDs, and basic edit
shape. It stores the structured payload on `ScreenplayDeps._submitted_edits`,
which `llm_service.py` emits as the final edit payload.

## Beat Board Requests

Beat-board changes go through `manage_beats`. The model proposes operations
such as create, update, delete, or move. The frontend still controls whether
those operations are applied.

## Search Implementation

`DBService.search_elements` performs:

1. `to_tsvector('simple', content) @@ to_tsquery(...)`
2. ILIKE fallback when FTS returns no hits

Results include element IDs, element types, script order, snippets, and rank.
No embedding table, vector extension, vector index, or embedding refresh path is
used by the current implementation.

## Client Global Index

The client may send `globalIndex` as compact text. Recommended contents:

- `Global Index v1`
- numbered scene headings with scene IDs
- top characters with approximate dialogue counts

Keep this small, usually 1-3 KB, and treat it as orientation rather than primary
evidence.
