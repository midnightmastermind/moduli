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
const MAX_TOOL_ITERATIONS = 6;

const SYSTEM_PROMPT = `You are Jonah — the assistant for the Moduli workspace. Persona: a sophisticated, unflappable turtle butler with a long Gandalf-like beard. Style: dry, precise, faintly formal; wise and patient, never folksy. Brief by default; expansive only when answering a genuine research question.

You operate by emitting structured tool calls. You have the FULL set of Moduli grid commands (the exact JSON schemas are provided to you separately):
- Research / lookup: wikipedia_search, wikipedia_summary (answer "what is X" without a page), wikipedia_import ("create a doc page of the Wikipedia article for X"), import_markdown.
- Read the grid: get_grid_state, list_modules, list_occurrences, get_occurrence, list_fields, list_operations.
- Create: create_module, create_occurrence, create_field.
- Edit: update_module, update_occurrence, set_occurrence_field (log/set a value), update_field, update_operation.
- Delete (destructive): delete_module, delete_occurrence, delete_field, delete_operation.
- Operations: run_operation, create_operation, update_operation.
(If filesystem/command tools appear in your list, they are sandboxed + require confirmation — present only when the operator enables them.)

How Moduli is shaped (so you pick the right command): a MODULE is a template (role panel/container/instance/page; kind list/doc/board/canvas/table); an OCCURRENCE is a placement of a module on the grid (carries fields, parentId, children); a FIELD defines a piece of data an instance collects; an OPERATION is an automation pipeline. To "add something to the grid" you usually create_module then create_occurrence (or create_occurrence of an existing moduleId). To "log a value" use set_occurrence_field.

Discipline:
- ALWAYS call a tool when an action is required; never pretend to act.
- Read before you write — use get_grid_state / list_* to find real ids rather than guessing them.
- For a general-information question, prefer wikipedia_summary; only wikipedia_import when asked for a page.
- For anything destructive (delete_*, update_operation), state what will change and confirm before proposing it.
- After a tool runs, summarize the result in one sentence and ask one follow-up.
- If uncertain, ask one clarifying question — one, not three.`;

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

// =========================================================================
// Mode 1 — real LLM via Anthropic SDK
// =========================================================================
async function llmLoop({ messages, tools, userId, gridId }) {
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
      system: SYSTEM_PROMPT,
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

    // Run each tool, feed results back.
    const toolResults = [];
    for (const tu of toolUses) {
      const tool = tools.find(t => t.name === tu.name);
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

async function deterministicDispatch({ messages, tools }) {
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
    const output = await runTool("import_markdown", { markdown: md });
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
        const output = await runTool("wikipedia_import", { query });
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

async function ollamaLoop({ messages, tools }) {
  // System prompt rides as the first message (Ollama /api/chat has no
  // separate `system` field). Tool catalog converts to the OpenAI
  // function shape Ollama expects.
  const apiMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...messages.map(m => ({ role: m.role, content: m.content })),
  ];
  const ollamaTools = tools.map(t => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));

  const transcript = [];
  let toolIterations = 0;

  while (toolIterations < MAX_TOOL_ITERATIONS) {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_MODEL, stream: false, messages: apiMessages, tools: ollamaTools }),
    });
    if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const msg = data.message || {};
    const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];

    apiMessages.push({ role: "assistant", content: msg.content || "", ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    transcript.push({
      role: "assistant",
      content: String(msg.content || "").trim(),
      toolCalls: toolCalls.map(tc => ({ name: tc.function?.name, input: parseToolArgs(tc.function?.arguments) })),
    });

    if (!toolCalls.length) break; // model produced a final answer

    for (const tc of toolCalls) {
      const name = tc.function?.name;
      const input = parseToolArgs(tc.function?.arguments);
      const tool = tools.find(t => t.name === name);
      let result;
      if (!tool) result = { error: `unknown tool ${name}` };
      else {
        try { result = await tool.run(input || {}); }
        catch (e) { result = { error: String(e?.message || e) }; }
      }
      apiMessages.push({ role: "tool", content: JSON.stringify(result) });
      transcript.push({ role: "tool", name, input, output: result });
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

export async function assistantChat({ messages, userId, gridId, baseUrl, apiToken }) {
  if (!gridId) throw new Error("gridId required");
  const tools = buildTools({ baseUrl, apiToken, userId, gridId });
  const backend = await pickBackend();

  if (backend === "ollama") {
    try {
      return await ollamaLoop({ messages, tools });
    } catch (e) {
      // Ollama went away mid-call (model not pulled, server stopped).
      // Degrade gracefully rather than 500: cloud if available, else
      // the deterministic dispatcher.
      if (process.env.ANTHROPIC_API_KEY) return llmLoop({ messages, tools, userId, gridId });
      const out = await deterministicDispatch({ messages, tools });
      out.note = `Ollama unavailable (${String(e?.message || e)}); used deterministic fallback.`;
      return out;
    }
  }
  if (backend === "anthropic" && process.env.ANTHROPIC_API_KEY) {
    return llmLoop({ messages, tools, userId, gridId });
  }
  return deterministicDispatch({ messages, tools });
}
