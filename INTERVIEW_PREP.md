# Interview Prep — Screenwriter Project

A concise guide for presenting the current Screenwriter architecture.

## Elevator Pitch

Screenwriter is a browser-based screenwriting editor with industry-standard
formatting, a beat board for story planning, and an AI assistant powered by an
OpenAI Agents SDK tool-calling agent. The agent can search the screenplay with
agent-chosen full-text queries, load exact screenplay elements, answer questions,
propose structured inline edits for user review, and manage beat-board
operations. The app uses a React frontend, a Node/Express CRUD API, a
Python/FastAPI AI service, PostgreSQL persistence, and SSE streaming for
real-time AI progress.

## Current Retrieval Story

The project no longer uses embeddings, pgvector, vector search, or an embedding
backfill service.

Retrieval is now:

1. Agent chooses explicit search terms.
2. `search_screenplay` runs PostgreSQL full-text search over screenplay elements.
3. If FTS returns no hits, the DB service falls back to ILIKE.
4. The agent can call `list_scenes`, `find_character_scenes`, and `load_elements`
   to orient, verify, and gather exact text.
5. The client-provided `globalIndex` and `sceneContext` are orientation aids, not
   primary evidence for edits.

## Architecture Walkthrough

```text
React frontend
  - Script editor
  - Beat board
  - AI chat panel
  - LocalStorage fallback

Node/Express API (:3001)
  - Project CRUD
  - Writing goals
  - Writing sessions

Python/FastAPI AI service (:3002)
  - OpenAI Agents SDK agent
  - Tool calls for search, scene loading, edit submission, beat ops
  - SSE typed event streaming
  - Langfuse observability

PostgreSQL 16
  - projects JSONB document store
  - writing_goals
  - writing_sessions
```

## Tech Stack

| Area | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| CRUD API | Node.js, Express, pg |
| AI service | Python, FastAPI, uvicorn |
| Agent framework | OpenAI Agents SDK |
| Models | gpt-4.1, gpt-5, gpt-5-mini |
| Search | PostgreSQL FTS + ILIKE fallback |
| Database | PostgreSQL 16 |
| Streaming | Server-Sent Events |
| Observability | Langfuse |
| Deployment | Docker Compose |

## Strong Talking Points

### Unified Tool-Calling Agent

The AI service uses one screenplay-aware agent rather than separate bespoke
chains for ask, edit, and beat-board work. The agent has tools for:

- `search_screenplay`
- `list_scenes`
- `find_character_scenes`
- `load_elements`
- `submit_edits`
- `verify_edits`
- `manage_beats`
- `count_elements`
- `update_plan`

The important design choice is that structured edits are collected through the
`submit_edits` tool, not scraped from assistant prose. That makes the UI more
robust and gives the tool a chance to validate element IDs and payload shape.

### Full-Text Search Instead Of Vector Search

The retrieval path is intentionally simple and inspectable. The agent chooses
keywords based on the user's request, then the DB service searches screenplay
elements with PostgreSQL FTS. When FTS is too strict, the service falls back to
ILIKE. The agent can re-search with different terms if results are poor.

This is easier to debug than vector retrieval: every search term, query result,
and loaded element can be shown in the event stream or trace.

### Streaming Pipeline

The backend consumes `Runner.run_streamed(...).stream_events()` from the OpenAI
Agents SDK and translates SDK events into app-level typed events:

- tool calls and tool results
- visible plan updates
- text deltas
- apply started/done markers
- final content or structured edit payloads

The FastAPI endpoint sends these events directly over SSE. The React client
parses SSE frames and updates the chat panel progressively.

### Inline Edit Proposal System

Edits are proposed as structured payloads with:

- exact `elementId`
- `originalContent`
- `newContent`
- optional `newElements`
- reason text

The frontend renders them inline on screenplay elements and lets the user accept
or reject each proposal.

### Storage Resilience

The app is API-first but keeps a localStorage fallback. If the Node API is down,
the editor still works locally. When the API becomes available, local-only
projects can be synced into PostgreSQL.

## Questions To Be Ready For

### Why no vector database?

For screenplay-scale projects, lexical search is easier to inspect and good
enough for most agent workflows. The model is strong at choosing and revising
search terms, and PostgreSQL FTS keeps the operational model simple. Removing
embeddings also removes stale-index problems, backfill jobs, pgvector dependency
management, and extra write-time work.

### How does the agent avoid hallucinating edits?

It must call search/list/load tools to obtain exact element IDs and content.
`submit_edits` validates the structured payload before the frontend receives it.
The UI still requires user acceptance before changes are applied.

### How does streaming work?

The AI service starts an Agents SDK streamed run, translates SDK stream events
into app events, and places them on an async queue. The FastAPI SSE generator
consumes from that queue and sends events to the browser. If the client
disconnects, the backend cancels the agent task and calls the SDK stream
result's `cancel()` method.

### Why JSONB for projects?

The screenplay is naturally document-shaped and autosaves frequently. Storing
the full screenplay object as JSONB keeps reads/writes atomic and simple. For
AI queries that need element-level access, PostgreSQL can still inspect the
JSONB array with lateral joins.

## Demo Script

1. Open a screenplay and show formatted editing.
2. Ask the AI a factual question, such as a character or scene query.
3. Show the plan/tool-call stream.
4. Ask for a small edit.
5. Accept/reject inline edit cards.
6. Open the beat board and ask for a beat operation.

## Numbers Worth Remembering

- React frontend plus two backend services.
- PostgreSQL stores projects as JSONB.
- Search uses PostgreSQL FTS plus ILIKE fallback.
- AI responses stream through typed SSE events.
- The app supports localStorage fallback when the API is unavailable.
