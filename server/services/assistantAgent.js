// services/assistantAgent.js
//
// Jonah — the agent loop that drives the Moduli assistant chatbox.
// (Persona: a sophisticated turtle butler with a flowing Gandalf-like
//  beard. Personality lives ONLY here in the system prompt + in the UI
//  avatar — the tool layer stays impersonal.)
//
// Backend selection is OFFLINE-FIRST (see pickBackend):
//   1. Ollama (local, free, private) — preferred. Reachable at
//      OLLAMA_URL with a tool-capable model (OLLAMA_MODEL). This is the
//      "the point is it runs offline" path.
//   2. Anthropic Claude (cloud) — optional fallback when Ollama isn't
//      running and ANTHROPIC_API_KEY is set.
//   3. Deterministic dispatcher — no model at all. Recognizes a few
//      natural-language prefixes ("wiki <topic>", "import:\n<md>"). Lets
//      the chatbox demo end-to-end with zero AI setup (dev / CI).
//
// Override the auto-selection with ASSISTANT_BACKEND=ollama|anthropic|deterministic.
//
// All three modes drive the SAME tool catalog. Tools are thin wrappers
// over the existing /api/v1 REST endpoints — the agent has NO special
// privileges; its permissions are exactly the caller's Bearer token.

import Anthropic from "@anthropic-ai/sdk";
import { moduliToolPack, systemToolPack } from "./assistantTools.js";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
// Ollama: local LLM runtime. qwen2.5-coder is a strong, tool-capable,
// lightweight default; swap via OLLAMA_MODEL (e.g. "llama3.1", "qwen2.5").
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5-coder:7b";
// Ollama allocates only ~4096 tokens of context by default (regardless of the
// model's trained max), which silently truncates our system prompt + ~40 tool
// schemas before any grid data lands — the model then loses the tools/system
// instructions and loops. We request a roomier window explicitly. The model
// (qwen2.5-coder) is trained for 32768; 8192 is a safe headroom default that
// keeps RAM/latency reasonable. Override via OLLAMA_NUM_CTX.
const OLLAMA_NUM_CTX = Number(process.env.OLLAMA_NUM_CTX) || 8192;
// Cap output tokens per generation. Tool calls + one-sentence summaries are
// short; without a cap the model can ramble for hundreds of tokens, and on a
// CPU box every token is expensive. Bounds worst-case latency per turn.
const OLLAMA_NUM_PREDICT = Number(process.env.OLLAMA_NUM_PREDICT) || 768;
// Keep the model resident between turns so we don't pay the multi-second reload
// each message. Ollama accepts a duration string ("30m") or seconds.
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE || "30m";
// Per-generation cap — guards against a genuinely wedged call. Must comfortably
// exceed real generation time on this hardware (a single tool-calling turn over
// the curated prompt benches ~60–100s on CPU), or normal turns get aborted and
// wrongly fall back. Override via OLLAMA_TIMEOUT_MS.
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 180000;
// Whole-request wall-clock budget across all tool iterations. Each generation's
// effective timeout is min(per-gen cap, remaining budget) so the total run never
// exceeds this — keeps the server bound coherent with the client's ceiling.
const OLLAMA_TOTAL_BUDGET_MS = Number(process.env.OLLAMA_TOTAL_BUDGET_MS) || 300000;
const MAX_TOOL_ITERATIONS = 6;

const SYSTEM_PROMPT = `You are Jonah — the assistant for the Moduli workspace. Persona: a sophisticated, unflappable turtle butler with a long Gandalf-like beard. Style: dry, precise, faintly formal; wise and patient, never folksy. Brief by default; expansive only when answering a genuine research question.

You operate by emitting structured tool calls. You have the FULL set of Moduli grid commands (the exact JSON schemas are provided to you separately):
- Research / lookup: wikipedia_search, wikipedia_summary (answer "what is X" without a page), wikipedia_import ("create a doc page of the Wikipedia article for X"), import_markdown.
- Read the grid: get_grid_state, list_modules, list_occurrences, get_occurrence, list_fields, list_operations.
- Create: create_module, create_occurrence, create_field.
- Edit: update_module, update_occurrence, set_occurrence_field (log/set a value), update_field, update_operation.
- Delete (destructive): delete_module, delete_occurrence, delete_field, delete_operation.
- Operations: run_operation, create_operation, update_operation.
- Grid + filters: update_grid (name/dimensions/meta + namedFilters), set_active_filter (switch the active filter / change the active date or period — what's visible).
(If filesystem/command tools appear in your list, they are sandboxed + require confirmation — present only when the operator enables them.)

How Moduli is shaped (so you pick the right command): a MODULE is a template (role panel/container/instance/page; kind list/doc/board/canvas/table); an OCCURRENCE is a placement of a module on the grid (carries fields, parentId, children); a FIELD defines a piece of data an instance collects; an OPERATION is an automation pipeline. To "add something to the grid" you usually create_module then create_occurrence (or create_occurrence of an existing moduleId). To "log a value" use set_occurrence_field.

Discipline:
- ALWAYS call a tool when an action is required; never pretend to act.
- NARRATE as you work: before each tool call, write ONE short sentence saying what you're about to do (e.g. "Creating the task in the 6:30pm slot…"). This is the user's only progress signal while tools run.
- NEVER invent or use placeholder ids like "<Timeslot-container-id>". Use a REAL id — from KNOWN PLACES in this prompt, or from a list_* / get_grid_state result. If you don't have the id, fetch it first.
- For a general-information question, prefer wikipedia_summary; only wikipedia_import when asked for a page.
- "Make a page on X AND the surrounding/linked articles": call wikipedia_links(title:X, max:N) to get the linked titles, THEN call wikipedia_import once per title you'll import (the main one + each chosen link). Each comes back as its own Approve card and becomes its own doc page. If the user didn't say HOW MANY links (or how deep), ask once before fanning out. AFTER the user has approved the batch, call relink_imports with all the rootOccurrenceIds (one per imported article) so links between them navigate in-app.
- For anything destructive (delete_*, update_operation, apply_template, update_grid), briefly state what will change, then GO AHEAD and call the tool — the app shows the user an Approve/Decline card before it actually runs, so you don't need to ask permission in text first.
- After a tool runs, confirm what you did in ONE sentence. Do NOT ask a follow-up unless you genuinely need missing information to finish the task. (Never ask "what is the purpose" — just do it.)
- If uncertain, ask one clarifying question — one, not three.

Creating & placing things:
- To create a NEW item (task, note, anything): call create_occurrence with a \`label\` and your best-guess \`parentId\` (the container/page it belongs in, ideally a real id from KNOWN PLACES). You do NOT need to create a template first, and you do NOT need the id to be perfect — the app pops a card for the USER to confirm or correct the location before anything is placed. So make your best guess and let them confirm.
- \`fields\` is a JSON OBJECT keyed by real FIELD id, each value \`{ "value": <v> }\`. Never pass fields as a string or invent field-id keys; discover real field ids via get_grid_state / list_fields first. If you're unsure of the fields, omit them — placement is what matters.
- PAGES have a KIND: doc (write-ups / articles / notes), board (kanban columns of containers), canvas (free-form / drawing / mind-map), table (spreadsheet grid). When asked to "make a page", INFER the kind from the wording ("doc page" → doc, "board"/"kanban" → board, "canvas"/"mind map" → canvas, "table"/"spreadsheet" → table). If the user says just "a page" with NO kind, ASK which kind first — do not default silently. Create one via create_module(role:"page", kind:<kind>) then create_occurrence of that moduleId. (A Wikipedia article is always a doc page → use wikipedia_import.)`;

// Tool catalog for the MODULI CHATBOX PORT. The assistant core runs
// whatever tool list a port hands it; this port composes the Moduli grid
// pack (research/lookup + grid commands, scoped to the caller's token +
// grid) with the general system pack (filesystem/command — only present
// when ASSISTANT_EXEC=1). Pack definitions live in assistantTools.js so the
// core stays domain-agnostic and the system can be lifted out later.
function buildTools({ baseUrl, apiToken, userId, gridId }) {
  return [
    ...moduliToolPack({ baseUrl, apiToken, gridId }),
    ...systemToolPack(),
  ];
}

// A small local model (qwen2.5-coder:7b) gets slow and unreliable when handed
// the full ~40-tool catalog: every schema is re-sent each iteration, and the
// breadth invites wrong/looping calls. For the Ollama backend we hand it a
// curated core that covers research/import + the common read/create verbs, and
// leave the long tail (manifests, views, grid settings, templates, destructive
// update/delete, operation authoring) to the cloud model. Override the set via
// OLLAMA_TOOL_ALLOWLIST (comma-separated tool names); empty/unset → the default.
const OFFLINE_CORE_TOOLS = new Set([
  "wikipedia_search", "wikipedia_summary", "wikipedia_import", "import_markdown",
  "get_grid_state",
  "list_folders", "create_folder",
  "list_modules", "create_module",
  "list_occurrences", "get_occurrence", "create_occurrence", "set_occurrence_field",
  "list_fields", "create_field",
  "list_operations", "run_operation",
]);

function offlineToolAllowlist() {
  const raw = (process.env.OLLAMA_TOOL_ALLOWLIST || "").trim();
  if (!raw) return OFFLINE_CORE_TOOLS;
  return new Set(raw.split(",").map(s => s.trim()).filter(Boolean));
}

// Pure: narrow the catalog for a given backend. Ollama gets the curated core;
// everything else gets the full set. Never returns empty — if the allowlist
// matches nothing (misconfig), fall back to the full catalog so the assistant
// stays functional.
export function selectToolsForBackend(tools, backend, allowlist = offlineToolAllowlist()) {
  if (backend !== "ollama") return tools;
  const filtered = tools.filter(t => allowlist.has(t.name));
  return filtered.length ? filtered : tools;
}

// =========================================================================
// Mode 1 — real LLM via Anthropic SDK
// =========================================================================
async function llmLoop({ messages, tools, systemPrompt = SYSTEM_PROMPT }) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  // Convert chat history to Anthropic format. Assume `messages` is an
  // array of { role: "user" | "assistant", content: string }.
  const apiMessages = messages.map(m => ({ role: m.role, content: m.content }));

  const transcript = [];
  let toolIterations = 0;

  while (toolIterations < MAX_TOOL_ITERATIONS) {
    const resp = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
      messages: apiMessages,
    });

    // Capture assistant turn (mixed content: text + tool_use blocks).
    const assistantBlocks = resp.content || [];
    apiMessages.push({ role: "assistant", content: assistantBlocks });

    // Are there tool_use blocks?
    const toolUses = assistantBlocks.filter(b => b.type === "tool_use");
    const textBlocks = assistantBlocks.filter(b => b.type === "text");

    transcript.push({
      role: "assistant",
      content: textBlocks.map(b => b.text).join("\n").trim(),
      toolCalls: toolUses.map(t => ({ name: t.name, input: t.input })),
    });

    if (!toolUses.length) break; // model stopped — done

    // Run each tool, feed results back. Tools marked requires_confirm are NOT
    // executed here — they're collected as pending confirmations and the loop
    // halts so the user can Approve/Decline in the UI (then /assistant/confirm
    // runs the single approved tool). Safe tools in the same batch still run.
    const toolResults = [];
    const pending = [];
    for (const tu of toolUses) {
      const tool = tools.find(t => t.name === tu.name);
      if (tool && tool.requires_confirm) {
        pending.push({ name: tu.name, input: tu.input || {}, description: tool.description });
        continue;
      }
      let resultPayload;
      if (!tool) {
        resultPayload = { error: `unknown tool ${tu.name}` };
      } else {
        try {
          resultPayload = await tool.run(tu.input || {});
        } catch (e) {
          resultPayload = { error: String(e?.message || e) };
        }
      }
      toolResults.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: JSON.stringify(resultPayload),
      });
      transcript.push({
        role: "tool",
        name: tu.name,
        input: tu.input,
        output: resultPayload,
      });
    }
    if (pending.length) {
      return { ok: true, mode: "llm", model: ANTHROPIC_MODEL, transcript, pendingConfirmations: pending };
    }
    apiMessages.push({ role: "user", content: toolResults });
    toolIterations++;
    if (resp.stop_reason !== "tool_use") break;
  }

  return {
    ok: true,
    mode: "llm",
    model: ANTHROPIC_MODEL,
    transcript,
  };
}

// =========================================================================
// Mode 2 — deterministic dispatcher (no LLM needed)
// =========================================================================
//
// Recognizes a handful of patterns and dispatches directly to a tool.
// Lets the chatbox work end-to-end without an LLM provider — good for
// dev, CI, and "I don't have an API key" demos.
//
// Patterns:
//   "wiki <query>"           → wikipedia_search
//   "import wiki <query>"    → wikipedia_import (full doc → page)
//   "page on <query>"        → wikipedia_import
//   "research <query>"       → wikipedia_import
//   "look up <query>"        → wikipedia_import
//   "import:\n<markdown>"    → import_markdown
//   "run op <id>"            → run_operation
//   "list ops"               → list_operations
//   anything else            → echo + hint about ANTHROPIC_API_KEY

async function deterministicDispatch({ messages, tools, contextId = null }) {
  const lastUser = [...messages].reverse().find(m => m.role === "user")?.content || "";
  const text = String(lastUser).trim();
  const lower = text.toLowerCase();

  const runTool = async (name, input) => {
    const tool = tools.find(t => t.name === name);
    if (!tool) return { error: `unknown tool ${name}` };
    try { return await tool.run(input); }
    catch (e) { return { error: String(e?.message || e) }; }
  };

  const reply = (assistantText, tool = null) => ({
    ok: true,
    mode: "deterministic",
    transcript: [
      ...(tool ? [{ role: "tool", name: tool.name, input: tool.input, output: tool.output }] : []),
      { role: "assistant", content: assistantText, toolCalls: tool ? [{ name: tool.name, input: tool.input }] : [] },
    ],
  });

  // import: <markdown> — paste-to-page
  if (/^import\s*:/i.test(text)) {
    const md = text.replace(/^import\s*:\s*/i, "");
    const output = await runTool("import_markdown", { markdown: md, parentId: contextId || undefined });
    return reply(`Imported. ${output?.stats ? JSON.stringify(output.stats) : "(see tool output)"}`, { name: "import_markdown", input: { markdown: md }, output });
  }

  // Order matters: most-specific phrasings first. "create a doc page of X"
  // and "page on X" → import; "what is X / tell me about X" → summary
  // (general info, no page); bare "wiki X" → search.
  const wikiPrefixes = [
    { re: /^import\s+wiki(?:pedia)?\s+(.+)$/i, mode: "import" },
    { re: /^(?:create|make)\s+(?:me\s+)?(?:a\s+)?(?:doc(?:ument)?\s+)?page\s+(?:on|of|for|about)\s+(?:the\s+wikipedia\s+article\s+(?:for|of|on)\s+)?(.+)$/i, mode: "import" },
    { re: /^(?:research|look\s*up|page\s+on)\s+(.+)$/i, mode: "import" },
    { re: /^(?:what\s+is|what\s+are|who\s+is|who\s+was|tell\s+me\s+about|summar(?:y|ise|ize)\s+(?:of\s+)?|info\s+on)\s+(.+?)\??$/i, mode: "summary" },
    { re: /^wiki(?:pedia)?\s+(.+)$/i, mode: "search" },
  ];
  for (const p of wikiPrefixes) {
    const m = p.re.exec(text);
    if (m) {
      const query = m[1].trim();
      if (p.mode === "import") {
        const output = await runTool("wikipedia_import", { query, parentId: contextId || undefined });
        const stats = output?.stats;
        const src = output?.source;
        const msg = output?.ok
          ? `Imported "${src?.title || query}" from Wikipedia — ${stats?.containers} containers, ${stats?.instances} instances, ${stats?.textblocks} textblocks. ${src?.url || ""}`
          : `Import failed: ${output?.message || JSON.stringify(output)}`;
        return reply(msg, { name: "wikipedia_import", input: { query }, output });
      } else if (p.mode === "summary") {
        const output = await runTool("wikipedia_summary", { query });
        const extract = output?.extract || output?.summary || output?.description;
        const msg = extract
          ? `${output?.title || query}: ${extract}${output?.url ? `\n${output.url}` : ""}`
          : `No summary found for "${query}". Try \`wiki ${query}\` to search.`;
        return reply(msg, { name: "wikipedia_summary", input: { query }, output });
      } else {
        const output = await runTool("wikipedia_search", { query });
        const hits = output?.hits || [];
        const msg = hits.length
          ? `Found ${hits.length} result(s):\n` + hits.map((h, i) => `  ${i + 1}. ${h.title} — ${h.snippet?.slice(0, 80) || ""}`).join("\n")
          : "No matches.";
        return reply(msg, { name: "wikipedia_search", input: { query }, output });
      }
    }
  }

  if (/^list\s+ops/i.test(lower)) {
    const output = await runTool("list_operations", { runnable: true, limit: 10 });
    const ops = output?.operations || [];
    return reply(`${ops.length} runnable op(s):\n` + ops.map(o => `  - ${o.name}`).join("\n"), { name: "list_operations", input: { runnable: true }, output });
  }

  // Unrecognized
  return reply(
    "No LLM is running, so I only respond to a few set patterns:\n" +
    "  • `wiki <topic>`              — search Wikipedia\n" +
    "  • `what is <topic>`           — general info (article summary)\n" +
    "  • `tell me about <topic>`     — same\n" +
    "  • `create a doc page of <X>`  — research + create a Moduli page\n" +
    "  • `look up <topic>` / `page on <topic>` — same as create a page\n" +
    "  • `import:\\n<markdown>`       — turn pasted markdown into a page\n" +
    "  • `list ops`                  — show runnable operations\n" +
    "\nFor full natural language, run Ollama locally (offline) or set ANTHROPIC_API_KEY."
  );
}

// =========================================================================
// Mode 0 — local LLM via Ollama (offline-first, preferred)
// =========================================================================
//
// Ollama exposes an OpenAI-style chat API at /api/chat with native tool
// calling for tool-capable models (qwen2.5-coder, llama3.1, etc.). The
// loop mirrors llmLoop: send messages + tools, the model may answer with
// `message.tool_calls`, we run them and feed `{role:"tool"}` results
// back, repeat until it stops calling tools or we hit the cap.

// Ollama returns tool-call arguments as a parsed object on most builds,
// but older ones hand back a JSON string. Accept both.
function parseToolArgs(a) {
  if (a == null) return {};
  if (typeof a === "object") return a;
  try { return JSON.parse(a); } catch { return {}; }
}

// Some tool-capable models (notably qwen2.5-coder) frequently DON'T use Ollama's
// native `tool_calls` channel — they emit the call as a JSON blob in
// `message.content` instead (e.g. `{"name":"wikipedia_import","arguments":{…}}`).
// Without recovery the loop sees an empty `tool_calls`, treats the blob as a
// final answer, runs nothing, and the user just sees raw JSON — the exact
// "it printed the tool call but didn't do it" symptom. This parser pulls a
// tool call back out of free-text content. Pure + tested. Returns
// { name, arguments } or null. `toolNames` (when given) guards against matching
// random JSON in prose — only known tool names are recovered.
export function parseContentToolCall(content, toolNames = null) {
  if (!content || typeof content !== "string") return null;
  const known = toolNames instanceof Set ? toolNames : (Array.isArray(toolNames) ? new Set(toolNames) : null);

  const candidates = [];
  // 1) fenced ```json … ``` (or bare ```) blocks
  for (const m of content.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(m[1]);
  // 2) every balanced {...} object in the text (greedy-safe: scan brace depth)
  let depth = 0, start = -1;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") { depth--; if (depth === 0 && start >= 0) { candidates.push(content.slice(start, i + 1)); start = -1; } }
  }
  // 3) the whole trimmed string (covers a bare top-level array)
  candidates.push(content.trim());

  const normalize = (parsed) => {
    if (!parsed || typeof parsed !== "object") return null;
    // OpenAI-ish envelopes
    if (Array.isArray(parsed)) return normalize(parsed[0]);
    if (Array.isArray(parsed.tool_calls)) {
      const fn = parsed.tool_calls[0]?.function;
      if (fn?.name) return { name: fn.name, arguments: parseToolArgs(fn.arguments) };
    }
    if (parsed.function?.name) return { name: parsed.function.name, arguments: parseToolArgs(parsed.function.arguments) };
    if (typeof parsed.name === "string") {
      return { name: parsed.name, arguments: parseToolArgs(parsed.arguments ?? parsed.parameters ?? parsed.args ?? {}) };
    }
    return null;
  };

  for (const c of candidates) {
    let parsed;
    try { parsed = JSON.parse(c); } catch { continue; }
    const call = normalize(parsed);
    if (call && (!known || known.has(call.name))) return call;
  }
  return null;
}

// Quick liveness probe so we can fall back gracefully when `ollama serve`
// isn't running. Short timeout — we don't want to stall the chat.
async function ollamaReachable() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 800);
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

// Pure builder for the Ollama /api/chat request body — kept separate so the
// num_ctx / tool-shape contract is unit-testable without a live server.
export function buildOllamaRequestBody({
  model, messages, tools, stream = false,
  numCtx = OLLAMA_NUM_CTX, numPredict = OLLAMA_NUM_PREDICT, keepAlive = OLLAMA_KEEP_ALIVE,
}) {
  return {
    model,
    stream,
    keep_alive: keepAlive,
    messages,
    tools: tools.map(t => ({
      type: "function",
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    })),
    options: { num_ctx: numCtx, num_predict: numPredict },
  };
}

// Stream a /api/chat completion, forwarding each content delta to `onToken` as
// it arrives (so the UI shows the model "talking" live instead of a silent
// multi-minute wait). Parses Ollama's NDJSON stream, accumulates the full
// content + any tool_calls, and returns them once `done`. Tool-calling models
// emit tool_calls in the stream (usually the final frame); we collect them all.
async function streamOllamaChat({ url, body, signal, onToken }) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", content = "", toolCalls = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { continue; }
      const m = obj.message || {};
      if (m.content) { content += m.content; onToken?.(m.content); }
      if (Array.isArray(m.tool_calls) && m.tool_calls.length) toolCalls = toolCalls.concat(m.tool_calls);
    }
  }
  return { content, toolCalls };
}

async function ollamaLoop({ messages, tools, systemPrompt = SYSTEM_PROMPT, onProgress = () => {} }) {
  // System prompt rides as the first message (Ollama /api/chat has no
  // separate `system` field).
  const apiMessages = [
    { role: "system", content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];

  const transcript = [];
  let toolIterations = 0;
  const deadline = Date.now() + OLLAMA_TOTAL_BUDGET_MS;

  while (toolIterations < MAX_TOOL_ITERATIONS) {
    // Stop launching new generations once the whole-request budget is spent;
    // return whatever we have rather than blowing past the client's ceiling.
    const remaining = deadline - Date.now();
    if (remaining < 5000) {
      transcript.push({ role: "assistant", content: "(stopped — Jonah ran out of time on this request; the local model is slow on this machine. Try a simpler step.)" });
      break;
    }
    onProgress({ phase: "thinking", iteration: toolIterations + 1 });
    // Bound each generation: abort if Ollama doesn't respond within the cap so
    // a wedged call surfaces as an error (→ graceful fallback) instead of an
    // infinite "… thinking". Never run past the total budget.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(OLLAMA_TIMEOUT_MS, remaining));
    let streamed;
    try {
      // Stream so the user sees the model narrate live (each delta → onProgress
      // token) instead of a silent 60-100s wait.
      streamed = await streamOllamaChat({
        url: `${OLLAMA_URL}/api/chat`,
        body: buildOllamaRequestBody({ model: OLLAMA_MODEL, messages: apiMessages, tools, stream: true }),
        signal: ctrl.signal,
        onToken: (delta) => onProgress({ phase: "token", delta }),
      });
    } catch (e) {
      if (e?.name === "AbortError") throw new Error(`Ollama timed out (>${Math.round(Math.min(OLLAMA_TIMEOUT_MS, remaining) / 1000)}s)`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const msg = { content: streamed.content, tool_calls: streamed.toolCalls };
    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];

    // Recover a tool call the model wrote into content instead of the native
    // tool_calls channel (see parseContentToolCall). When recovered, suppress
    // the raw JSON blob from the visible transcript — it's a tool call, not a
    // message.
    let visibleContent = String(msg.content || "").trim();
    if (!toolCalls.length) {
      const recovered = parseContentToolCall(msg.content, new Set(tools.map(t => t.name)));
      if (recovered) {
        toolCalls.push({ function: { name: recovered.name, arguments: recovered.arguments } });
        visibleContent = "";
      }
    }

    apiMessages.push({ role: "assistant", content: msg.content || "", ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    transcript.push({
      role: "assistant",
      content: visibleContent,
      toolCalls: toolCalls.map(tc => ({ name: tc.function?.name, input: parseToolArgs(tc.function?.arguments) })),
    });

    if (!toolCalls.length) break; // model produced a final answer

    // requires_confirm tools are held for user Approve/Decline (see llmLoop).
    const pending = [];
    for (const tc of toolCalls) {
      const name = tc.function?.name;
      const input = parseToolArgs(tc.function?.arguments);
      const tool = tools.find(t => t.name === name);
      if (tool && tool.requires_confirm) {
        pending.push({ name, input: input || {}, description: tool.description });
        continue;
      }
      let result;
      if (!tool) result = { error: `unknown tool ${name}` };
      else {
        onProgress({ phase: "tool", tool: name });
        try { result = await tool.run(input || {}); }
        catch (e) { result = { error: String(e?.message || e) }; }
        onProgress({ phase: "tool_done", tool: name });
      }
      apiMessages.push({ role: "tool", content: JSON.stringify(result) });
      transcript.push({ role: "tool", name, input, output: result });
    }
    if (pending.length) {
      return { ok: true, mode: "ollama", model: OLLAMA_MODEL, transcript, pendingConfirmations: pending };
    }
    toolIterations++;
  }

  return { ok: true, mode: "ollama", model: OLLAMA_MODEL, transcript };
}

// =========================================================================
// Entry point — offline-first backend selection
// =========================================================================
async function pickBackend() {
  const forced = (process.env.ASSISTANT_BACKEND || "").toLowerCase();
  if (forced === "ollama" || forced === "anthropic" || forced === "deterministic") return forced;
  // Auto: prefer local Ollama (offline, private, free), then cloud
  // Anthropic if a key is set, else the no-model dispatcher.
  if (await ollamaReachable()) return "ollama";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "deterministic";
}

// Compose the per-request system prompt: base persona + an optional
// "current location" line so the model can resolve "here" / "this folder"
// to a real id without the user spelling out the id.
export function buildSystemPrompt(context) {
  if (!context || !context.id) return SYSTEM_PROMPT;
  const label = context.label || context.id;
  const isFolder = context.type === "folder";
  return SYSTEM_PROMPT +
    `\n\nCURRENT LOCATION — the user is looking at "${label}" (${isFolder ? "folder" : "page/occurrence"} id: ${context.id}). ` +
    `When the user says "here", "this folder", "this page", or asks to create/import/place something WITHOUT naming a destination, use ${context.id} as the parentId.`;
}

// Pure: derive the named PLACES a thing can be created/moved into — folders,
// pages, and containers — from a full grid-state dump, each with a real id and
// (for containers) a parent breadcrumb to disambiguate same-named ones. A small
// local model can't reliably look ids up via tools (it fumbles, hallucinates
// placeholders, loops), so we resolve them inline. Container labels come from
// the module; parent comes from whichever occurrence lists it as a child
// (containers usually have no parentId — they're linked via occurrences[]).
export function extractDestinations(state, { limit = 150 } = {}) {
  const modules = Array.isArray(state?.modules) ? state.modules : [];
  const occurrences = Array.isArray(state?.occurrences) ? state.occurrences : [];
  const folders = Array.isArray(state?.folders) ? state.folders : [];

  const moduleById = new Map(modules.map(m => [m.id, m]));
  const folderNameById = new Map(folders.map(f => [f.id, f.name]));
  const occById = new Map(occurrences.map(o => [o.id, o]));
  // child occ id → parent occ id (containers link children via occurrences[])
  const parentByChild = new Map();
  for (const o of occurrences) for (const childId of (o.occurrences || [])) if (!parentByChild.has(childId)) parentByChild.set(childId, o.id);

  const labelOf = (occ) => moduleById.get(occ.targetId)?.label || null;
  const roleOf = (occ) => moduleById.get(occ.targetId)?.role;
  const parentLabelOf = (occ) => {
    const pid = parentByChild.get(occ.id) || occ.parentId;
    if (!pid) return null;
    if (occById.has(pid)) return labelOf(occById.get(pid));
    return folderNameById.get(pid) || null; // parent is a folder
  };

  const pages = [];
  const containers = [];
  for (const o of occurrences) {
    const role = roleOf(o);
    const label = labelOf(o);
    if (!label) continue;
    if (role === "page") pages.push({ id: o.id, label });
    else if (role === "container") containers.push({ id: o.id, label, parent: parentLabelOf(o) });
  }
  return {
    folders: folders.filter(f => f?.id && f?.name).map(f => ({ id: f.id, name: f.name })),
    pages,
    containers: containers.slice(0, limit),
  };
}

// Pure formatter: render the named places as a compact prompt block so the model
// can place/move things WITHOUT a read-tool round-trip. Dedupes identical
// container lines (e.g. per-day slot copies that share a label+parent) so the
// block stays bounded. Returns "" when there's nothing to list.
export function buildDestinationsHint({ folders = [], pages = [], containers = [] } = {}, { limit = 120 } = {}) {
  const lines = [];
  const push = (s) => { if (lines.length < limit) lines.push(s); };
  for (const f of folders) if (f?.id && f?.name) push(`- "${f.name}" (folder, parentId: ${f.id})`);
  for (const p of pages) if (p?.id && p?.label) push(`- "${p.label}" (page, parentId: ${p.id})`);
  const seen = new Set();
  for (const c of containers) {
    if (!c?.id || !c?.label) continue;
    const key = `${c.label}@${c.parent || ""}`;
    if (seen.has(key)) continue; // collapse per-day slot copies sharing label+parent
    seen.add(key);
    const where = c.parent ? ` in "${c.parent}"` : "";
    push(`- "${c.label}"${where} (container, parentId: ${c.id})`);
  }
  if (!lines.length) return "";
  const total = folders.length + pages.length + containers.length;
  const more = total > lines.length ? `\n(…and more — for anything not listed, call list_modules / list_occurrences to find its id.)` : "";
  return `\n\nKNOWN PLACES — create or move things into any of these by using its id as the parentId. Use the matching id directly; do NOT invent an id or call a read tool just to find one already listed here:\n${lines.join("\n")}${more}`;
}

// IO half: pull the grid state once (server-cached, fast) and derive every named
// place. Best-effort — any failure returns empties so the chat still runs (the
// model can fall back to the list_* tools).
async function fetchDestinations({ baseUrl, apiToken, gridId }) {
  try {
    const res = await fetch(`${baseUrl}/api/v1/grids/${encodeURIComponent(gridId)}/state`, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    if (!res.ok) return { folders: [], pages: [], containers: [] };
    return extractDestinations(await res.json());
  } catch {
    return { folders: [], pages: [], containers: [] };
  }
}

export async function assistantChat({ messages, userId, gridId, context = null, baseUrl, apiToken, onProgress = () => {} }) {
  if (!gridId) throw new Error("gridId required");
  const tools = buildTools({ baseUrl, apiToken, userId, gridId });
  // Resolve named places (folders/pages/containers) up front so the model can
  // create/move into any of them without a read round-trip.
  const destinations = await fetchDestinations({ baseUrl, apiToken, gridId });
  const today = new Date();
  const dateHint = `\n\nTODAY is ${today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} (${today.toISOString().slice(0, 10)}). Use this for "today"/"tonight" and for any date field.`;
  const systemPrompt = buildSystemPrompt(context) + buildDestinationsHint(destinations) + dateHint;
  const contextId = context?.id || null;
  const backend = await pickBackend();
  const backendTools = selectToolsForBackend(tools, backend);

  if (backend === "ollama") {
    try {
      return await ollamaLoop({ messages, tools: backendTools, systemPrompt, onProgress });
    } catch (e) {
      // We only reach here if Ollama was reachable at probe time but the loop
      // failed mid-run (timeout, model crashed). Cloud if available; otherwise
      // be HONEST — the deterministic dispatcher's "No LLM is running" message
      // is wrong (Ollama is up, just slow/erroring) and confused the user.
      if (process.env.ANTHROPIC_API_KEY) return llmLoop({ messages, tools, systemPrompt });
      return {
        ok: true,
        mode: "ollama-error",
        model: OLLAMA_MODEL,
        transcript: [{
          role: "assistant",
          content: `Jonah's local model (${OLLAMA_MODEL}) didn't finish: ${String(e?.message || e)}. Ollama is running but slow on this machine — try again, or break the request into a smaller step.`,
          toolCalls: [],
        }],
      };
    }
  }
  if (backend === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return llmLoop({ messages, tools, systemPrompt });
  }
  return deterministicDispatch({ messages, tools, contextId });
}

// Execute a SINGLE tool the user explicitly approved via the confirmation
// card. Used by POST /api/v1/assistant/confirm. Only tools flagged
// requires_confirm should reach here; we re-resolve the tool against the
// caller's token + grid (same privileges as any other call) and run it.
export async function assistantConfirm({ name, input, userId, gridId, baseUrl, apiToken }) {
  if (!gridId) throw new Error("gridId required");
  const tools = buildTools({ baseUrl, apiToken, userId, gridId });
  const tool = tools.find(t => t.name === name);
  if (!tool) return { ok: false, name, error: `unknown tool ${name}` };
  try {
    const output = await tool.run(input || {});
    return { ok: true, name, input: input || {}, output };
  } catch (e) {
    return { ok: false, name, input: input || {}, error: String(e?.message || e) };
  }
}
