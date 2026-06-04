> **⚠️ HISTORICAL — grounding spec, not current.** This is the original
> offline-LLM brainstorm (frog Jeeves + code-agent). It has been consolidated
> into `docs/assistant-plan.md` (see its "Decisions locked" block) and
> `docs/assistant-guide.md` (the start-from-scratch guide). Where they differ,
> THEY win. What survived from here: offline-first Ollama (wired), the
> tool-router/sandbox safety model (now `execSandbox.js` + the gated
> `systemToolPack`), OCR (future). What changed: persona is now a sophisticated
> turtle butler ("Jonah") not a frog; the assistant is a standalone core with a
> Moduli *port* exposing the full grid command surface, not a code-only agent.

---

Direct answer. Here’s the cleanest setup for what you’re building.

You want:

* Offline
* Executes NodeJS commands
* Understands structured instructions
* Handles Markdown well
* OCR if possible
* Persona layer (frog Jeeves assistant)
* Deterministic + safe execution

This is basically:

> Local LLM + Tool Router + Sandboxed Command Executor + Optional Vision/OCR Layer

---

# 1️⃣ Core Brain (Offline LLM)

### Best Options Right Now

**If you want strong reasoning + tool use:**

* **Ollama**
* Model: `qwen2.5-coder` or `deepseek-coder`
* If you want multimodal (image input): `llava` via Ollama

Why:

* Great at NodeJS
* Handles Markdown well
* Lightweight
* Easy local API
* Works cleanly with tool calling patterns

Example:

```bash
ollama run qwen2.5-coder:7b
```

Or run as server:

```bash
ollama serve
```

Then call it from your Node app via HTTP.

---

# 2️⃣ Architecture You Actually Want

Do NOT let the model directly execute Node commands.

You want this pattern:

```
User → LLM → Structured Tool Output → Tool Router → Node Executor → Result → LLM → Response
```

This prevents chaos.

---

# 3️⃣ Tool-Calling Setup (Critical)

Instead of letting it output raw commands, force it to output JSON like this:

```json
{
  "tool": "create_file",
  "args": {
    "path": "components/FrogPanel.jsx",
    "content": "..."
  }
}
```

or

```json
{
  "tool": "run_command",
  "args": {
    "command": "npm install axios"
  }
}
```

Then your Node backend:

```js
if (tool === "create_file") {
  fs.writeFileSync(path, content);
}
```

This is how you avoid it going rogue.

---

# 4️⃣ Markdown Handling

LLMs already handle markdown well.

Just:

* Store responses as `.md`
* Or pipe through `marked` / `remark`
* Render in your app

If frog outputs:

```
# New Component
Here's what I made...
```

You render that inside your UI.

Done.

---

# 5️⃣ OCR (Offline)

Two good options:

### 🥇 Tesseract (easy)

* `tesseract.js`
* Fully offline
* Works in Node

### 🥈 PaddleOCR (stronger, heavier)

* Python based
* More accurate

If you want fully JS ecosystem:
Use `tesseract.js`.

Flow:

```
User drops image → OCR extracts text → Feed text to LLM → LLM decides action
```

---

# 6️⃣ Personality Layer (Frog Jeeves)

Do NOT bake personality into system prompt permanently.

Instead:

```
SYSTEM:
You are Jeeves the Frog.
You are concise.
You output tool calls in JSON when actions are required.
You speak briefly unless explaining.
```

Keep personality separate from tool logic.

---

# 7️⃣ Execution Safety Layer (VERY Important)

If you're letting it run Node commands:

Create a whitelist:

Allowed:

* npm install
* node scripts/*
* file writes inside project directory

Blocked:

* rm -rf /
* system commands
* network calls (if you want isolation)

Example:

```js
const allowedCommands = ["npm install", "node", "touch", "mkdir"];

if (!allowedCommands.some(cmd => input.startsWith(cmd))) {
  throw new Error("Command not allowed");
}
```

Even better:
Use a Docker container as execution sandbox.

---

# 8️⃣ Memory Layer

If you want frog to "remember" things about your app:

Use:

* Local vector DB (Chroma, LanceDB, or even SQLite + embeddings)
* Store summaries of project files
* Retrieve relevant files before each prompt

Flow:

```
User asks → Search relevant code → Inject into prompt → LLM responds
```

This is how you get reliable coding assistance.

---

# 9️⃣ Clean Stack Recommendation

If I were building this for your app:

### Stack:

* Ollama
* qwen2.5-coder:7b
* NodeJS backend
* Tool router (JSON schema enforced)
* Tesseract.js for OCR
* Marked for Markdown rendering
* SQLite for memory
* Docker sandbox for execution

Lightweight. Fully offline. Powerful.

---

# 10️⃣ Visual Frog Layer

Frontend:

* Animated frog SVG
* Idle state
* Typing state
* Thinking bubble
* "Executing…" animation

The personality should be UI-driven, not LLM-driven.

---

# 11️⃣ If You Want It REALLY Clean

Use this pattern:

```
LLM never touches shell.
LLM never touches filesystem.
LLM only emits structured intent.
Your backend executes.
```

That’s how real AI agents are built.

---

# Final Recommendation For You

Given how complex your app has become:

Start with:

* Ollama
* qwen2.5-coder
* JSON tool schema
* Strict tool router
* No direct shell access

Then expand.

Clean. Direct. This is the architecture you want.

---

# 🐸 Frog Jeeves Offline AI Architecture

## 1️⃣ High-Level Overview

```
Frontend (Frog UI)
        ↓
Node Backend (Agent Controller)
        ↓
Local LLM (Ollama)
        ↓
Tool Router (JSON → Safe Actions)
        ↓
Execution Sandbox
        ↓
Return Result → LLM → UI
```

The LLM never directly executes anything.

---

# 2️⃣ Core Layers

## 🖥 1. Frontend (Your App)

Responsibilities:

* Chat input
* Render markdown
* Frog animation states (idle / thinking / executing)
* Show diffs, file previews, confirmations

Nothing intelligent happens here.

---

## 🧠 2. Agent Controller (NodeJS)

This is the brain wrapper.

Responsibilities:

* Sends prompts to Ollama
* Enforces JSON tool schema
* Validates tool output
* Routes to safe executor
* Feeds result back to model

This is where you control everything.

---

## 🤖 3. Local LLM (Ollama)

Recommended:

* `qwen2.5-coder:7b` (best balance)
* `deepseek-coder` if heavier coding focus
* `llava` only if you want image reasoning

Run:

```bash
ollama serve
```

Call via:

```
http://localhost:11434/api/generate
```

Model outputs structured JSON when action is needed.

---

# 3️⃣ Tool Calling Pattern (Critical)

Force the model to output only one of these:

```json
{
  "type": "tool",
  "tool": "create_file",
  "args": { ... }
}
```

or

```json
{
  "type": "message",
  "content": "Regular response"
}
```

Never allow raw shell commands in free text.

---

# 4️⃣ Tool Router

Your Node layer parses:

```js
if (response.type === "tool") {
  executeTool(response.tool, response.args);
}
```

Supported tools example:

* create_file
* update_file
* delete_file
* run_script
* install_package
* read_file
* ocr_image

Nothing else exists.

If it tries something unknown → reject.

---

# 5️⃣ Execution Sandbox

DO NOT run commands directly.

Options:

### Simple

* Restrict commands
* Restrict directory
* Block system access

### Better

* Run inside Docker container
* Mounted project folder only
* No root permissions

This prevents catastrophic mistakes.

---

# 6️⃣ OCR Layer

Flow:

```
Image → Tesseract.js → Extract text → Send text to LLM
```

Keep OCR separate from LLM.
LLM should not "guess" text from images unless using multimodal model.

---

# 7️⃣ Markdown Handling

LLM returns markdown.
You render with:

* `marked`
* `remark`
* or your own renderer

No special architecture needed.

---

# 8️⃣ Memory (Optional but Powerful)

If you want frog to understand your codebase:

* Index project files
* Generate embeddings
* Store in SQLite or Chroma
* Retrieve relevant files per query
* Inject into prompt

Without retrieval, coding quality drops fast.

---

# 9️⃣ System Prompt Structure

Keep it strict.

Example:

```
You are Jeeves the Frog.
You must respond in JSON.
If an action is required, use the tool schema.
If not, respond as type=message.
Never output shell commands directly.
Be concise.
```

Personality lives here, but logic rules dominate.

---

# 🔟 Folder Structure Suggestion

```
/agent
   controller.js
   toolRouter.js
   schema.js
   sandbox.js
   memory.js

/llm
   ollamaClient.js

/tools
   fileTools.js
   commandTools.js
   ocrTool.js

/frontend
   FrogUI.jsx
```

Clean separation.

---

# 🧩 What This Gives You

* Fully offline
* Deterministic execution
* Safe automation
* Expandable tool system
* Personality layer without chaos

---

# The Rule That Makes It Work

LLM generates intent.
Your backend enforces reality.

If you break that rule, it becomes unstable.

---

If you want next:

* Minimal starter template code
* Exact JSON schema design
* Or advanced multi-step agent loop

Pick one.
