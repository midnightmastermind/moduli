# Assistant LLM Chatbox — Implementation Plan

_Draft 2026-05-21. Two grounding docs: `docs/aispecs.md` (offline LLM
architecture / persona notes) and `docs/api-plan.md` (the REST + CALL_API
surface this plan reuses as its action layer). The API plan is a peer
deliverable, not a sub-task of this one — it ships and is useful on its
own. The assistant just happens to be its biggest internal consumer._

_**Sequencing**: API Phases 1–3 already shipped. The assistant can start
on top of what's there today; Phase 4 (assistant tool catalog, persona,
import pipeline) is what this doc covers._

---

## Decisions locked (2026-06-03) — read this first

These supersede any conflicting detail later in this doc and in
`docs/aispecs.md` (which is now **historical grounding**, not current spec).
The teaching/setup companion is `docs/assistant-guide.md`.

1. **It's a standalone system; Moduli is one port.** The assistant is built
   as a domain-agnostic **core engine** (provider loops + selection + agent
   loop) that runs whatever **tool packs** a **port** hands it. The Moduli
   chatbox is one port — it loads the Moduli pack (scoped to the user's grid +
   token) and nothing else by default. It lives in this repo for now but is
   structured to be lifted out. Code: `server/services/assistantAgent.js`
   (core), `server/services/assistantTools.js` (packs), `assistantChat` =
   the Moduli port.
2. **Offline-first.** Backend auto-selects **Ollama (local) → Anthropic
   (cloud, optional) → deterministic (no model)**. Ollama + `qwen2.5-coder` is
   the default and the point; Anthropic is a fallback. Override with
   `ASSISTANT_BACKEND`. (Ollama is now WIRED, not deferred.)
3. **Persona: "Jonah" — a sophisticated turtle butler with a Gandalf-like
   beard.** Replaces both the "frog Jeeves" (aispecs) and the plain "Jarvis"
   (this doc's §3) — keep the dry, wise, precise manservant *tone*, change the
   mascot to the bearded turtle. Personality lives only in the system prompt +
   avatar art.
4. **Moduli pack = the FULL grid command surface**, not just page creation:
   research/lookup (`wikipedia_search/_summary/_import`, `import_markdown`),
   reads (`get_grid_state`, `list_modules/_occurrences/_fields/_operations`,
   `get_occurrence`), creates (`create_module/_occurrence/_field`), edits
   (`update_module/_occurrence/_field/_operation`, `set_occurrence_field`),
   deletes (`delete_*`), and ops (`run_operation`, `create_operation`). Each
   wraps an existing `/api/v1` endpoint.
5. **The code-agent capability is real but gated.** The older spec's
   filesystem/command execution ships as the **system pack** (`systemToolPack`
   + `execSandbox.js`): path-jailed, binary-allow-listed, metacharacter-blocked,
   timed out — and **OFF unless `ASSISTANT_EXEC=1`**. It is NOT exposed to the
   Moduli chatbox by default. Docker isolation + an approval-card UI are the
   next hardening steps before it should be used in earnest.
6. **Memory: simple first.** Start with a small local preference store
   ("I track water in oz") injected into the system prompt; RAG-over-files
   (embeddings) is a later phase (see §8 + the guide §8).

## The pitch

A conversational butler-style assistant — **think Jarvis / Alfred /
classic English manservant** — that helps the user run their grid. The
user types natural language in a chatbox; the assistant takes structured
actions through the existing API surface and reports back like a
competent aide: dry, efficient, never folksy, but always helpful.

Two characters make it more than a chatbox:

1. **It can look things up.** First-class Wikipedia search + summary
   tools, plus generic CALL_API for any other public source. The user
   asks "what's the population of Lisbon" and gets an answer cached
   into a Moduli page they can keep.

2. **It can build pages from research.** A "research → page" workflow:
   ask about a topic, the assistant fetches sources, summarizes, then
   produces a structured Moduli subtree (headings → containers,
   bullets → instances, prose → textblocks).

3. **It can import documents.** Drop a markdown / text / URL into the
   chat; it parses into containers + instances + textblocks. Phase A
   (deterministic markdown) is **already implemented** —
   `POST /api/v1/import/markdown`. Phase B (LLM-powered import of
   arbitrary prose) goes through the same endpoint with an LLM
   pre-processor.

UI is a side drawer with a small avatar floating bottom-right of the
grid. Click → drawer opens.

---

## 1. Why this is feasible

The API plan (Phases 1–3 shipped) gives the assistant a complete
action surface:

- Every CRUD verb on every entity, REST-shaped, scope-protected
- `POST /api/v1/operations/:id/run` lets the assistant invoke any
  user-defined op with `vars` and get effects + final `$vars` back
- `CALL_API` action lets pipelines themselves hit external endpoints
- **Server-side executor** (Phase 3) means the assistant doesn't need
  a browser tab to run ops — important for the headless research loop
- **Secrets store** lets the assistant carry API keys (e.g. an
  OpenWeather key, a paid Wikipedia mirror, etc.) without leaking
  them client-side
- **`POST /api/v1/import/markdown`** (this session) turns text into a
  Moduli subtree — the assistant generates markdown, hits this
  endpoint, and the user sees a structured page appear

Plus the operation-introspection layer (already in place) means the
assistant can answer "why didn't op X fire?" without a special tool —
`helpers/operationIntrospection.js` already produces the ten-set
record that explains every op's behavior.

---

## 2. Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Frontend: client/src/ui/AssistantDrawer.jsx (NEW)         │
│  ├─ Bottom-right floating avatar button (32×32)            │
│  ├─ Click → side drawer slides in from right               │
│  ├─ Chat transcript w/ Jarvis avatar on assistant turns    │
│  ├─ Input box + send button                                │
│  └─ Confirmation cards for destructive tool calls          │
└────────────┬───────────────────────────────────────────────┘
             │  POST /api/v1/assistant/chat
             ↓
┌────────────────────────────────────────────────────────────┐
│  Server: routes/assistant.js + services/assistantAgent.js  │
│  ├─ Loads system prompt + tool catalog (static, cached)    │
│  ├─ Loads state snapshot via existing /api/v1/grids/:id    │
│  ├─ Calls Ollama (local) or Anthropic SDK (hosted)         │
│  ├─ Validates tool output against the OpenAPI schemas      │
│  ├─ Routes safe tools (reads / wikipedia_search /          │
│  │   import_markdown / run_operation) through the same     │
│  │   REST endpoints any external integration would use     │
│  └─ Destructive tools return a "proposed action" card      │
│      to the frontend for user approval                     │
└────────────┬───────────────────────────────────────────────┘
             │  All actions go through /api/v1/* — same auth
             │  + rate-limit + idempotency as Zapier or curl.
             ↓
┌────────────────────────────────────────────────────────────┐
│  /api/v1/* (already shipped) + new tool endpoints:         │
│  ├─ /api/v1/research/wikipedia (NEW thin wrapper)          │
│  ├─ /api/v1/import/markdown    (shipped)                   │
│  └─ /api/v1/operations/:id/run (shipped, server-side)      │
└────────────────────────────────────────────────────────────┘
```

The assistant has **no special privileges**. It authenticates with the
same Bearer-token + scopes any other integration uses. The user can
revoke its access by deleting the token. This forces the assistant to
dogfood the public API.

---

## 3. The persona — Jarvis / Alfred

Replaces the early "frog Jeeves" idea with a more useful tone. The
assistant should read as a **competent English manservant**:

| Trait | Style |
|---|---|
| Tone | Dry, efficient, faintly formal. Never folksy. |
| Verbosity | Short by default. Long only when answering a research query. |
| Confidence | High but qualified. "Likely Lisbon, sir — though the source from 2019. Shall I update?" |
| Initiative | Proposes follow-ups. "Imported. Shall I tag it Geography as well?" |
| Errors | Owns them. "I made a mess of that — let me try the other endpoint." |

System-prompt skeleton:

```
You are an assistant for the Moduli workspace. Your style is a quiet,
competent English manservant — think Jarvis or Alfred. Be brief.

Capabilities:
- Look up information (Wikipedia first; other sources via CALL_API)
- Read and write entities in the user's grid via the /api/v1 REST surface
- Import documents (markdown, plain text, fetched URLs) as Moduli pages
- Run user-defined operations with vars
- Explain why an operation did or did not fire

Discipline:
- ALWAYS emit a JSON tool call when an action is required. Never
  pretend to take an action.
- For destructive tools (delete_*, update_operation, etc.), describe
  the change and ASK before proposing the tool call.
- When uncertain, say so plainly and ask one question — not three.

[TOOL_CATALOG]
[GRID_SNAPSHOT]
```

Personality lives in the system prompt and the UI affordances (avatar,
animations). Tool layer is impersonal — Jarvis on top of Zapier, not
Jarvis sprinkled through it.

**Avatar.** A small floating circular button (32×32) bottom-right of
the grid, rendered as a stylized portrait — gentleman-butler in a
silhouette. Sprite states:

- Idle: portrait, faint blink every few seconds
- Thinking: portrait with a small "..." badge
- Acting: portrait rotates 90° / spinner overlay
- Awaiting confirmation: portrait + small clipboard icon

UI state is purely client-side — not driven by the LLM. The drawer
itself is the same side-panel pattern Command Center uses.

---

## 4. Tool catalog

Each tool is a curated subset of an existing `/api/v1/*` endpoint
with a JSON schema + `destructive: bool` + `requires_confirm: bool`.
At call time the server validates against the schema, then dispatches
to the matching REST handler in-process (no extra HTTP hop).

### Research tools (always safe)

| Tool | Description | Backed by |
|---|---|---|
| `wikipedia_search` | Search Wikipedia, return top matches w/ title + snippet + URL | New: `GET /api/v1/research/wikipedia/search?q=...` |
| `wikipedia_summary` | Fetch the lede of a Wikipedia article | New: `GET /api/v1/research/wikipedia/summary?title=...` |
| `wikipedia_full` | Fetch the full article body as markdown (for import) | New: same path, `?format=markdown` |
| `fetch_url` | Fetch any public URL + return text (rate-limited per token) | Existing CALL_API path |

### Read tools (always safe)

| Tool | Backed by |
|---|---|
| `list_modules` | `GET /api/v1/modules?gridId=...` |
| `list_occurrences` | `GET /api/v1/occurrences?gridId=...` |
| `list_fields` | `GET /api/v1/fields?gridId=...` |
| `list_operations` | `GET /api/v1/operations?gridId=...&runnable=true` |
| `explain_operation` | wraps `analyzeOperation` (introspection) |
| `get_grid_state` | `GET /api/v1/grids/:id/state` |

### Write tools (require confirm for destructive)

| Tool | Confirm | Backed by |
|---|---|---|
| `create_module` | — | `POST /api/v1/modules` |
| `create_occurrence` | — | `POST /api/v1/occurrences` |
| `update_occurrence_field` | — | `PUT /api/v1/occurrences/:id/fields/:fid` |
| `bulk_update_fields` | ⚠️ | `POST /api/v1/fields/bulk` |
| `import_markdown` | ⚠️ | `POST /api/v1/import/markdown` (mints many entities) |
| `update_module` | ⚠️ | `PATCH /api/v1/modules/:id` |
| `delete_occurrence` | ✅ | `DELETE /api/v1/occurrences/:id` |
| `delete_module` | ✅ | `DELETE /api/v1/modules/:id` |
| `update_operation` | ✅ | `PATCH /api/v1/operations/:id` (pipeline edits!) |

### Action tools

| Tool | Confirm | Backed by |
|---|---|---|
| `run_operation` | ⚠️ | `POST /api/v1/operations/:id/run` |
| `dry_run_operation` | — | same, with `dryRun: true` |
| `make_research_page` | — | composite: `wikipedia_full` → `import_markdown` |

---

## 5. The "research → page" workflow

User: "Look up giraffes and make me a page on it."

Internally:

1. `wikipedia_search` with `q: "giraffe"` → top hit "Giraffe"
2. `wikipedia_full` with `title: "Giraffe"` → markdown
3. `import_markdown` with `gridId, parentId, markdown, title: "Giraffe"`
4. Returns `{ rootOccurrenceId, stats }`
5. Assistant: "Done — added a Giraffe page under your Library folder.
   Five sections, 23 instances, 8 textblocks. Open it?"

The user sees a single chat message + a Wikipedia-shaped page appear
in their grid. Every step goes through the public API — testable
without the assistant.

Composite tool `make_research_page` bundles steps 1–3 so the LLM only
emits one tool call. Internally it's three API calls.

---

## 6. The doc import pipeline

Three phases, increasing in capability:

### Phase A — deterministic markdown (✅ SHIPPED)

`POST /api/v1/import/markdown` — `services/markdownImporter.js`.
Handles structured markdown directly:

- `#` / `##` / `###` headings → container (role:container, kind:list),
  nested by depth
- `* / -` / `1.` list items → instance (role:instance, kind:list)
- prose paragraphs → textblock with TipTap JSON
- fenced code blocks → textblock with codeBlock node
- inline `**bold**`, `*italic*`, `` `code` ``, `[text](url)` → TipTap marks

Idempotent caller pattern: pass `Idempotency-Key` header to dedup
retries. `dryRun: true` returns the planned tree without minting.

### Phase B — LLM-powered prose import (NEXT)

Same endpoint, new shape: `{ text, gridId, parentId, useLLM: true }`.
For each chunk:

1. Send to the model with a "plan a Moduli tree" system prompt
2. Model returns markdown (using the conventions Phase A understands)
3. Re-enter `markdownToModuli()` with the LLM output

The LLM's output is JUST markdown. Phase A then deterministically
converts. Means the LLM only has to produce markdown — a well-studied
task — instead of inventing entity shapes.

### Phase C — fetched-source import (NEXT)

Same endpoint, `{ url, gridId, parentId }`:

1. Server fetches the URL
2. Sniffs content type — HTML → readability extraction (mozilla/readability),
   PDF → server-side pdf-parse, plain text → as-is
3. Hands the extracted text to Phase B (LLM-powered) for structuring
4. Mints entities via Phase A

The whole pipeline is one HTTP request from the user's POV.

### Phase D — bidirectional sync (FUTURE)

Edit the imported page in the UI → on save, regenerate markdown and
diff against the original source. Useful for "I'm tracking a Wikipedia
article and want to know when it changes."

---

## 7. LLM choice & runtime

Per `docs/aispecs.md`:

| Mode | Model | When |
|---|---|---|
| Offline (preferred) | `qwen2.5-coder:7b` via Ollama at `http://localhost:11434/api/generate` | Default. User runs `ollama serve` locally. |
| Hosted fallback | `claude-haiku-4-5-20251001` via Anthropic SDK | Optional. User pastes API key in CommandCenter → UserSettings. Fallback when Ollama is unreachable. |

Swappable behind `assistantAgent.generate({ messages, tools })`. Both
backends emit the same JSON tool-call envelope.

For the import-pipeline Phase B specifically: a smaller/cheaper model
is fine (markdown generation is well within capability). For research:
the same model handles fine-tuning the Wikipedia summary.

---

## 8. State snapshot strategy

The LLM needs to **see** the grid:

### Lazy snapshot (default, cached)

Per-conversation snapshot in the system prompt:

```json
{
  "grid": { "id", "name", "rows", "cols", "activeFilterId" },
  "modules": [{ "id", "label", "role", "kind" }],   // names only
  "fields": [{ "id", "name", "type" }],
  "operations": [{ "id", "name", "triggerObjects", "priority" }]
}
```

~5KB compressed. Cached against the model's prompt-cache breakpoint
(both Anthropic and Ollama keep KV cache warm across turns).

### Deep snapshot (on demand)

When the LLM asks for a specific entity via `list_occurrences` etc.,
the tool returns the full shape. Stays out of the cached prefix.

### Operation introspection (on demand)

When the user says "why didn't op X fire", call `explain_operation`
→ returns the 10-set record from `operationIntrospection.js`. Already
exists; no new code.

---

## 9. Confirmation UX

For any tool with `destructive: true` or `requires_confirm: true`:

1. LLM emits tool call
2. Server validates schema, computes a **preview** (e.g. "this will
   delete 3 occurrences and orphan 1 module"), does NOT execute
3. Server returns the proposed action + preview to the frontend
4. Frontend renders a confirmation card in the chat:

   ```
   ┌──────────────────────────────────────────┐
   │ Proposed action: import_markdown          │
   │   Would create 13 entities under         │
   │   "Library / Giraffe"                    │
   │     - 5 containers                       │
   │     - 5 instances                        │
   │     - 3 textblocks                       │
   │                                          │
   │ [ Approve ]  [ Reject ]  [ Edit ]        │
   └──────────────────────────────────────────┘
   ```

5. On Approve → frontend emits a `assistant_confirm` event → server
   executes → result fed back to LLM
6. On Reject → fed back to LLM as a tool error so it can revise

Reads, lookups, creates, and run_operation execute immediately with a
small notice card (no approval). The "make_research_page" tool is
non-confirm (creates new content, doesn't destroy anything).

---

## 10. Phased rollout

### Phase 1 — Read-only chat + research tools (1-2 sessions)

- `services/assistantAgent.js` (Ollama integration, no hosted fallback)
- `routes/assistant.js` + `POST /api/v1/assistant/chat`
- Tool catalog: reads only + `wikipedia_search` + `wikipedia_summary`
  + `wikipedia_full` + `import_markdown` + `make_research_page`
- UI: floating avatar + drawer + chat transcript
- "Ask Jarvis": "look up giraffes and make me a page" works end-to-end

### Phase 2 — Write tools (1-2 sessions)

- Add create tools (no confirms)
- Add "show diff" notice cards
- User can say "make a tracker for water with a number field"
  and watch entities land

### Phase 3 — Mutations + confirms (2-3 sessions)

- Add update/delete tools with proposal/approve flow
- Diff previews via `helpers/operationIntrospection`
- All destructive actions show counts

### Phase 4 — Operations + import polish

- Tool: `create_operation` from natural-language description
  (few-shot examples of existing ops in the system prompt)
- LLM-powered import (Phase B of the import pipeline)
- Fetched-source import (Phase C)

### Phase 5 — Polish

- Hosted Anthropic fallback (paste API key in UI)
- Avatar animation polish
- OCR for image inputs (tesseract.js)
- Local SQLite memory for "remember that I track water in oz"

---

## 11. Open questions

- **Where does Ollama run on shared deploys?** Local dev fine. Shared
  deploy: ship Anthropic-only build, let power users wire their own
  Ollama for offline.
- **How do we sandbox `create_operation`?** A bad pipeline can fire-
  loop. Gate behind an "advanced mode" toggle for v1.
- **Multi-user sessions** — Jarvis sees the grid per-user. Each user
  has their own transcript.
- **Cost** — Hosted Anthropic at ~100 calls/day per user ≈ $0.10/day
  with caching. Ollama is free per call.

---

## 12. What this plan does NOT cover

- **Voice input** — defer
- **Multi-step agentic tasks** ("set up my whole morning routine") —
  Phase 5+. Would need a planner/executor split.
- **Code-mode** — Jarvis doesn't write JSX. The codebase has a
  pipeline-action layer that's much safer; the assistant stays there.

---

## 13. Refs

- `docs/aispecs.md` — the philosophy this plan is grounded in
- `docs/api-plan.md` — REST + CALL_API surface (all consumed by tools)
- `docs/api-testing.md` — how to verify the API surface works
- `client/src/helpers/operationActions.js` — pipeline action shapes
- `client/src/helpers/operationIntrospection.js` — analyze-an-op helper
- `server/services/markdownImporter.js` — Phase A import (shipped)
- `CLAUDE.md` handoff item 10 — the original trigger for this plan
