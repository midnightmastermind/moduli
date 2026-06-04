# Jonah — The Assistant Guide (start-from-scratch)

This is the **teaching + setup + testing** guide for the Moduli assistant.
It assumes **no prior AI experience**. By the end you'll understand what an
LLM actually is, how an "AI agent" is built from plain parts, how to run one
**offline on your own machine**, and how this project wires it up.

It consolidates three older docs:

- `docs/assistant-plan.md` — the design/roadmap (still the authoritative plan)
- `docs/aispecs.md` — the original offline-LLM spec (now **historical**; its
  code-agent vision lives on as the "system pack", see §9)
- the previous version of this guide

> **The big picture.** This assistant is meant to grow into *your own overall
> AI system*. **Moduli's chatbox is one "port" into it** — a surface that only
> sees Moduli's commands + your grid as context. It lives in this repo for now
> but is structured to be lifted out later. Keep that in mind: the *core* is
> general; the *Moduli part* is just one adapter.

---

## Table of contents

0. [Crash course: how LLMs & AI actually work](#0-crash-course-how-llms--ai-actually-work)
1. [What an "AI assistant" is made of](#1-what-an-ai-assistant-is-made-of)
2. [Architecture: core engine, tool packs, ports](#2-architecture-core-engine-tool-packs-ports)
3. [The backends: offline (Ollama) vs cloud (Anthropic) vs none](#3-the-backends)
4. [Setup — offline first](#4-setup--offline-first)
5. [Test it — what to type, what you should see](#5-test-it)
6. [How each layer works (and how to extend it)](#6-how-each-layer-works)
7. [Build your own tool](#7-build-your-own-tool)
8. [Memory (future)](#8-memory-future)
9. [The system pack — file & command execution (advanced, off by default)](#9-the-system-pack)
10. [Troubleshooting](#10-troubleshooting)
11. [Glossary + where to learn more](#11-glossary--where-to-learn-more)

---

## 0. Crash course: how LLMs & AI actually work

You don't need math to use this, but a correct mental model saves you hours.

### What a language model *is*

An **LLM (Large Language Model)** is one giant function that does exactly one
thing: **given some text, predict the next chunk of text.** That's it. It has
no memory, no goals, no internet — just "what word probably comes next."

It learned this by reading an enormous amount of text during **training** and
adjusting billions of internal numbers (**weights** / **parameters**) until its
next-word guesses got good. Training already happened; when you *run* the model
("**inference**") the weights are frozen. A "7B" model has ~7 **billion**
weights. Bigger = smarter but slower and needs more memory.

Everything clever an LLM appears to do — answering, summarizing, writing code —
is that one next-token trick applied over and over, very fast.

### Tokens

Models don't see words; they see **tokens** — pieces of words (`"Eminem"`
might be `Em|in|em`). Two practical consequences:

- **You pay/wait per token.** Cost and speed scale with how many tokens go in
  (your prompt) and come out (the reply).
- **The context window** — the max tokens a model can "see" at once (its
  short-term memory) — is finite (e.g. 8k–128k tokens). Go over it and the
  oldest text falls off. This is why we re-send the chat history every turn and
  keep prompts lean.

### Temperature (randomness)

When picking the next token the model can play it safe or take risks.
**Temperature** is that dial: `0` = deterministic/repeatable (good for tools &
code), higher = more varied/creative (good for brainstorming). For an agent that
calls tools you generally want it low.

### Why it "hallucinates"

Because it predicts *plausible* text, not *true* text. With no source, a model
will confidently invent facts. The fix is **grounding**: give it real data (a
Wikipedia summary, your grid state) and tell it to answer *from that*. That's a
big reason this assistant has lookup tools instead of relying on the model's
memory.

### What "tool calling" actually is

This is the key trick that turns a text-predictor into an **agent**. We tell the
model, in a structured way, "here are some functions you may use." Instead of
answering in prose, the model can emit a structured request like:

```json
{ "name": "wikipedia_import", "input": { "query": "Eminem" } }
```

Our code sees that, **runs the real function**, and feeds the result back as
more text. The model reads the result and decides what to do next. Loop that and
you have an agent: **LLM = brain, tools = hands, loop = the agent.** The model
never runs anything itself — it only *asks*; your backend decides whether and
how to act. That boundary is the whole safety story.

### Embeddings & RAG (preview — see §8)

A second AI trick: an **embedding** turns a piece of text into a list of numbers
(a vector) where *similar meaning = nearby numbers*. Store many and you can
"find the most relevant snippet to this question" by math. Feeding those
snippets into the prompt is **RAG (Retrieval-Augmented Generation)** — how you'd
later let the assistant answer questions about your own files/grid. We don't use
it yet; it's the future "deep memory."

### The one rule

> **The model generates *intent*. Your backend enforces *reality*.**
> Break that rule and the system becomes unsafe and unpredictable.

---

## 1. What an "AI assistant" is made of

Four ingredients. None are magic; most are plain HTTP.

1. **A model** — Ollama (local) or Claude (cloud). Takes text, returns text.
   Knows nothing about Moduli except what we tell it each turn.
2. **Tools** — functions the model may ask us to run (§0 "tool calling"). Each
   is a thin wrapper over our REST API or a sandboxed system call.
3. **A transcript** — the model is stateless, so we replay the whole
   conversation every turn. Stored in the browser's `localStorage` so the drawer
   survives a reload.
4. **An avatar + drawer** — pure UI. The personality is a **sophisticated turtle
   butler with a Gandalf-like beard** named **Jonah** — wise, dry, precise.
   Personality lives only in the system prompt + the avatar art, never in the
   tool layer.

---

## 2. Architecture: core engine, tool packs, ports

The assistant is built in three layers so the Moduli-specific part stays small
and the rest can become your standalone system.

```
                         ┌───────────────────────────────────────────┐
   A "PORT" assembles →  │  Moduli chatbox port (routes/apiV1.js +    │
   which tools + context │  assistantChat in assistantAgent.js)       │
                         │   • includes the Moduli tool pack          │
                         │   • includes the System pack ONLY if       │
                         │     ASSISTANT_EXEC=1                        │
                         └───────────────┬───────────────────────────┘
                                         │ hands a tool list + messages to…
                                         ↓
   CORE ENGINE          ┌───────────────────────────────────────────┐
   (domain-agnostic)    │  assistantAgent.js                         │
                        │   • picks a backend (Ollama→Claude→none)   │
                        │   • runs the agent loop (call tools, feed  │
                        │     results back, repeat, cap at 6)        │
                        └───────────────┬───────────────────────────┘
                                        │ runs tools from…
                                        ↓
   TOOL PACKS           ┌───────────────────────────────────────────┐
   (assistantTools.js)  │  moduliToolPack  → research/lookup + grid  │
                        │                    commands (scoped to the │
                        │                    user's token + grid)    │
                        │  systemToolPack  → file/command execution  │
                        │                    (general; off unless    │
                        │                    ASSISTANT_EXEC=1)        │
                        └───────────────────────────────────────────┘
```

**Why this shape?**

- The **core** doesn't know what Moduli is. Later you point a different port
  (a CLI, another app) at the same core with a different pack — that's the
  "bigger system."
- A **port** decides scope. The Moduli chatbox port only loads Moduli commands +
  *your* grid as context, so the assistant can't wander outside it.
- **Packs** are just lists of tools. Add a pack, the model can use it; remove it,
  it can't. No core changes.

**The assistant has zero direct database access.** Every Moduli action goes
through the public `/api/v1` REST surface with *your* Bearer token. Anything you
can do with `curl`, the assistant can do — and the security boundary is exactly
that token (delete it to revoke access).

---

## 3. The backends

Same chat endpoint; the core auto-selects (override with `ASSISTANT_BACKEND`):

| Order | Backend | What it is | When |
|---|---|---|---|
| 1 | **Ollama** (local) | A free program that runs models *on your machine*. Private, offline, no per-call cost. | **Preferred.** Used whenever `ollama serve` is reachable. |
| 2 | **Anthropic Claude** (cloud) | Hosted model via API key. Smarter/faster, costs ~cents/session, sends data to Anthropic. | Fallback when Ollama is down **and** `ANTHROPIC_API_KEY` is set. |
| 3 | **Deterministic** (no model) | A tiny pattern-matcher (regex → tool). No AI at all. | When neither model is available — demos, CI, "I have nothing installed." |

Offline-first is deliberate: the whole point is it can run with **no cloud and
no key**.

---

## 4. Setup — offline first

### Step A — install Ollama (the local model runtime)

Ollama is a small program that downloads + runs models locally and exposes an
HTTP API at `http://localhost:11434`.

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh
# (or: brew install ollama / download from ollama.com)
```

### Step B — pull a tool-capable model

We default to `qwen2.5-coder:7b` — small, fast, good at structured/JSON output
and tool calling. The `:7b` is the size; `7b` needs ~5–6 GB of RAM/VRAM. If your
machine is small, try `qwen2.5-coder:1.5b`; if it's big, `:14b` is smarter.

```bash
ollama pull qwen2.5-coder:7b
```

### Step C — run the model server

```bash
ollama serve     # leave this running in its own terminal
# sanity check:
ollama run qwen2.5-coder:7b "say hello"
```

That's the entire offline AI setup. **No account, no key, no internet** after
the model is downloaded.

### Step D — point the app at it (optional env)

Defaults already match a local Ollama, so usually nothing to do. To customize,
add to `server/.env`:

```bash
# Offline (defaults shown — only set to change them)
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5-coder:7b

# Optional cloud fallback (skip for pure offline)
# ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_MODEL=claude-haiku-4-5-20251001

# Force a backend instead of auto-select: ollama | anthropic | deterministic
# ASSISTANT_BACKEND=ollama
```

### Step E — mint an API token (the assistant's key to your grid)

The drawer talks to the grid with the same Bearer token any integration uses:

```bash
node --env-file=server/.env server/scripts/createApiToken.js \
  jtpomerenke@gmail.com 'read,write' 'jeeves'
```

Copy the `moduli_..._...` token it prints (shown once).

### Step F — run the app, open the drawer, paste the token

```bash
npm run dev        # client :5173, server :5000
```

Open the app, find the floating assistant button bottom-right, click the **⚙**
in the drawer, paste your token. Saved to `localStorage` — once per browser.

---

## 5. Test it

Each test proves a layer is wired. They work in any backend unless noted.

| Type this | What it proves | What you should see |
|---|---|---|
| `wiki photosynthesis` | UI → server → tool → Wikipedia round-trip | a search-results list |
| `what is Eminem` | the **general-info / lookup** path (summary, no page) | a short summary paragraph |
| `create a doc page of the Wikipedia article for Eminem` | the **research → page** pipeline | an "Imported … N containers/instances" message; refresh the grid and an *Eminem* subtree appears |
| `import:` + a markdown block | the deterministic markdown importer | a new subtree from your markdown |
| `list ops` | grid read path | your runnable operations |
| (Ollama/Claude only) `make me a quick page on octopus intelligence` | natural-language understanding picks the right tool | same import flow, no magic prefix |

If you have **no model** running, the natural-language ones return a help
message listing the set patterns — that's expected (deterministic mode).

---

## 6. How each layer works

- **System prompt** (`assistantAgent.js`, `SYSTEM_PROMPT`): a short paragraph
  giving Jonah his persona + rules + the tool list. First thing the model sees
  every turn. Edit it to change personality or discipline — nothing else.
- **Tool packs** (`assistantTools.js`): `moduliToolPack` (lookup + grid) and
  `systemToolPack` (file/command, gated). Each tool = `{ name, description,
  input_schema, destructive, run }`. The model reads the **description** to pick
  a tool, so descriptions must be specific.
- **The agent loop** (`ollamaLoop` / `llmLoop`): send messages+tools → model
  may emit tool calls → run them → feed results back → repeat. Hard cap
  `MAX_TOOL_ITERATIONS = 6` so a model calling tools in a circle can't run
  forever.
- **Backend selection** (`pickBackend`): Ollama if reachable, else Claude if
  keyed, else deterministic. `ASSISTANT_BACKEND` overrides.
- **Deterministic dispatcher** (`deterministicDispatch`): regex → tool, no model.
  Handles `what is X` (summary), `create a doc page of X` (import), `wiki X`
  (search), `import:`, `list ops`.
- **The drawer** (`client/src/ui/AssistantDrawer.jsx`): pure UI — token,
  messages, input; POSTs to `/api/v1/assistant/chat`.

---

## 7. Build your own tool

Two minutes. Example: a weather tool for the Moduli pack.

```js
// in assistantTools.js → moduliToolPack(...)'s returned array
{
  name: "get_weather",
  description: "Current weather for a latitude/longitude. Use for 'weather in X'.",
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

Add the matching `/api/v1/research/weather` endpoint, restart the server, done.
Both Ollama and Claude now see `get_weather` in the catalog and can pick it.

**Two rules:** keep tools **narrow** (specific shape + description — generic
"do anything" tools are un-pickable), and **never trust model input blindly**
(validate; risky ops require confirmation — see §9).

---

## 8. Memory (future)

Right now Jonah only "remembers" within one conversation (the replayed
transcript). Two planned upgrades, in order:

1. **Preference memory (start here).** A tiny local store (SQLite or a JSON
   file) of durable facts — *"I track water in oz", "default to my Library
   folder"*. Injected into the system prompt each turn. Low effort, high value.
2. **RAG over your stuff (later).** Embed your files/grid (§0), retrieve the
   most relevant snippets per question, inject them. Lets the assistant answer
   *"how does my schedule build work?"* grounded in real content. Heavier;
   only worth it once preference memory is in.

---

## 9. The system pack

> **Advanced. Off by default. This is the general "code-agent" capability from
> the original spec — part of your bigger system, not Moduli.**

When you set `ASSISTANT_EXEC=1`, `systemToolPack` registers filesystem +
command tools: `list_dir`, `read_file`, `write_file`, `run_command`,
`sandbox_info`. They let the assistant read/write files and run programs — the
"execute Node commands" idea from `aispecs.md`.

**Every safety control from that spec is enforced in `execSandbox.js`:**

- **Path jail** — all file ops + the command working directory are confined to
  one sandbox dir (`.assistant-sandbox/` by default, or `ASSISTANT_SANDBOX_DIR`).
  Paths that resolve outside it are rejected. The assistant can't touch your
  source.
- **Binary allow-list** — `run_command` only runs leading binaries you opt into
  (`node,npm,npx,ls,cat,echo,mkdir,touch` by default; extend with
  `ASSISTANT_EXEC_ALLOW`).
- **Metacharacter block** — no `; | & \` $ > < ( )`, so a whitelisted binary
  can't be chained into something else.
- **Timeout + output cap**, and a hard block on recursive `rm`.

These tools are flagged `destructive` / `requires_confirm`. **Before you rely on
this in earnest, build the approval-card UI** (the drawer should show a "Jonah
wants to run `npm test` — Approve/Reject" card before executing). The flag and
metadata are in place; the card is the tracked follow-up. The strongest future
hardening is running commands inside a **Docker** container instead of a path
jail (see `assistant-plan.md`).

> Until that confirm UI exists, treat `ASSISTANT_EXEC=1` as a *you, locally,
> deliberately* switch — exactly why it's off by default and absent from the
> Moduli chatbox.

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Drawer says "deterministic" but I installed Ollama | Is `ollama serve` running? Probe it: `curl localhost:11434/api/tags`. The model must also be pulled (`ollama pull qwen2.5-coder:7b`). |
| Ollama is up but replies are slow | `7b` on CPU is slow; it's much faster with a GPU. Try `qwen2.5-coder:1.5b` for speed, or use the Anthropic fallback. |
| Model answers but never calls tools | The model may not support tool calling, or descriptions are vague. Use a tool-capable model (qwen2.5-coder, llama3.1) and make descriptions specific. |
| "no Bearer token" | Click ⚙ in the drawer, paste the token from setup step E. |
| 401 unauthorized | Token expired/wrong scope. Mint a fresh `read,write` token. |
| Import works but page doesn't appear | Refresh the tab — the broadcast is fire-and-forget. |
| `run_command` says "not in allow-list" | Add the binary to `ASSISTANT_EXEC_ALLOW` (and make sure `ASSISTANT_EXEC=1`). |
| Model confabulates facts | Ground it: prefer `wikipedia_summary` (real source) and keep temperature low. |
| Tool result never reaches the model | `run` must return serializable JSON (call `.toObject()` on Mongoose docs). |

---

## 11. Glossary + where to learn more

**Glossary**

- **LLM** — large language model; a next-token predictor with billions of weights.
- **Token** — a chunk of text the model reads/writes; cost & context are measured in these.
- **Context window** — max tokens the model can see at once (its working memory).
- **Inference** — running a trained model to get output (vs. training it).
- **Weights / parameters** — the learned numbers inside the model ("7B" = 7 billion).
- **Temperature** — randomness dial; low = deterministic, high = creative.
- **Tool / function calling** — the model emitting a structured request your code runs.
- **Agent loop** — call model → run tools → feed results back → repeat.
- **Hallucination** — confident but false output; countered by grounding.
- **Embedding** — text turned into a vector so "similar meaning = nearby".
- **RAG** — retrieval-augmented generation; fetch relevant text, put it in the prompt.
- **Ollama** — a local runtime that downloads & serves models with an HTTP API.
- **System prompt** — the always-sent instructions that set role + rules.

**Where to learn more (beginner → deeper)**

- **Ollama docs** — `https://github.com/ollama/ollama` (install, model library,
  the `/api/chat` tool-calling format we use).
- **Anthropic "Tool use" guide** — the cleanest explanation of the tool-call
  loop (`docs.anthropic.com` → Tool use). The pattern is identical across
  providers.
- **"What is a token / context window"** — Anthropic & OpenAI both have short
  primers; search "LLM tokens context window explained".
- **Andrej Karpathy, "Intro to LLMs" (YouTube, ~1hr)** — the best plain-English
  explanation of how these models are trained and why they behave as they do.
- **Hugging Face "LLM Course"** — free, hands-on, goes from tokens to
  fine-tuning when you're ready to go deeper.
- **RAG / embeddings** — search "embeddings explained" + the LanceDB / Chroma
  quickstarts when you reach §8's phase 2.

Companion docs: `docs/assistant-plan.md` (roadmap + tool catalog),
`docs/api-testing.md` (the REST surface the tools sit on),
`docs/aispecs.md` (historical grounding spec).
