# Local LLM Runner (llama.cpp + llama-swap) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Ollama with llama.cpp's `llama-server` behind llama-swap on the user's Windows PC (Radeon via Vulkan), and move Jonah and the import clean-up to one OpenAI-compatible client, so builds succeed and run as fast as this PC allows.

**Architecture:** On the PC, llama-swap (Windows-native) fronts two `llama-server` processes (a fast 3B, a 7B build model), both kept loaded, reached from the droplet through the existing Cloudflare tunnel. On the server, a new `services/llmClient.js` speaks `/v1/chat/completions` (tools + SSE streaming) and replaces every Ollama-native call. The prompt is ordered so the fixed part is byte-identical between requests (llama.cpp prefix cache). Build tools accept short row strings.

**Tech Stack:** Node 22 ESM server, vitest, llama.cpp b12387+ Windows Vulkan build, llama-swap (Windows release), PowerShell scheduled task, cloudflared.

**Spec:** `docs/superpowers/specs/2026-11-15-local-llm-runner-design.md`

## Global Constraints

- No cloud or paid models anywhere in the new path. The Anthropic backend in `assistantAgent.js` is left as it is (opt-in by env).
- One client code path: no Ollama-native `/api/chat` / `/api/tags` call may remain. Old `OLLAMA_*` env names are removed, not aliased (house rule: no legacy fallbacks).
- New env names: `LLM_URL`, `LLM_BUILD_MODEL`, `LLM_FAST_MODEL`, `LLM_AUTH_HEADER`, `IMPORT_LLM_MODEL`; `LLM_NUM_PREDICT` (default 1200), `LLM_TIMEOUT_MS` (180000), `LLM_TOTAL_BUDGET_MS` (300000), `LLM_TOOL_ALLOWLIST`. `CF_ACCESS_CLIENT_ID` / `CF_ACCESS_CLIENT_SECRET` unchanged.
- `ASSISTANT_BACKEND` values become `local | anthropic | deterministic`; result `mode` strings `"local"` / `"local-error"`.
- Model files live on a Windows disk (`C:\moduli-llm\models` or D:), never read from `\\wsl.localhost` (it crashed WSL, 2026-11-14).
- Import clean-up stays OFF (`IMPORT_AI_CLEANUP` unset).
- The eval runs against **test grid 2** only, never poms grid; every row it makes is deleted after.
- Cloudflare drops a response with no bytes for 100s: streaming must start early, tool calls included.
- Ollama is removed only after the new setup is watched working on prod and the user says so (Task 7).

## Review Focus

1. **A tool call split across many SSE chunks** (OpenAI streams `tool_calls[i].function.arguments` in fragments, `id`/`name` only on the first): it must reassemble into one call with complete JSON — pinned in Task 2.
2. **The model writes the call as text instead of `tool_calls`** (3B did this on 2026-11-02): `parseContentToolCall` must still recover it on the new path — pinned in Task 3.
3. **Something per-request lands before the tools in the rendered prompt** (date, places, location): every request re-reads ~6k tokens and nothing is faster — pinned in Task 3 (`systemPrompt` identical across two contexts) and measured in Task 6 (`timings.cache_n`).
4. **The PC is off / tunnel down**: liveness must fail within ~1s and Jonah must say the local model is unreachable, not hang until the 300s budget — pinned in Task 3.
5. **A row string with no URL, or a URL containing `|`**: `create_board` must keep a plain item / split on the LAST ` | ` only — pinned in Task 5.

---

### Task 1: The runtime on the PC (llama-swap + two llama-servers, at boot, through the tunnel)

**Files:**
- Create: `infra/llm/README.md`, `infra/llm/llama-swap.yaml`, `infra/llm/install-task.ps1`, `infra/llm/run.ps1`
- Reference (pattern only): `infra/media-tunnel/install-task.ps1`, `infra/media-tunnel/README.md`

**Interfaces:**
- Produces: an OpenAI-compatible endpoint at `http://127.0.0.1:8080` on Windows serving model ids `fast` (llama3.2 3B Q4_K_M) and `build` (qwen2.5-coder 7B Q4_K_M, swapped later if Task 6 finds better), both loaded at once (llama-swap `groups` with `swap: false` / `exclusive: false`), and `https://ollama.viafluere.com` (same hostname, same Access policy) routed to it. Later tasks rely on: `GET /v1/models` lists `fast` and `build`; `POST /v1/chat/completions` accepts `tools` and `stream: true`.

- [ ] **Step 1: Lay out `C:\moduli-llm\`** — `bin\` (llama.cpp Vulkan build b12387+ unzipped; reuse `C:\Users\Public\llamabench\vulkan` and move it), `llama-swap\` (latest Windows release of mostlygeek/llama-swap), `models\` (copy the two GGUFs from `/usr/share/ollama/.ollama/models/blobs/` — `sha256-dde5…cdff` → `llama3.2-3b-q4_k_m.gguf`, `sha256-60e0…2463` → `qwen2.5-coder-7b-q4_k_m.gguf`; or move `C:\Users\Public\llamabench\qwen7b.gguf`). Delete `C:\Users\Public\llamabench` once moved.

- [ ] **Step 2: Write `infra/llm/llama-swap.yaml`** with models `fast` and `build`, each `cmd: C:\moduli-llm\bin\llama-server.exe --port ${PORT} -m <gguf> -ngl 99 --jinja -c 8192 -t 8 --cache-reuse 256`, `ttl: 0`, and a group holding both with `swap: false` so neither unloads the other. Listen `127.0.0.1:8080`.

- [ ] **Step 3: Write `run.ps1` + `install-task.ps1`** modelled on the media tunnel's: a scheduled task "Moduli LLM" that starts llama-swap at logon and restarts it on failure. Any step needing elevation is printed as a ready command for the user (spec: hand off, don't fail).

- [ ] **Step 4: Verify locally from WSL through Windows interop**

Run: `cmd.exe /c curl -s http://127.0.0.1:8080/v1/models`
Expected: JSON listing `fast` and `build`.

Run a tool-call request against `build` (one tool `get_weather(city)`, user "weather in Paris?") with `curl.exe`.
Expected: `choices[0].message.tool_calls[0].function.name == "get_weather"`.

- [ ] **Step 5: Route the tunnel.** Decide where cloudflared runs (it runs in WSL today as `tunnel run moduli-ollama`; WSL2 NAT cannot reach Windows' 127.0.0.1 — check `wsl --version`/`.wslconfig` for mirrored networking first). Either run cloudflared on Windows with the same tunnel credentials, or point the WSL ingress at the Windows host IP. Keep the hostname and the Access policy.

Run (from the droplet): `curl -s -H "CF-Access-Client-Id: $CF_ACCESS_CLIENT_ID" -H "CF-Access-Client-Secret: $CF_ACCESS_CLIENT_SECRET" https://ollama.viafluere.com/v1/models`
Expected: lists `fast` and `build`. (Ollama's `/api/tags` on the same host stops answering, which is expected: prod stays on the old code until Task 7, so do this step's cut-over only at Task 7 if the hostname must keep serving Ollama meanwhile — otherwise use a second hostname `llm.viafluere.com` now and switch prod in Task 7. **Default: second hostname.**)

- [ ] **Step 6: Write `infra/llm/README.md`** (layout, config, task, tunnel, how to swap a model, the measured speeds from the spec) and commit.

```bash
git add infra/llm && git commit -m "infra(llm): llama-swap + llama-server on the PC, Vulkan, at logon"
```

---

### Task 2: `services/llmClient.js` — the one OpenAI-compatible client

**Files:**
- Create: `server/services/llmClient.js`, `server/__tests__/llmClient.test.js`
- Rename: `server/utils/ollamaHeaders.js` → `server/utils/llmHeaders.js` (`llmHeaders(base)`; `OLLAMA_AUTH_HEADER` → `LLM_AUTH_HEADER`)

**Interfaces:**
- Produces:
  - `buildChatBody({ model, messages, tools = [], stream = true, maxTokens }) -> object` — OpenAI body: `{ model, messages, stream, max_tokens, tools: [{type:"function", function:{name, description, parameters: t.input_schema}}] }` (omit `tools` when empty), plus `cache_prompt: true`.
  - `async streamChat({ url, body, signal, onToken, fetchFn }) -> { content, toolCalls, timings }` — POSTs to `${url}/v1/chat/completions`, parses SSE (`data: {...}` lines, `data: [DONE]`), forwards `delta.content` to `onToken`, reassembles `delta.tool_calls` by `index` (id/name from the first fragment, `arguments` concatenated), returns `toolCalls` as `[{ id, function: { name, arguments } }]` with `arguments` still a string, and the last chunk's `timings` if present. Non-2xx throws `Error` with `.status` and a message built by `summarizeHttpError` (import it from assistantAgent or move it here; it must live in exactly one file — move it here and re-export from assistantAgent for its existing test).
  - `async chatOnce({ url, body, signal, fetchFn }) -> { content }` — non-streaming (`stream:false`) for the import clean-up.
  - `async reachable({ url, timeoutMs = 800, fetchFn }) -> boolean` — `GET ${url}/v1/models`.
  - All requests send `llmHeaders({"Content-Type":"application/json"})`.

- [ ] **Step 1: Write the failing tests** in `llmClient.test.js`:
  - `buildChatBody maps input_schema to parameters and sets cache_prompt` — `body.tools[0].function.parameters` equals the tool's `input_schema`; `body.cache_prompt === true`; `tools` absent when `[]`.
  - `streamChat reassembles a tool call split over four chunks` — feed a fake `fetchFn` whose body streams: `{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"create_board","arguments":""}}]}}]}`, then three chunks with `arguments` `"{\"name\":"`, `"\"Quick Links\","`, `"\"folder\":\"Interfaces\"}"`, then `[DONE]`; split the bytes mid-line across reads. Expect `toolCalls` length 1, `JSON.parse(toolCalls[0].function.arguments)` equals `{name:"Quick Links", folder:"Interfaces"}`.
  - `streamChat forwards content deltas in order` — `onToken` called with `"Hel"`, `"lo"`; `content === "Hello"`.
  - `streamChat throws with status on 524` — html body `<title>timeout</title>`; error `.status === 524`, message contains `timeout`.
  - `reachable is false when fetch rejects or times out` and `true on 200`.
  - `llmHeaders adds CF Access headers when both env vars are set`.

- [ ] **Step 2: Run to see them fail**

Run: `cd server && npx vitest run __tests__/llmClient.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `llmClient.js`** and the `llmHeaders.js` rename (update the two importers in Task 3/4, not here — leave `ollamaHeaders.js` re-exporting nothing; delete it in Task 4 once unused).

- [ ] **Step 4: Run to see them pass**

Run: `cd server && npx vitest run __tests__/llmClient.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/services/llmClient.js server/utils/llmHeaders.js server/__tests__/llmClient.test.js
git commit -m "feat(llm): one OpenAI-compatible client with streamed tool-call reassembly"
```

---

### Task 3: Jonah on the new client — model routing and a cache-friendly prompt

**Files:**
- Modify: `server/services/assistantAgent.js` (env block lines ~26-66, `selectToolsForBackend`, `ollamaReachable`, `buildOllamaRequestBody`, `streamOllamaChat`, `ollamaLoop`, `pickBackend`, `composeChat`, `warmAssistant`, `assistantChat`)
- Modify: `server/__tests__/assistantAgent.test.js`, `server/__tests__/assistantOfflinePrompt.test.js`
- Modify: `client/src/ui/AssistantDrawer.jsx` comments at lines ~54 and ~112 (names only)

**Interfaces:**
- Consumes: Task 2's `buildChatBody`, `streamChat`, `reachable`, `llmHeaders`.
- Produces:
  - `pickModel(text: string) -> "build" | "fast"` (exported, pure): `"build"` when the last user message matches a build-verb rule (`/\b(add|make|create|build|put|schedule|set|move|copy|import|rename|delete|remove|new)\b/i`), else `"fast"`. Model ids resolve through `LLM_BUILD_MODEL` / `LLM_FAST_MODEL` (defaults `"build"` / `"fast"`).
  - `composeChat` returns `{ tools, systemPrompt, contextNote }`: `systemPrompt` is ONLY the fixed persona (`OFFLINE_SYSTEM_PROMPT` for local); destinations, date and location move into `contextNote`, sent as a `system`-role message placed AFTER the conversation history and before the newest user message (so the rendered prefix system+tools+old turns is stable).
  - `localLoop({ messages, tools, systemPrompt, contextNote, model, onProgress })` replaces `ollamaLoop`, same return shape with `mode: "local"`, `model`.
  - `selectToolsForBackend(tools, backend)` narrows for `"local"`; `OFFLINE_CORE_TOOLS` unchanged; env `LLM_TOOL_ALLOWLIST`.
  - Tool results go back as `{ role: "tool", tool_call_id, content }` (OpenAI shape); assistant turns carry `tool_calls` with `id`s (generate `call_<n>` when a recovered-from-text call has none).

- [ ] **Step 1: Write the failing tests** (replace the `buildOllamaRequestBody` describe block; keep `parseContentToolCall`, `toolResultForModel`, `ambiguityQuestion`, `summarizeHttpError` tests):
  - `pickModel sends builds to the build model` — `"make a board of my quick links"` → `"build"`; `"add CPS classes Mon-Thu"` → `"build"`; `"what's on my schedule today?"` → `"fast"`.
  - `the system prompt is identical across pages and days` — call the exported `composeSystemParts({ destinations: A, context: {id:"x"} , today: d1 })` and `({ destinations: B, context: {id:"y"}, today: d2 })`; `systemPrompt` strings are `===`; `contextNote`s differ and contain the location id.
  - `localLoop recovers a tool call written as text` — mock `streamChat` (inject via a `deps` param on `localLoop`) to return `{ content: '{"name":"create_items","arguments":{"container":"Tasks › Appointments","items":[]}}', toolCalls: [] }` then `{content:"Done.", toolCalls:[]}`; a fake `create_items` tool records its input; expect it ran once with `container === "Tasks › Appointments"`.
  - `localLoop sends tool results with tool_call_id` — second request's messages contain `{role:"tool", tool_call_id:"c1"}`.
  - `an unreachable runner answers fast` — `reachable` mocked false, `ASSISTANT_BACKEND` unset, no Anthropic key → `assistantChat` resolves in < 2000ms with `mode` of the deterministic backend (existing behaviour) — and the gateway-timeout test (lines ~314-353) is rewritten for `mode: "local"` / `"local-error"`.
  - `assistantOfflinePrompt` tests use backend `"local"`.

- [ ] **Step 2: Run to see them fail**

Run: `cd server && npx vitest run __tests__/assistantAgent.test.js __tests__/assistantOfflinePrompt.test.js`
Expected: FAIL (`pickModel` / `composeSystemParts` / `localLoop` not exported).

- [ ] **Step 3: Implement.** Delete `buildOllamaRequestBody`, `streamOllamaChat`, `ollamaReachable`, every `OLLAMA_*` constant and the `num_ctx` / `keep_alive` options (context size is a llama-server flag now). `warmAssistant` sends `buildChatBody({ model: build, messages:[system, user "hi"], tools, maxTokens: 1, stream:false })` to warm the build model's prefix; it returns `reason: "not_local"` when the backend is not local. Error copy in `assistantChat`: `Jonah's local model (${model}) didn't finish: …` (drop the word Ollama).

- [ ] **Step 4: Run to see them pass, then the whole server suite**

Run: `cd server && npx vitest run __tests__/assistantAgent.test.js __tests__/assistantOfflinePrompt.test.js && npx vitest run`
Expected: PASS; no other suite references the removed exports (grep `buildOllamaRequestBody|ollamaLoop|OLLAMA_` in `server/` returns only `importEnrich.js`, done in Task 4).

- [ ] **Step 5: Commit**

```bash
git add server/services/assistantAgent.js server/__tests__/assistantAgent.test.js server/__tests__/assistantOfflinePrompt.test.js client/src/ui/AssistantDrawer.jsx
git commit -m "feat(assistant): Jonah on the OpenAI-compatible client; fast/build model routing; stable prompt prefix"
```

---

### Task 4: The import clean-up on the new client (still off)

**Files:**
- Modify: `server/services/importEnrich.js` (`cleanupWithOllama` → `cleanupWithLlm`, lines ~97-125), its callers in the same file and `services/importJobs.js`; comments in `importJobs.js`, `importCorrections.js`, `importPreview.js`, `importPipeline.js`, `assistantTools.js`, `client/src/ui/ShareImportPreview.jsx`
- Modify: `server/__tests__/importEnrich.test.js`, `server/eval/imports/run.mjs` (`--with-ollama` → `--with-llm`)
- Delete: `server/utils/ollamaHeaders.js`
- Modify: `deploy/make-env.sh` lines ~78-79 (`OLLAMA_MODEL` → `LLM_URL` / `LLM_BUILD_MODEL` / `LLM_FAST_MODEL` placeholders)

**Interfaces:**
- Consumes: Task 2's `chatOnce`.
- Produces: `cleanupWithLlm({ markdown, kind, examples }, deps) -> string | null` (same contract as before; model `IMPORT_LLM_MODEL || LLM_FAST_MODEL || "fast"`; `temperature: 0`). `enrichImport`'s failure reason becomes `"llm"`.

- [ ] **Step 1: Update the test helper and cases** — `ollamaSays` → `llmSays(text)` returning `{ ok:true, json: async () => ({ choices: [{ message: { content: text } }] }) }`; the "down or slow" case expects `{ applied:false, reason:"llm" }`; add `posts to /v1/chat/completions` (capture the URL).

- [ ] **Step 2: Run to see them fail**

Run: `cd server && npx vitest run __tests__/importEnrich.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** the rename and the `chatOnce` call; delete `ollamaHeaders.js`.

- [ ] **Step 4: Verify nothing Ollama-native remains**

Run: `cd /home/joshpoms/moduli && grep -rn -i "ollama" server client/src deploy --include=*.js --include=*.jsx --include=*.mjs --include=*.sh | grep -v node_modules`
Expected: no matches except migration files and historical CLAUDE.md text.

Run: `cd server && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A server/services server/utils server/__tests__/importEnrich.test.js server/eval/imports/run.mjs deploy/make-env.sh client/src/ui/ShareImportPreview.jsx
git commit -m "feat(imports): clean-up on the OpenAI-compatible client (still off); Ollama names removed"
```

---

### Task 5: Short build-tool inputs

**Files:**
- Modify: `server/services/assistantBuildTools.js` (`create_board` schema + run, lines ~380-445; `create_items` description, ~448; `asList` ~196), `server/services/assistantAgent.js` `OFFLINE_SYSTEM_PROMPT` build line (~75)
- Modify: `server/__tests__/assistantBuildTools.test.js`

**Interfaces:**
- Produces:
  - `parseRow(s: string) -> { label, url? , fields? }` (exported, pure): `"Reddit | https://reddit.com"` → `{label:"Reddit", url:"https://reddit.com"}`; split on the LAST `" | "` only when the right side starts with `http`; otherwise the whole string is the label. An object row passes through unchanged.
  - `parseSelectField(s: string) -> { name, options }` (exported, pure): `"Quick Link Type: social, news, tools"` → `{name:"Quick Link Type", options:["social","news","tools"]}`.
  - `create_board` takes `rows` items of type `string | object`, `selectFields` items `string | object`, and a new `field` (string, a select field name): a row `"Label | url | value"` sets that field to `value`. `parseRow(s, { valueField })` returns `fields: {[valueField]: value}` when a third part exists.
  - Schemas list the string form first; descriptions show one example line each.

- [ ] **Step 1: Write the failing tests**
  - `parseRow splits label and url` (case above).
  - `parseRow keeps a plain item` — `"Buy milk"` → `{label:"Buy milk"}`.
  - `parseRow splits on the last bar` — `"A | B | https://x.io"` → `{label:"A | B", url:"https://x.io"}`.
  - `parseRow reads a third part as the field value` — `parseRow("Reddit | https://reddit.com | social", {valueField:"Quick Link Type"})` → `fields: {"Quick Link Type":"social"}`.
  - `parseSelectField reads name and options` (case above).
  - `create_board accepts string rows` — drive the existing tool test harness with `rows: ["Reddit | https://reddit.com | social", "Notes"]`, `selectFields: ["Quick Link Type: social, news"]`, `field: "Quick Link Type"`, `filterField: "Quick Link Type"`; expect one `/bookmarks` POST with label Reddit, one plain instance Notes, the field value written on Reddit.

- [ ] **Step 2: Run to see them fail**

Run: `cd server && npx vitest run __tests__/assistantBuildTools.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement** `parseRow` / `parseSelectField`, normalize `rows` / `selectFields` through them at the top of `run`, update schemas, descriptions and the offline prompt's build line (one example: `rows: ["Reddit | https://reddit.com | social"]`).

- [ ] **Step 4: Run to see them pass**

Run: `cd server && npx vitest run __tests__/assistantBuildTools.test.js __tests__/assistantOfflinePrompt.test.js`
Expected: PASS (the offline prompt size test still under its cap; if the cap fails, shorten wording, never raise the cap without saying why).

- [ ] **Step 5: Commit**

```bash
git add server/services/assistantBuildTools.js server/services/assistantAgent.js server/__tests__/assistantBuildTools.test.js
git commit -m "feat(assistant): build tools take short row strings, so the model writes less"
```

---

### Task 6: The eval — baseline on Ollama, then the new runner; pick the build model

**Files:**
- Create: `server/eval/assistant/run.mjs`, `server/eval/assistant/cases.json`, `server/eval/assistant/README.md`, `server/eval/assistant/results/` (gitignored except a summary)

**Interfaces:**
- Consumes: the running server's `/api/v1/assistant/chat` (or `assistantChat` imported directly with `baseUrl` + a scratch API token for test grid 2), Mongo read for checks.
- Produces: `node server/eval/assistant/run.mjs --grid "test grid 2" [--label ollama|llama]` printing a `console.table` per case: `case, model, wallMs, firstTokenMs, toolCalls, cacheN, passed`, and writing `results/<label>-<timestamp>.json`.

- [ ] **Step 1: Write `cases.json`** — `cps` ("Add my CPS classes: Monday to Thursday every week in November 2026, 4pm for 4 hours, in Tasks › Appointments, schedule type Class"; check: ≥ 17 rows labelled "CPS Class" under Appointments dated Mon-Thu Nov 2026), `quicklinks` (the 13-link request from 2026-11-02 — copy its text from `CLAUDE.md` / the 11-02 entry or the jsonl transcripts; check: a board page "Quick Links" with 13 bookmarks, a Quick Link Type select field, each bookmark valued, a filter on the page), and three questions (`"what's on my schedule today?"`, `"how do feeds work?"`, `"how many movies do I have?"`; check: non-empty answer, no write).

- [ ] **Step 2: Write `run.mjs`** — before each build case create missing fixtures on test grid 2 (Tasks › Appointments container, a Schedule Type field with a Class option or confirm the tool adds it, a folder "Interfaces"), record ids, run the request with auto-approve of confirm cards (POST `/assistant/confirm` with the pending input), time it, read Mongo for the check, then delete every row/module/field it created (snapshot ids before, diff after). Read `timings.cache_n` / `prompt_n` from the stream when present (expose them on the loop's `onProgress({phase:"timings"})` — add that one call in `localLoop`, covered by a test there).

- [ ] **Step 3: Baseline** — on a checkout of the commit before Task 3 (or with prod's Ollama via `OLLAMA_URL`), run `--label ollama`. Expected: a table; record it in `README.md`.

- [ ] **Step 4: New runner** — local server with `LLM_URL` = the PC endpoint (Task 1), run `--label llama`. Then swap `build` to two other 7B-8B candidates (qwen2.5 7B instruct, llama 3.1 8B instruct; Q4_K_M) in `llama-swap.yaml` and re-run the two build cases each. Pick the model with the most passes, then the lowest wall time. Record all tables in `README.md`; update `llama-swap.yaml` with the winner.

Expected: both build cases pass on the chosen model; second-turn `cache_n` ≥ 80% of `prompt_n`; questions not slower than the Ollama baseline.

- [ ] **Step 5: Verify the grid is clean**

Run: `cd server && node scripts/checkGrid.js "test grid 2"`
Expected: no new findings versus before the eval.

- [ ] **Step 6: Commit**

```bash
git add server/eval/assistant infra/llm/llama-swap.yaml
git commit -m "eval(assistant): timed build/question cases; Ollama vs llama.cpp tables; build model chosen"
```

---

### Task 7: Cut-over on prod, watched; then Ollama removed (user's go-ahead)

**Files:**
- Modify: prod `/var/www/moduli/server/.env` (by hand over ssh, not in git), `infra/llm/README.md`, `CLAUDE.md` (dated entry), `server/CLAUDE.md`

- [ ] **Step 1: Set prod env** — remove `OLLAMA_*`; add `LLM_URL=https://llm.viafluere.com` (Task 1's hostname), `LLM_BUILD_MODEL=build`, `LLM_FAST_MODEL=fast`; keep CF Access vars. Deploy (`deploy.sh`, moving aside only untracked `_*.sh`), restart pm2.

- [ ] **Step 2: Watch it** — from the droplet `curl` `/v1/models` through the tunnel with the Access headers; then ask the user to send one build and one question in the drawer; read the prod log for the request and the rows in Mongo.

Expected: both answered; the build's rows exist; times in line with Task 6.

- [ ] **Step 3: Record** the numbers in a dated `CLAUDE.md` entry and `server/CLAUDE.md`; commit.

```bash
git add CLAUDE.md server/CLAUDE.md infra/llm/README.md
git commit -m "docs: Jonah on llama.cpp, measured on prod"
```

- [ ] **Step 4: Ask the user before removing Ollama.** On yes: `sudo systemctl disable --now ollama` in WSL (user runs it if sudo needs a password), delete `/usr/share/ollama/.ollama/models`, remove the old `ollama.viafluere.com` ingress + DNS record, and note it in `infra/llm/README.md`.
