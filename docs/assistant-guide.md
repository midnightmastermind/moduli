# Jarvis — Implementation & Testing Guide

This is a **teaching guide** for the Moduli assistant ("Jarvis"). It
walks through what an AI assistant actually IS in implementation terms,
how the pieces fit, what setup you need to do, and how to test each
layer. Read it top-to-bottom on first run; come back to sections 5–7
when you're building or debugging.

Companion to `docs/assistant-plan.md` (the design) and
`docs/api-testing.md` (the API surface Jarvis sits on top of).

---

## Table of contents

1. [What an "AI assistant" actually is](#1-what-an-ai-assistant-actually-is)
2. [Architecture in one diagram](#2-architecture-in-one-diagram)
3. [The two operating modes](#3-the-two-operating-modes)
4. [Setup — do this once](#4-setup--do-this-once)
5. [Step-by-step test — what to type, what you should see](#5-step-by-step-test--what-to-type-what-you-should-see)
6. [How each layer works](#6-how-each-layer-works)
7. [Build your own tool](#7-build-your-own-tool)
8. [Troubleshooting](#8-troubleshooting)
9. [What's deferred](#9-whats-deferred)

---

## 1. What an "AI assistant" actually is

You can build a real AI assistant from **four ingredients**. None of
them are magic. Most are plain HTTP.

### Ingredient 1: a language model

A language model is a black box that takes text in and returns text out.
For Jarvis we use either:

- **Anthropic Claude** (cloud, costs ~$0.10/day per active user) — set
  `ANTHROPIC_API_KEY` in `server/.env`
- **Ollama** (local, free, slower) — install via `brew install ollama`
  and run `ollama serve` — _next session_

The model doesn't know anything about Moduli specifically. It only
knows what we tell it in two places:

- **System prompt** — a paragraph that explains its role and rules.
  Always sent. Lives in `server/services/assistantAgent.js` as
  `SYSTEM_PROMPT`.
- **Tool catalog** — a list of structured "things you can do" with
  JSON schemas. Sent on every turn.

### Ingredient 2: tools (function calling)

A "tool" is just a function the model can ask us to run. The model
emits something like:

```json
{ "tool_use": { "name": "wikipedia_import", "input": { "query": "giraffe" } } }
```

We see that, run our `wikipedia_import` function, and feed the result
back to the model:

```json
{ "tool_result": { "rootOccurrenceId": "abc-123", "stats": {...} } }
```

The model then decides whether to call another tool or write a final
response. This back-and-forth is the **agent loop**.

In Jarvis, every tool is a thin wrapper over an existing `/api/v1`
endpoint. Jarvis has no special powers — it makes the same HTTP calls
your own Zapier integration would.

### Ingredient 3: a chat transcript

The model is **stateless**. It doesn't remember what you said
yesterday. To give it continuity, we replay the whole conversation
on every turn:

```json
[
  { "role": "user",      "content": "look up giraffes" },
  { "role": "assistant", "content": "Imported. 17 containers..." },
  { "role": "user",      "content": "now do octopuses" }
]
```

Jarvis stores this in `localStorage["moduli_assistant_history"]` so
the user can close and reopen the drawer without losing context.

### Ingredient 4: an avatar + drawer

Pure UI. A floating button bottom-right, click → side panel slides in,
chat history renders, input at the bottom. No magic — just React.
Personality lives in the **system prompt** and the visual sprite, not
in the tool layer.

That's it. Four ingredients. The rest is plumbing.

---

## 2. Architecture in one diagram

```
┌───────────────────────────────────────────────────────────────────┐
│  Browser                                                          │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  AssistantDrawer (client/src/ui/AssistantDrawer.jsx)        │  │
│  │  ─ floating "J" button, click → drawer                       │  │
│  │  ─ chat transcript + input                                   │  │
│  │  ─ Bearer token in localStorage                              │  │
│  └────────────┬────────────────────────────────────────────────┘  │
└───────────────│───────────────────────────────────────────────────┘
                │ POST /api/v1/assistant/chat
                │ { messages, gridId }
                ↓
┌───────────────────────────────────────────────────────────────────┐
│  Server: routes/apiV1.js (chat handler)                           │
│        ↓                                                          │
│  Server: services/assistantAgent.js                               │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  if ANTHROPIC_API_KEY → llmLoop (real Claude)                │  │
│  │  else → deterministicDispatch (pattern matcher)             │  │
│  │                                                              │  │
│  │  Both modes call tools:                                      │  │
│  │  ─ wikipedia_search / _import                                │  │
│  │  ─ import_markdown                                           │  │
│  │  ─ list_operations / run_operation                           │  │
│  └────────────┬────────────────────────────────────────────────┘  │
│               │                                                   │
│               ↓                                                   │
│  Each tool calls a /api/v1/* endpoint with the user's token       │
│  ─ Real fetch() back to localhost/api/v1 — no in-process magic    │
│  ─ Same auth/scope/rate-limit/idempotency as any other caller    │
└───────────────────────────────────────────────────────────────────┘
                ↓                              ↑
┌───────────────────────────────────────────────────────────────────┐
│  Existing /api/v1 surface (Phases 1–4, all shipped)              │
│  ─ /research/wikipedia/*  ← hits en.wikipedia.org/api            │
│  ─ /import/markdown        ← deterministic md → entities         │
│  ─ /operations/:id/run     ← server- or client-side executor     │
│  ─ /modules /occurrences /fields /...                            │
└───────────────────────────────────────────────────────────────────┘
```

**Key insight:** the assistant has zero direct database access. Every
mutation flows through the public REST API. That means anything you
can demo with `curl` you can demo through Jarvis — and the security
boundary is exactly the user's Bearer token.

---

## 3. The two operating modes

Same chat endpoint, two backends, picked automatically by whether the
server has an Anthropic API key.

### Mode A — deterministic dispatcher (default, no LLM)

When `ANTHROPIC_API_KEY` is **not** set, the server runs a tiny
pattern matcher instead of an LLM. Recognized inputs:

| You type | Jarvis does |
|---|---|
| `wiki <topic>` | Wikipedia search → top results |
| `look up <topic>` | Wikipedia full article → import as Moduli page |
| `research <topic>` | same |
| `page on <topic>` | same |
| `import wiki <topic>` | same |
| `import:\n<markdown>` | turn pasted markdown into a Moduli page |
| `list ops` | list runnable operations |
| anything else | "I don't have an LLM, set ANTHROPIC_API_KEY for natural language" |

**Why this exists.** It lets you demo the entire pipeline end-to-end
without paying for or installing any AI provider. The doc-import
side, the Wikipedia side, the persistence side — all testable in
dev with no LLM.

### Mode B — full LLM (Anthropic Claude)

When `ANTHROPIC_API_KEY` is set, the server runs an agent loop with
Claude Haiku (default) or whatever model you set via
`ANTHROPIC_MODEL`. The loop:

1. Send user message + system prompt + tool catalog + chat history to Claude
2. Claude emits text + optional tool calls
3. If tool calls: we run them, feed results back, GOTO 1
4. If no tool calls: this is the final response, return it
5. Max 6 iterations to prevent runaway loops

The model sees the **tools you've registered**. To add a new
capability, you register a new tool (section 7) and Claude can pick
it on the next turn without code changes elsewhere.

---

## 4. Setup — do this once

### Step 1 — Mint an API token

The drawer uses the same Bearer token as any other integration.

```bash
node --env-file=server/.env server/scripts/createApiToken.js \
  josh@jpoms.com 'read,write' 'jarvis'
```

You'll see something like:

```
  Raw token (SAVE THIS — it won't be shown again):
  moduli_<...>_<...>
```

Copy it. You'll paste it into the drawer settings in step 4.

### Step 2 — (Optional) Configure Anthropic Claude

Skip this if you want to start with Mode A (deterministic). Add to
`server/.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
# Optional — defaults to Haiku, which is fast and cheap
ANTHROPIC_MODEL=claude-haiku-4-5-20251001
```

You can get a key at [console.anthropic.com](https://console.anthropic.com).
Haiku is ~$1/million input tokens — a long Jarvis session costs cents.

### Step 3 — Start the server + client

```bash
# From repo root
npm run dev
```

Server on port 5000, client on 5173. Open `http://localhost:5173` in
your browser and log in.

### Step 4 — Open Jarvis + paste the token

In the bottom-right corner of the grid you'll see a small dark
circular **"J"** button. Click it. The chat drawer slides in.

Click the **⚙** (gear) icon in the drawer header. Paste your Bearer
token in the field. It saves to localStorage automatically — you'll
only do this once per browser.

You're set.

---

## 5. Step-by-step test — what to type, what you should see

These tests prove each layer of the stack is wired up. They work in
either mode (deterministic or LLM) unless noted.

### Test 1 — basic chat is wired

Type: `wiki photosynthesis`

You should see: a tool block with Wikipedia search hits, then a Jarvis
response listing 5 results.

**What this proves.** UI → server → assistant agent → wikipedia_search
tool → en.wikipedia.org/api round-trip → back to UI.

### Test 2 — research-to-page composite

Type: `look up giraffes`

You should see: a tool block with `wikipedia_import` output (stats like
`{ containers: 17, instances: 58, textblocks: 32 }`), then a Jarvis
response confirming the page was created with a URL.

After it finishes, refresh the Moduli grid — you should see a new
"Giraffe" subtree appear (look in your folder tree for a Giraffe
container with sections inside).

**What this proves.** The whole pipeline: search → full-article fetch →
HTML → markdown → Phase A importer → entities → socket broadcast → UI
sync. Everything from "type a word" to "see a page" in one chain.

### Test 3 — direct markdown import

Type the message exactly:

```
import:
# Notes on Coffee

## Process

- Roast beans
- Grind
- Brew

## Equipment

- French press
- Burr grinder
```

You should see: a tool block + a Jarvis response with stats. A "Notes
on Coffee" subtree should appear in your grid.

**What this proves.** The deterministic markdown importer handles
arbitrary user-supplied docs. The "import:" prefix tells Jarvis to
treat everything after as markdown, not a question.

### Test 4 — discovery

Type: `list ops`

You should see: a tool block + Jarvis showing 10 runnable operations
from your grid.

### Test 5 — natural language (Mode B only)

If you set `ANTHROPIC_API_KEY`, try:

```
make me a quick page on octopus intelligence
```

The LLM will parse the intent, pick the `wikipedia_import` tool, and
do the same import flow as Test 2 — but without you using a magic
prefix.

If you don't have a key, this will return the "I don't have an LLM"
message — that's expected.

---

## 6. How each layer works

Read this when you want to understand WHY something works or HOW to
extend it.

### 6.1 The system prompt (`assistantAgent.js` line ~20)

A few short paragraphs that describe Jarvis's tone and rules. It's
the first thing Claude sees every turn. Three sections:

1. **Persona** — "dry, efficient English manservant"
2. **Tool list** — names + one-line descriptions (full schema sent
   separately via the tools array)
3. **Discipline** — "always emit tool calls", "ask one question, not
   three", "summarize results in one sentence"

To change Jarvis's personality, edit `SYSTEM_PROMPT`. No other code
changes needed.

### 6.2 The tool catalog (`assistantAgent.js` `buildTools()`)

Each tool has four parts:

```js
{
  name: "wikipedia_import",            // unique id
  description: "Research a topic...",  // shown to the model
  input_schema: { ... },               // JSON Schema for the input
  destructive: false,                  // future: needs user confirm
  run: async (input) => { ... },       // what to do when called
}
```

The `run` function gets the input object the model produced and
returns whatever — an object, an array, a string. The agent
serializes it to JSON and feeds it back.

`run` is just a plain async function. It usually calls a public REST
endpoint via `fetch()` with the caller's token. **No special
privileges.** Same auth surface as Zapier.

### 6.3 The agent loop (`assistantAgent.js` `llmLoop()`)

```
while toolIterations < 6:
  resp = client.messages.create(...)
  push assistant turn to transcript
  if no tool_use blocks:
    break  ← model is done, return
  for each tool_use block:
    run the tool
    push result to transcript
  push results back as a "user" message
  toolIterations += 1
```

The `MAX_TOOL_ITERATIONS = 6` cap is critical — without it, a model
that calls tools in a circle would burn tokens forever.

### 6.4 The deterministic dispatcher (`assistantAgent.js` `deterministicDispatch()`)

Same shape as `llmLoop` but the "agent" is a series of regex checks:

```js
if (/^look\s*up\s+(.+)$/i.test(text)) {
  await runTool("wikipedia_import", { query: m[1] });
  return reply(...);
}
```

Easy to extend — add a new pattern, point it at a tool. No model
required. Useful for:

- Demos without an LLM key
- CI tests (no model = deterministic output)
- Fixed-format input where natural language is overkill (e.g.
  "remind me in 5 min")

### 6.5 The drawer (`client/src/ui/AssistantDrawer.jsx`)

Three pieces of state, all local:

- `token` — Bearer token, in localStorage
- `messages` — chat history, in localStorage so reload doesn't wipe
- `input` — the textarea

`send()` POSTs `{ messages, gridId }` to `/api/v1/assistant/chat`,
appends the response transcript, scrolls. That's it.

Avatar polish (animations, sprites, hover states) all goes in this
file. The chat protocol doesn't change.

### 6.6 The Wikipedia tools (`services/wikipediaTools.js`)

Three functions:

- `search(query)` — hits the MediaWiki search API
- `summary(title)` — hits the REST `/page/summary/<title>` endpoint
- `fullMarkdown(title)` — hits the REST `/page/html/<title>` endpoint,
  runs a small HTML → markdown converter

The HTML → markdown converter is **not** a general-purpose library.
It's tuned for Wikipedia's specific output: strips infoboxes, navboxes,
references, images; keeps headings + paragraphs + lists + inline marks.
Good enough for the Phase A importer to chew on.

### 6.7 The Phase A importer (`services/markdownImporter.js`)

A pure markdown parser. Headings → containers (nested by depth),
list items → instances, paragraphs → textblocks with TipTap JSON,
fenced code → code-block textblocks, inline marks (`**bold**`,
`*italic*`, `` `code` ``, `[text](url)`) → TipTap marks.

**No LLM involved.** This is just a markdown-to-entities translator.
The composite `wikipedia_import` flow is `wikipedia.fullMarkdown` →
`markdownImporter`. Two deterministic functions composed.

Phase B (future) replaces `wikipedia.fullMarkdown` with "feed any
unstructured text to an LLM and ask it to produce markdown" — then
the same Phase A importer chews on the LLM's output.

---

## 7. Build your own tool

Two-minute tutorial.

### Example: weather lookup

Say you want Jarvis to fetch the weather. Steps:

**Step 1.** Add a new REST endpoint in `server/routes/apiV1.js`:

```js
router.get("/research/weather", authAndLimit({ requireScope: "read" }), async (req, res) => {
  const { lat, lon } = req.query;
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m`);
  const j = await r.json();
  res.json({ ok: true, ...j.current });
});
```

**Step 2.** Add a tool in `server/services/assistantAgent.js`
`buildTools()`:

```js
{
  name: "get_weather",
  description: "Get current weather for a latitude/longitude.",
  input_schema: {
    type: "object",
    properties: { lat: { type: "number" }, lon: { type: "number" } },
    required: ["lat", "lon"],
  },
  destructive: false,
  run: async ({ lat, lon }) => {
    const r = await call("GET", `/research/weather?lat=${lat}&lon=${lon}`);
    return r.body;
  },
}
```

**Step 3.** Optionally add a deterministic pattern in
`deterministicDispatch()` so people without an LLM key can use it:

```js
const wm = /^weather\s+(.+)$/i.exec(text);
if (wm) {
  // hardcoded for demo
  const output = await runTool("get_weather", { lat: 41.88, lon: -87.63 });
  return reply(`Currently ${output.temperature_2m}°C.`, ...);
}
```

**Step 4.** Restart the server. Done.

In LLM mode, Claude now sees `get_weather` in the tool catalog and
will call it on prompts like "what's the temperature in Chicago".

In deterministic mode, the user can type `weather chicago` to invoke
it directly.

### Important: keep tools narrow

A common newbie mistake is to make tools generic ("run any SQL").
Don't. Each tool should have a specific, narrow shape with a clear
input schema. The model picks tools by reading their descriptions —
narrow, specific descriptions get the right tool picked. Generic
"do anything" tools are essentially un-pickable.

### Important: never trust LLM input blindly

If your tool runs anything based on model input — a query, a path,
a script — validate it. The model can produce anything, including
adversarial prompts injected via Wikipedia content or pasted markdown.

Safe operations (read APIs, structured CRUD): just validate the input
schema (which we do automatically).

Risky operations (run shell commands, eval code, write to arbitrary
file paths): require an explicit user confirmation card before the
tool runs. We have the `destructive: true` flag for this; the UI
should render a confirm card. (TBD as of this writing — see Phase 3
of `docs/assistant-plan.md`.)

---

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "no Bearer token" error in drawer | Click ⚙ in drawer header, paste the token from step 1 of setup. |
| 401 unauthorized | Token expired or wrong scope. Mint a fresh one with `read,write` scopes. |
| Drawer says "deterministic" even though I set ANTHROPIC_API_KEY | Server didn't pick up the env var. Restart the server. |
| Wikipedia import says "no matches" | Try a more specific query. The search hits English Wikipedia; non-English content needs the title verbatim. |
| Import works but page doesn't appear in UI | Refresh the tab. The broadcast is fire-and-forget; if the client wasn't connected when the import landed it'll show after reload. |
| Claude returns text but doesn't call tools | Check your tool descriptions. Vague descriptions like "do stuff" don't get picked. Make them specific. |
| Tool runs but model never sees the result | Make sure `run` returns serializable JSON (not a Mongoose Document — call `.toObject()` first). |
| 429 rate-limited | Default is 600 req/min per token. Wait for the `Retry-After`. |
| Chat history doesn't persist | localStorage might be cleared on incognito reload. By design. |
| Jarvis confabulates content | Mode B only. Claude can make things up — anchor responses to real tool calls (research_wikipedia returns real URLs). Tighten the system prompt. |
| `wikipedia_import` mints a wrong-looking page | Wikipedia's HTML structure can be unusual on niche articles. The HTML→md converter handles common cases. Edit `services/wikipediaTools.js` to refine. |

---

## 9. What's deferred (Phase 2+ of the assistant plan)

Currently shipped:

- ✅ Wikipedia search / summary / full article fetch
- ✅ Markdown import (Phase A — deterministic)
- ✅ Composite research → page
- ✅ Assistant chat endpoint with both modes
- ✅ Drawer UI

Not shipped (in roughly priority order):

1. **Write-tool confirmation cards** — for destructive tools
   (delete_module, update_operation), show a preview card the user
   must approve before the tool runs. Plumbing exists (the
   `destructive` flag); UI doesn't render approval cards yet.
2. **`create_operation` tool** — LLM generates a full pipeline from
   natural-language description. Needs few-shot examples in the
   system prompt.
3. **Phase B import** — feed arbitrary prose / URL, LLM converts to
   markdown, Phase A then mints entities. Replaces
   `wikipedia.fullMarkdown` with a generic LLM step.
4. **Phase C import** — POST a URL, server fetches + extracts text
   via readability, then Phase B handles it.
5. **Ollama backend** — local LLM as an alternative to Anthropic.
   Skeleton is in place; just need to wire the second provider in
   `assistantAgent.js`.
6. **Memory** — local SQLite store for "remember that I track water
   in oz". Per-user, persists across sessions.
7. **Voice input** — defer.
8. **Multi-step agentic tasks** — "set up my whole morning routine".
   Would need a planner/executor split.

See `docs/assistant-plan.md` §10 for the full roadmap.

---

## 10. The mental model

If you remember nothing else:

1. **An assistant = LLM + tools + a loop.** The LLM is the brain,
   tools are the hands, the loop is the agent.
2. **Tools are just functions.** They can call your API, hit the
   internet, query a DB. As long as they return JSON, the LLM is
   happy.
3. **The agent has no special powers.** It uses the same public
   API a `curl` command would. Auth + scope + rate-limit + everything.
4. **Personality lives in the system prompt + UI.** The tool layer
   stays impersonal. Jarvis on top of Zapier — not Jarvis sprinkled
   through it.
5. **Mode A (deterministic) is the friend you bring to demos.**
   It works without any model setup. Use it for CI and "I don't
   have a key" situations.

That's the whole pattern. Everything else is plumbing.
