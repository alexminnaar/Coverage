# Screenwriter — Technical Documentation

A browser-based screenwriting editor with industry-standard formatting, a full-featured beat board, and an AI assistant powered by a tool-calling LLM agent that can search, analyze, and propose structured edits to your screenplay.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Tech Stack](#tech-stack)
- [Getting Started](#getting-started)
- [Frontend](#frontend)
  - [Application Shell](#application-shell)
  - [Components](#components)
  - [Hooks](#hooks)
  - [Services](#services)
  - [Utilities](#utilities)
  - [Domain Model](#domain-model)
  - [Styling and Theming](#styling-and-theming)
- [Node API Server (Port 3001)](#node-api-server-port-3001)
  - [Endpoints](#node-endpoints)
  - [Database Schema](#database-schema)
- [Python AI Server (Port 3002)](#python-ai-server-port-3002)
  - [Endpoints](#ai-endpoints)
  - [Unified Screenplay Agent](#unified-screenplay-agent)
  - [Agent Tools](#agent-tools)
  - [Streaming Pipeline](#streaming-pipeline)
  - [Full-Text Search](#full-text-search)
  - [Observability](#observability)
  - [Prompts](#prompts)
- [Data Flow](#data-flow)
  - [Screenplay Persistence](#screenplay-persistence)
  - [AI Chat (Ask and Edit)](#ai-chat-ask-and-edit)
  - [Beat Board AI](#beat-board-ai)
  - [Inline Edit Proposals](#inline-edit-proposals)
- [Configuration Reference](#configuration-reference)
- [Docker Deployment](#docker-deployment)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Browser (React)                           │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  Script   │  │   Beat   │  │    AI    │  │   AI Command   │  │
│  │  Editor   │  │  Board   │  │   Chat   │  │    Palette     │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬────────┘  │
│       │              │             │                 │            │
│       └──────┬───────┘             └────────┬────────┘            │
│              │                              │                    │
│         storage.ts                    aiClient.ts                │
│         apiClient.ts              (http://localhost:3002)         │
│        (/api → :3001)                                            │
└──────────┬──────────────────────────────┬────────────────────────┘
           │                              │
           ▼                              ▼
┌─────────────────────┐      ┌─────────────────────────┐
│  Node/Express :3001 │      │   FastAPI/Python :3002   │
│                     │      │                          │
│  • Project CRUD     │      │  • OpenAI Agents SDK   │
│  • Writing goals    │      │  • Streaming SSE         │
│  • Writing sessions │      │  • Full-text search      │
│                     │      │  • Langfuse tracing      │
└────────┬────────────┘      └────────────┬─────────────┘
         │                                │
         └────────────┬───────────────────┘
                      ▼
          ┌───────────────────────┐
          │  PostgreSQL 16        │
          │                       │
          │  • projects (JSONB)   │
          │  • writing_goals      │
          │  • writing_sessions   │
          └───────────────────────┘
```

The system is split into two backends sharing a single PostgreSQL database:

- **Node/Express (port 3001)** handles all CRUD operations — projects, writing goals, and sessions.
- **FastAPI/Python (port 3002)** handles all AI operations — chat, completions, commands, and beat AI. It runs an OpenAI Agents SDK tool-calling agent that can search the web, run Python analysis, search the database via full-text search, load screenplay elements, propose structured edits, and manage beats.
- **React frontend** talks to both: Vite proxies `/api` to port 3001 for persistence, while `aiClient.ts` calls port 3002 directly for AI features.

The frontend also supports a **localStorage fallback** — if the API is unreachable, the app degrades gracefully to local-only persistence.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite 5 |
| Icons | lucide-react |
| PDF Export | jspdf |
| Markdown Rendering | marked |
| CRUD API | Node.js, Express, pg |
| AI Service | Python, FastAPI, uvicorn |
| AI Framework | OpenAI Agents SDK (`openai-agents`) |
| LLM Provider | OpenAI (`gpt-4.1`, `gpt-5`, `gpt-5-mini`) |
| Database | PostgreSQL 16 |
| Observability | Langfuse |
| Infrastructure | Docker Compose (4 services) |

---

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.11+
- PostgreSQL 16 (or use Docker)
- OpenAI API key

### Local Development

**Frontend:**

```bash
npm install
npm run dev          # Vite dev server on http://localhost:5173
```

**Node API:**

```bash
cd server
npm install
npm start            # Express on http://localhost:3001
```

**Python AI service:**

```bash
cd server-python
pip install -r requirements.txt
cp .env.example .env # Add your OPENAI_API_KEY
python main.py       # FastAPI on http://localhost:3002
```

### Docker (All Services)

```bash
# Create .env with at minimum OPENAI_API_KEY=sk-...
docker compose up --build
# Frontend: http://localhost:5173
# Node API: http://localhost:3001
# AI API:   http://localhost:3002
```

---

## Frontend

### Application Shell

`App.tsx` is the root component and owns nearly all application state. There is no global state library (Redux, Zustand, etc.) — state flows downward via props.

**State management highlights:**

- **Undo/redo** is handled by `useHistory<Screenplay>` (max 50 steps), wrapping the entire screenplay object.
- **Autosave** uses a debounced `saveProject` (500ms) triggered on every screenplay change.
- **Pending AI edits** are stored in a `Map<string, PendingEdit>` — keyed by element ID — and passed to the editor for inline accept/reject UI.
- **Theme** (`dark` | `light` | `system`) is applied via `data-theme` on `document.documentElement`.
- **API mode detection** runs on mount via `initAPIMode`, which probes `/api/health` and caches the result.

**Global keyboard shortcuts:**

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl+Z` | Undo |
| `Cmd/Ctrl+Shift+Z` | Redo |
| `Cmd/Ctrl+F` | Find/Replace |
| `Cmd/Ctrl+K` | AI Command Palette |
| `Cmd/Ctrl+/` | Toggle AI Chat |
| `F11` | Distraction-free mode |
| `?` | Keyboard help |
| `Escape` | Close active modal/panel |

### Components

| Component | Purpose |
|---|---|
| `ScriptEditor` | Core editing surface — renders all screenplay elements |
| `ScriptBlock` | Single element block (scene heading, action, dialogue, etc.) with inline pending edit UI |
| `Header` | Top bar with glassmorphism design — title, project actions, feature toggles |
| `SceneNavigator` | Sidebar with scene list, character list, and beat overview |
| `AIChat` | Right-panel AI chat with Ask/Edit mode toggle, model picker, streaming display |
| `AICommandPalette` | Quick AI rewrite commands on selected text (Cmd+K) |
| `AISettings` | Enable/disable AI features |
| `BeatBoard` | Full-screen kanban-style beat board with act columns |
| `BeatColumn` | Single act column in the beat board |
| `BeatCard` | Draggable beat card |
| `BeatAIPanel` | Chat interface for beat-level AI operations |
| `TemplateSelector` | Predefined beat structure templates |
| `FindReplace` | Global find and replace |
| `ProjectList` | Project picker/manager |
| `TitlePageEditor` | Screenplay title page fields |
| `PrintPreview` | Print-ready screenplay view |
| `Statistics` | Word count, page count, element breakdown, duration estimates |
| `RevisionManager` | Revision color management |
| `SnapshotsPanel` | Version snapshot create/restore/compare (max 20) |
| `SceneCompare` | Diff between current and snapshot |
| `NotesPanel` | Per-element script notes |
| `CharacterTracker` | Character appearances and scene navigation |
| `WritingGoals` | Daily/weekly/session goals with streak tracking |
| `KeyboardHelp` | Shortcut reference |

### Hooks

| Hook | Purpose |
|---|---|
| `useHistory` | Generic undo/redo stack with configurable max depth |
| `useAIChat` | Manages AI chat state, SSE streaming, JSON event parsing, edit extraction |
| `useBeatAIChat` | Beat-specific AI chat with plain text accumulation |
| `useAICompletion` | Inline autocomplete suggestions from the AI |
| `useCharacterSuggestion` | Character name suggestions based on existing characters |
| `useTypewriterScroll` | Keeps the cursor line vertically centered |

### Services

**`apiClient.ts`** — CRUD API client for the Node server.

- Base URL: `import.meta.env.VITE_API_BASE_URL || '/api'` (proxied to port 3001 in dev)
- `shouldUseAPI()` probes `/api/health` with a 10-second cache; result persisted to `localStorage`
- Project CRUD: `fetchProjects`, `fetchProject`, `createProject`, `updateProject`, `deleteProjectById`
- Writing data: `fetchWritingGoal`, `saveWritingGoal`, `fetchWritingSessions`, `saveWritingSessions`

**`aiClient.ts`** — AI client for the Python server.

- Base URL: `http://localhost:3002/api` (hardcoded; not proxied through Vite)
- `streamChat` — SSE streaming POST to `/chat` with messages, scene context, global index, mode, model, selection metadata
- `streamBeatChat` — SSE streaming POST to `/beat-chat` with beats, act names, and optional scene headings
- `streamCompletion` — SSE streaming POST to `/complete` for inline autocomplete
- `executeCommand` — Non-streaming POST to `/command` for palette rewrites
- `checkAIHealth` — GET to `/health`

**`storage.ts`** — Persistence facade over API + localStorage.

- Tries the API first; falls back to localStorage on failure
- `syncLocalProjectsToAPIIfNeeded` — one-time sync of local-only projects to the server on page load
- Always mirrors successful API saves to localStorage as a backup
- Manages snapshots (max 20), writing goals, sessions (90-day retention)
- Provides `debounce` utility used by `App.tsx` for autosave
- `createDefaultScreenplay` — initializes a new screenplay with one empty scene heading
- `migrateLegacyData` — migrates from older single-project localStorage format

### Utilities

| Utility | Purpose |
|---|---|
| `globalIndex.ts` | Builds a compact text index of the entire screenplay for AI context |
| `writingStats.ts` | Streak calculation, word/page counting helpers |
| `diffEngine.ts` | Text and scene-level diff for snapshot comparison |
| `characterAnalysis.ts` | Character frequency and scene appearance analysis |
| `pageBreaks.ts` | Page break calculation for print/export |
| `durationEstimate.ts` | Scene and screenplay runtime estimation |
| `contdMore.ts` | Automatic CONT'D and MORE markers for page-broken dialogue |
| `dualDialogue.ts` | Dual (side-by-side) dialogue block handling |
| `sceneNumbers.ts` | Scene number assignment and locking |
| `characterUtils.ts` | Character name normalization and extraction |
| `fountainParser.ts` / `fountainExporter.ts` | Import/export Fountain format |
| `fdxParser.ts` / `fdxExporter.ts` | Import/export Final Draft FDX format |

### Domain Model

Defined in `src/types.ts`:

**Core screenplay types:**

- `ElementType` — `scene-heading` | `action` | `character` | `dialogue` | `parenthetical` | `transition`
- `ScriptElement` — Individual element with `id`, `type`, `content`, optional `synopsis`, `notes`, `sceneNumber`, revision fields, dual-dialogue flags, `durationOverride`
- `Screenplay` — Full document: `id`, `title`, `author`, `elements[]`, title page metadata, `beats`, `beatStructure`, `revisions`, `snapshots`, `scriptNotes`, timestamps, formatting flags

**AI edit types:**

- `PendingEdit` — Proposed change to an element: `elementId`, `originalContent`, `newContent`, optional `reason`, `newElements[]` (for splits/inserts)
- `StructuredElement` — Element shape used in `newElements`: `type`, `content`

**Beat board types:**

- `BeatStructure` — `'three-act'` | `'four-act'` | `'five-act'`
- `Beat` — `id`, `title`, `description`, `actIndex`, `order`, optional `color`, `linkedSceneId`

**Writing goals:**

- `WritingGoal` — `type` (pages/words/scenes/time), `target`, `period` (daily/weekly/session), `enabled`
- `WritingSession` — Daily tracking record with word/page/scene counts, duration, goal met flag

**Other:**

- `ProjectMeta` — Lightweight project metadata for the project list
- `Revision` / `RevisionColor` — Revision tracking with color-coded marks
- `ScriptSnapshot` — Named checkpoint of elements + metadata
- `ScriptNote` — Note attached to a specific element
- `Theme` — `'dark'` | `'light'` | `'system'`

### Styling and Theming

All styles live in `src/index.css` as a single stylesheet with CSS custom properties for theming.

**Design tokens:**

- Surface colors: `--bg-dark`, `--bg-surface`, `--bg-elevated`
- Paper: `--paper-bg`, `--paper-shadow` (warm sepia tone in dark mode)
- Accent: gold/brass palette (`--accent` family)
- Text hierarchy: `--text-primary`, `--text-secondary`, `--text-muted`, `--text-screenplay`
- Element colors: `--type-scene`, `--type-action`, `--type-character`, etc.
- Layout: `--header-height`, `--sidebar-width`

**Fonts:**

- UI: **DM Sans**
- Screenplay: **Courier Prime** (industry-standard screenwriting typeface)

**Theme switching:** The root element gets `data-theme="dark"` or `data-theme="light"`. Dark is the default. The `system` option follows `prefers-color-scheme`.

---

## Node API Server (Port 3001)

Located in `server/`. Handles all CRUD operations for projects and writing data.

### Node Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Health check with database connectivity status |
| `GET` | `/api/projects` | List all projects (metadata + page count) |
| `GET` | `/api/projects/:id` | Fetch full screenplay JSON |
| `POST` | `/api/projects` | Create project |
| `PUT` | `/api/projects/:id` | Update project (upsert) |
| `DELETE` | `/api/projects/:id` | Delete project |
| `GET` | `/api/writing/goals/:projectId?` | Get writing goal |
| `POST` | `/api/writing/goals` | Upsert writing goal |
| `GET` | `/api/writing/sessions/:projectId` | Get writing sessions (default last 90) |
| `POST` | `/api/writing/sessions` | Bulk upsert sessions |
| `DELETE` | `/api/writing/sessions/cleanup?days=` | Delete old sessions |

### Database Schema

```sql
-- Full screenplay stored as a single JSONB document
CREATE TABLE projects (
    id UUID PRIMARY KEY,
    title VARCHAR(255),
    author VARCHAR(255),
    data JSONB,                    -- entire Screenplay object
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ         -- auto-updated via trigger
);

CREATE TABLE writing_goals (
    id SERIAL PRIMARY KEY,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    type VARCHAR(20),              -- pages | words | scenes | time
    target INTEGER,
    period VARCHAR(20),            -- daily | weekly | session
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ
);

CREATE TABLE writing_sessions (
    id VARCHAR(255) PRIMARY KEY,
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    date DATE,
    start_page_count INTEGER,
    end_page_count INTEGER,
    start_word_count INTEGER,
    end_word_count INTEGER,
    start_scene_count INTEGER,
    end_scene_count INTEGER,
    duration INTEGER,              -- seconds
    goal_met BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ
);
```

**Design rationale:** Storing the entire screenplay as a single JSONB document simplifies persistence — the frontend can save the whole object atomically, and the autosave logic is trivial. The AI layer queries elements on demand via `jsonb_array_elements` lateral joins and Postgres full-text search.

---

## Python AI Server (Port 3002)

Located in `server-python/`. Handles all AI operations via FastAPI.

### AI Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Health check: API key configured, database connected |
| `POST` | `/api/chat` | SSE streaming chat (ask or edit mode) |
| `POST` | `/api/beat-chat` | SSE streaming beat board AI |
| `POST` | `/api/complete` | SSE streaming inline completion |
| `POST` | `/api/command` | Non-streaming text rewrite |

All streaming endpoints use SSE format: lines of `data: {"content": <json>}\n\n` terminated by `data: [DONE]\n\n`.

### Unified Screenplay Agent

The core of the AI system is a single **OpenAI Agents SDK agent** defined in `screenplay_agent.py` via `create_screenplay_agent()`. This agent handles ask, edit, and beat requests through a unified tool-calling approach.

**Agent configuration:**

- Model: Configurable per request (`gpt-4.1`, `gpt-5`, `gpt-5-mini`) via OpenAI Responses API
- Instructions: `UNIFIED_SYSTEM_PROMPT` (static) + dynamic context injection (selected text, global index, scene context, beat context)
- Context: `ScreenplayDeps` dataclass passed via `RunContextWrapper` — carries project ID, database pool, scene/beat context, and mutable fields for collecting edits and beat operations
- Turn limits: `max_turns=15` for chat, `max_turns=10` for beat chat

**`ScreenplayDeps` fields:**

```python
@dataclass
class ScreenplayDeps:
    scene_context: str
    project_id: Optional[str]
    db_pool: Optional[asyncpg.Pool]
    global_index: Optional[str]
    selected_element_id: Optional[str]
    selected_text: Optional[str]
    beat_context: Optional[str]
    _submitted_edits: list       # mutable — populated by submit_edits tool
    _beat_ops: list              # mutable — populated by manage_beats tool
```

### Agent Tools

The agent has nine tools — two hosted (OpenAI) and seven custom function tools:

**Hosted tools (OpenAI Responses API):**

**1. `web_search`** — Search the public web for external research (craft guides, industry references, historical facts). Not for in-project screenplay content.

**2. `code_interpreter`** — Run Python in a sandboxed environment for quantitative analysis on loaded screenplay text (word counts, pacing stats, character frequency). Load data via `load_elements` first.

**Custom function tools:**

**3. `update_plan(plan)`** — Create or replace the visible plan/to-do checklist (Cursor-style). Stores `PlanState` in `ScreenplayDeps._plan` and emits a `plan_updated` SSE event. The agent must call this for multi-step work; the frontend renders the checklist from structured events, not chat prose.

**4. `search_screenplay(search_terms, match_mode, element_types)`**

Agent-driven full-text search over screenplay elements.
- The agent chooses explicit search terms (character names, locations, phrases)
- Uses Postgres FTS (`to_tsvector` / `to_tsquery`) with ILIKE fallback
- Supports `match_mode`: `"any"` (OR) or `"all"` (AND), optional `element_types` filter
- Returns ranked hits grouped by scene, with snippets and guidance to re-search if results are poor
- If no database is available, falls back to scanning UUIDs in the scene context string

**5. `list_scenes(search_terms)`**

Lists scene headings in script order, optionally filtered by keywords.
- Returns scene number, element ID, script index, and heading text

**6. `load_elements(element_ids: list, context_size: int = 3)`**

Loads full element content with surrounding context (default 3 elements before/after).
- Capped at 25 element IDs per call
- Uses `DBService.extract_element_context` for windowed retrieval with scene heading metadata
- Falls back to scene context string if database is unavailable

**6. `submit_edits(edits: list)`**

Proposes structured edits to screenplay elements.
- Validates each edit has `elementId`, `type`, `content`
- Optionally verifies element IDs exist in the database via `DBService.verify_element_ids`
- Supports `newElements` for inserting new elements after the target
- Writes validated edits to `deps._submitted_edits`

**7. `verify_edits()`**

Post-submission validation of proposed edits.
- Checks element types are valid
- Detects no-op edits (where new content matches original)
- Verifies element IDs against the database

**8. `manage_beats(operations: list)`**

Proposes beat board operations.
- Supports `create`, `update`, `delete`, `move` operations
- Validates operation structure and required fields
- Writes validated operations to `deps._beat_ops`

**9. `count_elements(element_types: list = None)`**

Returns element counts by type.
- Runs SQL aggregation on `projects.data->'elements'` via `jsonb_array_elements`
- Optional type filter

### Streaming Pipeline

The streaming system translates OpenAI Agents SDK stream events into a typed protocol the frontend can consume.

**Server-side flow (`streaming.py`):**

`run_unified_agent_streaming()` consumes `Runner.run_streamed()` events and emits structured events:

| Event Type | Payload | When |
|---|---|---|
| `status` | `message` | Tool calls starting, processing phases |
| `text_delta` | `content` | Model text tokens streaming |
| `tool_call` | `name`, `args` | Agent invokes a tool |
| `tool_result` | `name`, `result` | Tool returns a result |
| `plan_updated` | `plan` (summary, todos, known_facts, risks) | `update_plan` tool completed |
| `apply_started` | — | `submit_edits` tool invoked |
| `apply_done` | — | `submit_edits` tool completed |
| `agent_done` | `tool_call_count` | Agent run finished |
| `final` | `edits[]` | Final edit payload (edit mode only) |

Events are JSON-serialized and wrapped in `{"content": <event>}` for SSE transport.

**Legacy support:** A `stream_events` boolean flag on `ChatRequest` controls whether the server sends typed JSON events (new path) or plain-text status lines with a single final JSON payload (legacy path). The `format_buffer_item()` function handles the translation.

**Client-side flow (`useAIChat.ts`):**

1. Reads SSE lines, strips `data: ` prefix, parses outer JSON to get `content`
2. **Edit mode:** Buffers content strings and uses `extractJsonObjects()` to handle JSON objects that may span multiple SSE chunks (since TCP can fragment at any byte boundary)
3. **Ask mode:** Parses each chunk as a typed event; falls back to plain text concatenation
4. Accumulates `AIStreamEvent[]` on the assistant message for UI display (tool call progress, apply phases)
5. Extracts `edits` from the `final` event and attaches them to the message

### Full-Text Search

Screenplay retrieval uses **agentic full-text search** (`db_service.search_elements` + `search_screenplay` tool).

**Pipeline:**

1. **Agent chooses terms:** The LLM calls `search_screenplay` with 1–8 explicit keywords (not vague NL queries)
2. **Query:** Postgres FTS over unnested `projects.data->'elements'` content, ranked by `ts_rank`
3. **Fallback:** ILIKE pattern match if FTS returns nothing
4. **Retry loop:** Tool response guides the agent to broaden/narrow terms and call again
5. **Load:** Agent calls `load_elements` with returned IDs for full context before edits

**Files:** `server-python/services/db_service.py`, `server-python/services/search_helpers.py`, `search_screenplay` in `screenplay_agent.py`

### Observability

Langfuse integration (`observability/langfuse_client.py`) provides tracing for all agent runs.

**Configuration (all optional):**

| Variable | Default | Purpose |
|---|---|---|
| `LANGFUSE_ENABLED` | `true` | Master toggle |
| `LANGFUSE_PUBLIC_KEY` | — | Langfuse project public key |
| `LANGFUSE_SECRET_KEY` | — | Langfuse project secret key |
| `LANGFUSE_HOST` | `https://cloud.langfuse.com` | Langfuse server URL |
| `LANGFUSE_LOG_CONTENT` | `false` | Whether to include full prompt/response content |

**What gets logged:**

- `log_agent_run()` is called after every unified agent run with the full message history
- Each LLM generation becomes a Langfuse **generation** span with model, token usage, and optionally content
- Each tool call/result pair becomes a Langfuse **span**
- Metadata tags include mode (ask/edit/beat), model name, project ID

### Prompts

All prompt templates are defined in `prompts.py`:

| Constant | Used By | Purpose |
|---|---|---|
| `UNIFIED_SYSTEM_PROMPT` | Unified agent | Primary system prompt: defines tool usage rules, planning behavior, Q&A vs edit vs beat modes, rules against hallucinated IDs |
| `COMPLETION_SYSTEM_PROMPT` | `stream_completion` | Inline completion: formatting rules, element-type-aware continuation |
| `CHAT_SYSTEM_PROMPT` | Legacy ask agent | Screenplay consultant behavior with context awareness |
| `EDIT_MODE_SYSTEM_PROMPT` | Legacy edit agent | JSON edit schema, `newElements` rules, ID/content matching |
| `COMMAND_SYSTEM_PROMPT` | `execute_command` | Transform selected text without explanation |

---

## Data Flow

### Screenplay Persistence

```
User edits screenplay
        │
        ▼
App.tsx screenplay state (useHistory)
        │
        ▼ (debounced 500ms)
storage.saveProject()
        │
        ├──▶ apiClient.updateProject()  ──▶  Node :3001  ──▶  PostgreSQL
        │         │                                              (JSONB)
        │         └──▶ localStorage mirror (backup)
        │
        └──▶ (on API failure) localStorage only
                    + setUseAPI(false)
```

### AI Chat (Ask and Edit)

```
User sends message in AIChat
        │
        ▼
useAIChat.sendMessage()
  • Builds globalIndex from elements
  • Builds sceneContext (±1 scene window, beat summary, selection)
        │
        ▼
aiClient.streamChat()  ──▶  POST /api/chat  ──▶  Python :3002
                                                       │
                                    LLMService.stream_chat()
                                           │
                               ┌───────────┴───────────┐
                               │  Ensure DB pool        │
                               │  Build ScreenplayDeps   │
                               └───────────┬───────────┘
                                           │
                              run_unified_agent_streaming()
                                           │
                               ┌───────────┴───────────┐
                               │  PydanticAI agent.iter()│
                               │                        │
                               │  Tools:                │
                               │  • search_screenplay   │
                               │  • load_elements       │
                               │  • submit_edits        │
                               │  • verify_edits        │
                               │  • count_elements      │
                               └───────────┬───────────┘
                                           │
                                    SSE stream events
                                           │
        ┌──────────────────────────────────┘
        ▼
useAIChat processes chunks
  • Buffers + extractJsonObjects
  • Updates messages with text deltas
  • Captures typed events for UI
  • Extracts final edits
        │
        ▼
AIChat.tsx renders streaming response
  • Ask mode: markdown text
  • Edit mode: tool progress + edit cards
        │
        ▼ (edit mode, on stream end)
App.tsx pendingEdits Map updated
        │
        ▼
ScriptEditor shows inline accept/reject per element
```

### Beat Board AI

```
User sends message in BeatAIPanel
        │
        ▼
useBeatAIChat.sendMessage()
  • Includes current beats, act names, selected beat, optional scenes
        │
        ▼
aiClient.streamBeatChat()  ──▶  POST /api/beat-chat  ──▶  Python :3002
                                                               │
                                          LLMService.stream_beat_chat()
                                                 │
                                    Build BeatLoopState + beat_context
                                    Run unified agent with manage_beats tool
                                                 │
                                          Yield JSON { ops: [...] }
                                                 │
        ┌────────────────────────────────────────┘
        ▼
BeatAIPanel parses response
  • parseBeatPlan extracts ops array
  • Each op: create | update | delete | move
        │
        ▼
User applies ops (batch or individual)
  • onAddBeat, onUpdateBeat, onDeleteBeat, onMoveBeat
  • Saves with normal autosave flow
```

### Inline Edit Proposals

The AI edit flow uses a Cursor-inspired pending edit system:

1. Agent calls `submit_edits` tool with an array of structured edits
2. Each edit targets an `elementId` with new `type`, `content`, and optional `newElements[]` for splits/inserts
3. Edits stream to the frontend as a `final` event payload
4. `AIChat` calls `onProposeEdits` which populates `App.tsx`'s `pendingEdits` Map
5. `ScriptEditor` renders each pending edit inline on the target element with accept/reject buttons
6. **Accept:** replaces element content (or splits into multiple elements if `newElements` present)
7. **Reject:** discards the proposal and restores original

---

## Configuration Reference

### Python AI Service

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | **Required.** OpenAI API key |
| `PORT` | `3002` | Server port |
| `AI_DEFAULT_CHAT_MODEL` | `gpt-4.1` | Default model for chat |
| `DATABASE_URL` | — | Full PostgreSQL connection string |
| `DB_HOST` | `localhost` | Database host (if no `DATABASE_URL`) |
| `DB_PORT` | `5432` | Database port |
| `DB_NAME` | `screenwriter` | Database name |
| `DB_USER` | `screenwriter` | Database user |
| `DB_PASSWORD` | `screenwriter` | Database password |
| `LANGFUSE_ENABLED` | `true` | Enable Langfuse tracing |
| `LANGFUSE_PUBLIC_KEY` | — | Langfuse public key |
| `LANGFUSE_SECRET_KEY` | — | Langfuse secret key |
| `LANGFUSE_HOST` | `https://cloud.langfuse.com` | Langfuse server URL |
| `LANGFUSE_LOG_CONTENT` | `false` | Log full prompt/response content |

### Node Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server port |
| `DATABASE_URL` | — | Full PostgreSQL connection string |
| `DB_HOST` | `localhost` | Database host (if no `DATABASE_URL`) |
| `DB_PORT` | `5432` | Database port |
| `DB_NAME` | `screenwriter` | Database name |
| `DB_USER` | `screenwriter` | Database user |
| `DB_PASSWORD` | `screenwriter` | Database password |

### Frontend (Build-time)

| Variable | Default | Description |
|---|---|---|
| `VITE_API_BASE_URL` | `/api` | Base URL for the Node API |

---

## Docker Deployment

The `docker-compose.yml` defines four services:

| Service | Image | Port | Role |
|---|---|---|---|
| `postgres` | `postgres:16` | `5432` | Database |
| `backend` | `./server` | `3001` | Node/Express CRUD API |
| `ai-service` | `./server-python` | `3002` | FastAPI AI service |
| `frontend` | Root Dockerfile (Vite build → nginx) | `5173→80` | Static frontend served by nginx |

All services share a `screenwriter-network` bridge network. PostgreSQL data is persisted via a `postgres_data` Docker volume. The database is initialized from `server/db/init.sql` on first run.

```bash
# Quick start
cp .env.example .env          # Add OPENAI_API_KEY at minimum
docker compose up --build

# Access
# Frontend:  http://localhost:5173
# Node API:  http://localhost:3001
# AI API:    http://localhost:3002
# Postgres:  localhost:5432
```
