# Assistant LLM Chatbox — Implementation Plan

_Draft 2026-05-20. Two grounding docs: `docs/aispecs.md` (offline LLM
architecture / Jeeves persona) and `docs/api-plan.md` (the REST + CALL_API
surface this plan reuses as its action layer). The API plan is a peer
deliverable, not a sub-task of this one — it ships and is useful on its
own. The assistant just happens to be its biggest internal consumer._

_**Sequencing**: the API needs to exist before Phase 2 of this plan
(creates) lands. Phase 1 (read-only chat) can run against an earlier API
phase or even directly against the REST stubs. Don't block the assistant
work on the entire API surface being complete._

The goal: a conversational chatbox embedded in Moduli that can DO things —
create operations, occurrences, modules, attach fields, navigate filters,
save templates, run ops on demand, explain why an op didn't fire, etc. The
user types natural language; the assistant emits structured tool calls;
those tool calls land as the same kinds of effects our pipeline already
emits (`CREATE_ITEM`, `UPDATE_OCCURRENCE`, `APPLY_TEMPLATE`, `RUN_OPERATION`,
etc.). The user sees a confirmation step for anything destructive, then
the live data updates the same way it does for a manual edit.

This doc is **the plan**. `docs/aispecs.md` is the **architecture
philosophy** — Ollama, tool router, persona separation, no raw shell, etc.
Everything below stays consistent with that philosophy.

---

## 1. Why this is feasible in Moduli specifically

Moduli's mutation surface is already shaped exactly the way an LLM agent
wants to consume it — and with the API plan in place, the assistant's
"hands" are just HTTP calls:

- **The API IS the action surface** — once `docs/api-plan.md` ships, every
  CRUD operation is a documented REST endpoint with a JSON schema (the
  OpenAPI doc at `/api/v1/openapi.json`). The assistant's tool catalog is
  a curated subset of those endpoints. No need to wire each tool
  individually to CommitHelpers.
- **`POST /api/v1/operations/:id/run`** with `wait: true` lets the
  assistant invoke any user-defined operation and get the result vars
  back synchronously. This is how complex compound actions work — the
  user (or Jeeves) can define an op, then call it from chat.
- **`CALL_API` pipeline action** means the assistant can also live INSIDE
  an op if we want it to: a "talk to Jeeves" op could `CALL_API` out to
  Ollama, parse the response, and dispatch follow-up effects — no
  separate assistant server needed for the simple case.
- **State is already serializable** — Redux-shaped maps (`modulesById`,
  `occurrencesById`, `fieldsById`, `operationsById`, etc.) — easy to
  snapshot via `GET /api/v1/grids/:id/state`, easy to diff, easy to feed
  into a prompt.
- **Operation introspection exists** — `helpers/operationIntrospection.js`
  analyzes every operation and emits ten sets (`fields_written`,
  `fields_read`, `triggered_by_fields`, `invokes_operations`,
  `created_modules`, ...). The "explain why op X didn't fire" use case
  is already solvable; the LLM just needs to read the introspection record.

The hard parts elsewhere — wrangling DOM state, parsing free-form code,
auditing what changed — are already solved by our architecture.

---

## 2. Where it lives

```
┌────────────────────────────────────────────────────────────┐
│  Frontend (client/src/ui/AssistantPanel.jsx)                │
│  ├─ Chat input + transcript                                 │
│  ├─ Frog (Jeeves) animation states                          │
│  ├─ Render markdown responses                               │
│  ├─ Render proposed tool calls as confirmation cards        │
│  └─ Show diff previews for destructive actions              │
└────────────┬────────────────────────────────────────────────┘
             │  POST /api/assistant/chat
             ↓
┌────────────────────────────────────────────────────────────┐
│  Server route: server/services/assistantAgent.js            │
│  ├─ Loads system prompt + tool catalog (static, cached)     │
│  ├─ Loads state snapshot via GET /api/v1/grids/:id/state    │
│  ├─ Calls Ollama (or Anthropic SDK as hosted fallback)      │
│  ├─ Validates tool output against JSON schema               │
│  ├─ For non-destructive tools: calls the REST endpoint       │
│  │   directly (internal HTTP, same auth as the user)         │
│  └─ For destructive tools: returns "proposed action" payload │
│      to the frontend for confirmation                        │
└────────────┬────────────────────────────────────────────────┘
             │  Internal HTTP — /api/v1/* (Section 1)
             ↓
┌────────────────────────────────────────────────────────────┐
│  Existing REST API (see docs/api-plan.md)                   │
│  └─ All CRUD + operation execution lives here. The          │
│     assistant has no special privileges — uses the same      │
│     tokens and scope checks any other integration uses.      │
└────────────────────────────────────────────────────────────┘
```

Side panel, not modal — same drawer pattern as the existing Command Center
(`client/src/ui/CommandCenter.jsx`). Toggles from a button in the Toolbar.

**Why route through the public API instead of internal function calls:**
the assistant is just another integration. If the REST surface is good
enough for Zapier and the user's own scripts, it's good enough for Jeeves.
This forces us to dogfood our own API and makes the assistant's
permissions explicit (it has a token, with scopes, that the user can
revoke).

---

## 3. LLM choice & runtime

Follow `docs/aispecs.md`:

| Mode | Model | When |
|------|-------|------|
| Offline (preferred) | `qwen2.5-coder:7b` via Ollama at `http://localhost:11434/api/generate` | Default. User runs `ollama serve` locally; the assistant talks to it. |
| Hosted fallback | `claude-haiku-4-5-20251001` via Anthropic SDK | Optional. User pastes their API key in CommandCenter → UserSettings. Falls back to this when Ollama isn't reachable. |

The runtime is **swappable behind one interface** — `assistantAgent.js`
exposes `generate({ messages, tools })` and dispatches internally. Both
backends emit the same JSON tool-call envelope, so the rest of the system
doesn't care which one ran.

---

## 4. Tool catalog

Tools are the **action surface area** of the assistant. Each tool maps
1:1 to a CommitHelpers function or a pipeline-action effect. Each has a
JSON schema, a `destructive: boolean` flag, and a `requires_confirm` flag.

Initial catalog (v1):

### Reads (always safe, no confirm)

| Tool | Maps to | Returns |
|------|---------|---------|
| `list_modules` | `state.modulesById` filtered by role | Array of `{id, label, role, kind}` |
| `list_occurrences` | `state.occurrencesById` filtered by `parentId` / `gridId` | Array of `{id, moduleId, parentId, fields}` |
| `list_fields` | `state.fieldsById` | Array of field definitions |
| `list_operations` | `state.operationsById` | Array of operation definitions |
| `get_operation_introspection` | `helpers/operationIntrospection.analyzeOperation(opId)` | The 10-set record (fields_written, triggered_by_fields, etc.) — used for "why didn't op X fire" |
| `get_effective_filter` | `state/selectors.getEffectiveFilterForOccurrence(occId)` | The cascaded filter map for that occurrence |

### Creates (low-risk, no confirm)

| Tool | Maps to |
|------|---------|
| `create_module` | `CommitHelpers.createModule` (`role`, `kind`, `label`, `fieldBindings`) |
| `create_occurrence` | `CommitHelpers.createOccurrence` (`moduleId`, `parentId`, `fields`) |
| `create_field` | `CommitHelpers.createField` (`name`, `type`, `meta.optionsSource`, ...) |
| `attach_field_to_module` | Mutates `module.fieldBindings` |
| `add_to_pool` | The `ADD_TO_POOL` effect |

### Mutations (require confirm if writing existing entities)

| Tool | Confirm | Notes |
|------|---------|-------|
| `update_module` | ✅ | Renames, kind changes, fieldBindings edits |
| `update_occurrence` | ✅ | Field writes, meta writes |
| `update_field` | ✅ | Type changes, optionsSource edits |
| `update_operation` | ✅ | Pipeline edits — most destructive of all |
| `apply_template` | ✅ | Mints a subtree; preview = list of nodes to be created |

### Deletes (always confirm, always with preview)

| Tool | Confirm | Notes |
|------|---------|-------|
| `delete_module` | ✅✅ | Lists all occurrences that will be orphaned |
| `delete_occurrence` | ✅ | Lists children that will go with it |
| `delete_field` | ✅✅ | Lists every module/occurrence binding |
| `delete_operation` | ✅✅ | Lists any RUN_OPERATION callers |

### Triggers (cheap, but log them)

| Tool | Confirm | Notes |
|------|---------|-------|
| `run_operation` | ⚠️ | Lists side effects from `operationIntrospection.fields_written` first |
| `set_active_filter` | — | Toolbar nav |
| `nav_filter_value` | — | Date-arrow nav |

Each tool ships with:
1. **JSON schema** — fed into the LLM's tool-use prompt.
2. **Server handler** — validates args, calls the CommitHelpers equivalent.
3. **Preview function** — for destructive tools, computes what would
   change (used by the frontend confirmation UI).
4. **Telemetry hook** — logs `{tool, args, success, durationMs}` per call.

---

## 5. State snapshot strategy

The LLM needs to **see** the grid before it can reason about it. Three
levels of context:

### Lazy snapshot (default)
Per-turn snapshot fed into the system prompt:
```js
{
  grid: { id, name, rows, cols, activeFilterId, activeFilterValues },
  active_view: { panelId, pageId, kind },
  modules: modules.map(m => ({ id, label, role, kind })),  // names only
  fields: fields.map(f => ({ id, name, type })),
  operations: operations.map(o => ({ id, name, triggerObjects, priority })),
}
```
~5KB compressed for a medium grid. **Cached against
`prompt_caching` cache_control breakpoint** — only changes when the grid
schema changes, not every turn.

### Deep snapshot (on demand)
When the LLM asks for a specific entity (`list_occurrences` etc.), the
tool returns the full shape. Stays out of the cached prefix.

### Operation introspection (on demand)
When the user says "why didn't tracker X fire", call
`get_operation_introspection(opId)` and feed the 10-set result into the
conversation. Already exists; no new code.

---

## 6. Confirmation UX

For any tool with `destructive: true` or `requires_confirm: true`, the
flow is:

1. LLM emits tool call.
2. Server validates schema, computes a **preview** (e.g. "this will
   delete 3 occurrences and orphan 1 module"), but does NOT execute.
3. Server returns the proposed action + preview to the frontend.
4. Frontend renders a **proposal card** in the chat transcript:
   ```
   ┌──────────────────────────────────────────────┐
   │ 🐸 Jeeves wants to:                          │
   │    Delete module "Old Habit Tracker"         │
   │                                              │
   │ This will:                                   │
   │   • Remove 1 module                          │
   │   • Orphan 14 occurrences (in 3 containers)  │
   │   • Break 2 operations that reference it     │
   │                                              │
   │ [ Approve ]  [ Reject ]  [ Show diff ]       │
   └──────────────────────────────────────────────┘
   ```
5. On Approve, the frontend emits a `assistant_confirm` socket event with
   the proposal id. Server executes. Result fed back to LLM.
6. On Reject, fed back to LLM as a tool error so it can revise.

Reads, creates of new entities, and trigger calls (`run_operation`)
execute immediately with a small notice card.

---

## 7. Persona layer (Frog Jeeves)

Per `docs/aispecs.md` §6 — personality is system-prompt + UI, never baked
into tool logic. Two-part system prompt:

```
[SYSTEM_BASE]
You are Jeeves, a frog assistant for Moduli. You help the user manage
their grid, modules, fields, and operations through structured tool
calls. You speak briefly and clearly. You ALWAYS emit JSON tool calls
when an action is required; you NEVER attempt to execute commands
yourself.

[TOOL_CATALOG]
<JSON schemas for all available tools>

[GRID_SNAPSHOT]
<lazy snapshot, cached>
```

The frog character lives in the UI:
- Idle: blinking sprite
- Typing: waving sprite
- Executing tool: spinning sprite + "Doing the thing..." caption
- Confirming: holding up a sign sprite

Animation states are driven entirely by client-side message state, not
by the LLM's output. Single source of truth.

---

## 8. Prompt caching

Anthropic SDK and Ollama both support a form of prefix caching. The
static portion of every request is:
- System prompt (~1KB)
- Tool catalog JSON schemas (~10KB)
- Lazy state snapshot (~5KB)

Total ~16KB cached. Per-turn input is just the user message + recent
transcript (~2-3KB). For Anthropic, this means **a single `cache_control:
{type: "ephemeral"}` breakpoint** at the end of the tool catalog gets us
cache hits on every subsequent turn within the 5-min TTL.

For Ollama there's no formal cache API but the model's KV cache stays
warm across turns in a session as long as the prefix doesn't change.

---

## 9. Phased rollout

### Phase 1 — Read-only (1-2 sessions of work)
- Server route `server/services/assistantAgent.js`
- Ollama integration only (no hosted fallback yet)
- Tool catalog: reads only (`list_*`, `get_*`)
- UI: drawer panel, chat transcript, no confirmation cards
- "Ask Jeeves" works for "what fields does X have?" / "why isn't op Y firing?"

### Phase 2 — Creates (1-2 sessions)
- Add create tools (no confirms)
- Add "show diff" notice cards
- User can say "make a new tracker for water with a number field" and
  watch the modules + fields land

### Phase 3 — Mutations + confirms (2-3 sessions)
- Add update/delete tools with the proposal/approve flow
- Diff previews via `helpers/operationIntrospection`
- All destructive actions show counts

### Phase 4 — Operations (largest unknown)
- Tool: `create_operation` that takes a natural-language description and
  emits a full pipeline (triggers + steps)
- Probably needs few-shot examples in the system prompt (existing ops
  serialized as before/after pairs)

### Phase 5 — Polish
- Hosted Anthropic fallback
- Frog animation polish
- OCR for image inputs (tesseract.js)
- Local SQLite memory for "remember that I like to track water in oz"

---

## 10. Open questions

- **Where does Ollama run on shared deploys?** Local dev: fine. Server
  deploy: probably ship an Anthropic-only build for hosted users and let
  power users wire their own Ollama for offline.
- **How do we sandbox `create_operation`?** A bad pipeline can fire-loop.
  Probably gate operation-create behind an "advanced mode" toggle for v1.
- **Multi-user sessions** — does Jeeves see other users' edits in-context?
  Probably yes (the snapshot is per-grid, not per-session), but each user
  has their own chat transcript.
- **Cost** — even with caching, hosted Anthropic at ~100 calls/day per
  active user is ~$0.10/day. Manageable. Ollama is free per call.

---

## 11. What this plan does NOT cover (yet)

- **Voice input** (defer)
- **Multi-step agentic tasks** (e.g. "set up my whole morning routine") —
  v2; would need a planner/executor split
- **Code-mode** — Jeeves shouldn't write JSX directly. The codebase has a
  pipeline-action layer that's much safer; the assistant stays in that
  layer.

---

## 12. Refs

- `docs/aispecs.md` — the philosophy this plan is grounded in
- `client/src/helpers/CommitHelpers.js` — the mutation contract
- `client/src/helpers/operationActions.js` — pipeline-action shapes
- `client/src/helpers/operationIntrospection.js` — the analyze-an-op helper
- `client/src/state/selectors.js` — read-side helpers
- `CLAUDE.md` handoff item 10 — the trigger for this plan
