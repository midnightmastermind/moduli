# Replacing Ollama with llama.cpp (llama-swap + llama-server) — design

_2026-11-15. Brainstormed with the user 2026-11-14/15. Measurements are from the user's PC._

## Why

Jonah (the in-app assistant) and the import clean-up run on Ollama in WSL on the user's PC, reached by the droplet
through the `moduli-ollama` Cloudflare tunnel (`ollama.viafluere.com`). The user wants it replaced: it is **too
slow**, and with the 3B model it often **does not do the thing**. On 2026-11-02 the 3B got the CPS classes right
but failed the Quick Links board: it sent lists as JSON text, and on a retry it wrote the tool call out as prose.
Someone suggested llama-swap with LiteLLM or llama.cpp.

## What the user decided

- **No paid / cloud models.** Everything runs on the user's own machine.
- **Jonah's job: mostly building things in the grid from a sentence, and also answering questions** about it.
- **"As quick as possible."**
- **Only the built-in Radeon is available** (Ryzen 7 5800H, AMD Radeon iGPU, 29 GB RAM). No dedicated GPU.

## Measured on the user's PC (llama-bench, build b12387, 1024-token prompt, 64-token reply)

| model | backend | read prompt | write reply |
|---|---|---|---|
| llama3.2 3B Q4_K_M | Vulkan (Radeon) | 129 tok/s | 18.5 tok/s |
| qwen2.5-coder 7B Q4_K_M | Vulkan (Radeon) | 58 tok/s | 7.7 tok/s |
| qwen2.5-coder 7B Q4_K_M | CPU, llama.cpp | 38 tok/s | 7.3 tok/s |
| qwen2.5-coder 7B | Ollama in WSL (2026-11-02) | ~28 tok/s | — |

What follows from it:
- Reading the prompt is ~2× faster than today on the Radeon. Jonah's prompt is ~6,000 tokens: ~100s on the 7B
  if read in full every time.
- **Writing is bandwidth-bound and does not improve with any runner** (~7.5 tok/s for a 7B, ~18 for a 3B), because
  the iGPU shares system memory. So the reply must be short: a ~400-token tool call is ~50s on the 7B.
- Vulkan sees the Radeon with ~16.7 GB of shared memory, so a 7B (and probably a 14B Q4, slowly) fits.
- **Loading a model file across `\\wsl.localhost` crashed WSL** (twice, mid-load). Model files must live on a
  Windows disk.

## The design

### Runtime (on the PC)
- **llama.cpp `llama-server`, Windows-native, Vulkan build**, not in WSL. Only native Windows sees the Radeon.
- **llama-swap** in front of it: one OpenAI-compatible endpoint; the request's `model` names which model to load.
- **No LiteLLM.** It earns its place only when mixing in cloud models, and there are none.
- Starts at boot and restarts itself (a Windows scheduled task, the same pattern as the "Moduli media tunnel"
  task in `infra/media-tunnel/`).
- Reached from the droplet through the **existing Cloudflare tunnel + Access headers** (`utils/ollamaHeaders.js`).
  Whether cloudflared moves to Windows or keeps running in WSL and forwards to the Windows host is the builder's
  call (WSL2's default NAT networking does not see Windows' localhost; check before assuming).
- Model files in a folder on C: (55 GB free as of 2026-11-14) or D: (655 GB free), never read from WSL.
- Ollama stays installed and running until the new setup has been watched working on prod, then it is removed
  (the service, the models under `/usr/share/ollama`, and the tunnel's old ingress).

### Moduli server
- **One OpenAI-compatible client** replaces the Ollama-native `/api/chat` calls in `services/assistantAgent.js`
  and `services/importEnrich.js` (`/v1/chat/completions`, tools, streaming; `/v1/models` for the liveness probe).
  Ollama also serves `/v1/chat/completions`, so going back to Ollama during the switch-over means pointing the URL
  back. **There is one code path, not two.** Env names move from `OLLAMA_*` to neutral names (e.g. `LLM_URL`,
  `LLM_MODEL`). The old names are removed, not kept as aliases (house rule: no legacy fallbacks).
- **The fixed part of Jonah's prompt is read once and kept.** llama-server reuses a cached prefix
  (`cache_prompt`), but only if the request starts with the SAME bytes every time: system prompt and tool schemas
  first, nothing per-request (time, grid name, user text) ahead of them. With that, a follow-up request reads only
  the new tokens.
- **Build tools take short inputs**, because writing is the slow part. For example, `create_board` takes rows as
  short strings or a flat list instead of one nested object per row, and the server fills in the rest. The shapes
  are the builder's call. The goal is the fewest output tokens for the CPS-classes and Quick Links requests, and a
  shape a 3B–7B model can write reliably. **One schema for every backend** (my call): the Anthropic backend gets the
  short shapes too, rather than a second schema per backend. Existing tool tests (`assistantBuildTools.test.js`) keep passing or are
  updated with the reason.
- **Two models: a fast one for questions and a stronger one for building** (my call). The server picks per
  request: a cheap rule on the request text (build verbs like add / make / create / put / schedule → the build
  model; otherwise the fast one). The builder may improve the rule; it must not cost a model round trip of its own.
  A tool call returned by the fast model still runs.
  **Both models stay loaded at once** (my call: 2 GB + 4.7 GB fits in the ~16.7 GB the Radeon sees), so switching
  costs no reload and neither loses its cached prompt. Two models are not a requirement: if the eval shows one model
  does both jobs fast enough, use one and skip the routing.
- Keep `parseContentToolCall` (a tool call written as text is still recovered); keep the curated offline tool
  list; keep streaming to the drawer (`assistant_progress` token deltas).
- **The import clean-up (`importEnrich`) switches client only and stays OFF** (`IMPORT_AI_CLEANUP` unset), as
  measured on 2026-11-10. Re-measure with `server/eval/imports/run.mjs --with-ollama` (renamed to match) afterwards.

## Goals
- Jonah builds the two real requests end to end: **the CPS classes** (13+ "CPS Class" rows Mon–Thu in
  Tasks › Appointments, with the Class schedule type) and **the Quick Links board** (a board page with 13 bookmarks,
  a Quick Link Type select field set on each, a filter with its nav showing).
- As fast as this PC allows. A rough target from the measurements: a simple question in a few seconds, a build in
  ~20–60s.
- **What "faster" is measured as (my call):** time to a CORRECT build (the expected rows exist afterwards),
  against today's prod setup (Ollama, llama3.2 3B). A fast build that fails does not count as fast. So the 7B is
  allowed to write more slowly than today's 3B, as long as it gets the build right in less time than the
  3B takes to get it right (or than the user re-asking). Questions must not get slower than today.

## Non-goals
- Cloud models, or a fallback to them. The existing Anthropic backend in `assistantAgent.js` is left as it is
  (my call): it is opt-in by env, and the user did not ask for it to be removed.
- New Jonah features or tools beyond the shorter inputs above.
- Turning the import clean-up on.

## Anti-goals (a failure even if it technically works)
- Slower than Ollama on the same request.
- Jonah answering in prose (or printing a tool call) instead of doing the build.
- Two client code paths (Ollama and OpenAI) kept side by side.
- A model loaded from WSL by a Windows process (it crashed WSL).

## How it is checked
- An eval script (beside `server/eval/imports/`) sends the CPS-classes and Quick Links requests, plus two or
  three questions, to the real server against **test grid 2** (never poms grid), and records per request: wall
  time, time to first token, tool calls made, and whether the expected rows exist afterwards (read from Mongo).
  The probe's rows are deleted after. Anything test grid 2 lacks for these requests (Tasks › Appointments, a
  Schedule Types field with a Class option, a folder for the board) is made as a fixture first and removed after
  (my call).
- Run it once against Ollama now (the baseline), then against the new setup, and report both tables.
- Then on prod: the user asks Jonah one build and one question in the drawer.

## Left to the builder
- Which 7B-class model builds best (qwen2.5-coder 7B is the one installed; qwen2.5 7B instruct, llama 3.1 8B and
  others are candidates). Pick by running the eval, not by reputation. Whether a 14B Q4 is worth its ~2× slower
  writing, also by measurement.
- llama-server flags (context size, threads, batch size, `--jinja` for tool templates, slot count) and the
  llama-swap config.
- Where cloudflared runs and how the tunnel reaches the Windows port.
- The exact short input shapes for the build tools.
- The scheduled-task / service wrapper. **Match the existing "Moduli media tunnel" task** (my call): it comes back
  the way that one does. llama.cpp's .exe files ran fine from WSL without elevation on 2026-11-14; any step that
  needs an elevated PowerShell is handed to the user as a ready script.

## Facts a builder needs
- llama.cpp Windows builds tested: `llama-b12387-bin-win-{vulkan,cpu}-x64.zip` from ggml-org/llama.cpp releases,
  unpacked in `C:\Users\Public\llamabench` with `qwen7b.gguf` (4.7 GB). That folder is test debris: reuse it or
  delete it.
- Ollama's model files are standard GGUF: `/usr/share/ollama/.ollama/models/blobs/sha256-60e0…2463` (qwen2.5-coder
  7B) and `sha256-dde5…cdff` (llama3.2 3B).
- Prod env today: `OLLAMA_URL=https://ollama.viafluere.com`, `OLLAMA_MODEL=llama3.2:3b`, CF Access headers set.
- Cloudflare cuts a response that sends nothing for 100s, so streaming has to start early, tool calls included.
- Ollama touchpoints: `services/assistantAgent.js` (chat loop, liveness, request builder, timeouts),
  `services/importEnrich.js`, `utils/ollamaHeaders.js`, comments in `importJobs` / `importCorrections` /
  `importPreview` / `importPipeline` / `assistantTools`, tests `assistantAgent` / `assistantOfflinePrompt` /
  `importEnrich`.
