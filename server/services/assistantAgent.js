// services/assistantAgent.js
//
// Jarvis. The agent loop that drives the chatbox.
//
// Mode 1: ANTHROPIC_API_KEY set → real LLM via Claude (Haiku by default,
//         configurable via ANTHROPIC_MODEL). Tool-use loop: model picks
//         a tool, we run it through the local API, feed the result back
//         to the model, repeat until the model stops calling tools.
//
// Mode 2: no key → "deterministic dispatcher" fallback. Recognizes a
//         handful of natural-language prefixes ("wiki <topic>", "import:
//         <markdown>", etc.) and runs the matching tool directly. Lets
//         the chatbox demo end-to-end without any LLM provider.
//
// Tools are wrappers over the existing /api/v1 REST endpoints — the
// agent has no special privileges. Permissions = the caller's token.

import Anthropic from "@anthropic-ai/sdk";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const MAX_TOOL_ITERATIONS = 6;

const SYSTEM_PROMPT = `You are Jarvis — the assistant for the Moduli workspace. Style: dry, efficient, faintly formal English manservant. Think Alfred or Jeeves. Brief by default; long only when answering a research query.

You operate by emitting structured tool calls. Tools available to you:
- wikipedia_search: find Wikipedia matches for a query
- wikipedia_import: research a topic on Wikipedia and create a Moduli page from it (the headliner — use this for "make me a page on X")
- import_markdown: turn user-supplied markdown into Moduli containers/instances/textblocks
- list_modules / list_occurrences / list_operations: read the user's grid
- run_operation: invoke a user-defined operation with vars

Discipline:
- ALWAYS call a tool when an action is required; never pretend to act.
- After a tool runs, summarize the result in one sentence and ask one follow-up.
- If uncertain about which tool to use, ask one clarifying question.
- When importing, prefer wikipedia_import for "look up X / research X / page on X" phrasing.`;

// Tool catalog — each entry has a name, JSON schema for inputs, and an
// async runner that hits the public API with the caller's token.
function buildTools({ baseUrl, apiToken, userId, gridId }) {
  const headers = {
    "Authorization": `Bearer ${apiToken}`,
    "Content-Type": "application/json",
  };
  const call = async (method, path, body) => {
    const init = { method, headers };
    if (body != null) init.body = JSON.stringify(body);
    const res = await fetch(`${baseUrl}/api/v1${path}`, init);
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return { status: res.status, body: parsed };
  };

  return [
    {
      name: "wikipedia_search",
      description: "Search Wikipedia for matches; returns title + snippet + URL per hit. Read-only.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string" }, limit: { type: "integer", default: 5 } },
        required: ["query"],
      },
      destructive: false,
      run: async ({ query, limit = 5 }) => {
        const r = await call("GET", `/research/wikipedia/search?q=${encodeURIComponent(query)}&limit=${limit}`);
        return r.body;
      },
    },
    {
      name: "wikipedia_import",
      description: "Research a topic on Wikipedia and create a Moduli page from it. Mints containers/instances/textblocks under parentId (or at the root if none). The user's primary 'make me a page on X' tool.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query if title is unknown" },
          title: { type: "string", description: "Exact Wikipedia article title; takes precedence over query" },
          parentId: { type: "string", description: "Optional occurrence id under which to nest the new page" },
          dryRun: { type: "boolean", default: false, description: "Plan without minting" },
        },
      },
      destructive: false,
      run: async ({ query, title, parentId, dryRun }) => {
        const r = await call("POST", `/research/wikipedia/import`, { gridId, query, title, parentId, dryRun });
        return r.body;
      },
    },
    {
      name: "import_markdown",
      description: "Turn caller-supplied markdown into Moduli entities. Use when the user pastes a doc.",
      input_schema: {
        type: "object",
        properties: {
          markdown: { type: "string" },
          title: { type: "string" },
          parentId: { type: "string" },
          dryRun: { type: "boolean", default: false },
        },
        required: ["markdown"],
      },
      destructive: false,
      run: async ({ markdown, title, parentId, dryRun }) => {
        const r = await call("POST", `/import/markdown`, { gridId, markdown, title, parentId, dryRun });
        return r.body;
      },
    },
    {
      name: "list_operations",
      description: "List the user's operations. Use ?runnable=true to filter to externally-invokable ones.",
      input_schema: {
        type: "object",
        properties: { runnable: { type: "boolean" }, limit: { type: "integer", default: 25 } },
      },
      destructive: false,
      run: async ({ runnable, limit = 25 }) => {
        const r = await call("GET", `/operations?gridId=${encodeURIComponent(gridId)}${runnable ? "&runnable=true" : ""}&limit=${limit}`);
        return r.body;
      },
    },
    {
      name: "run_operation",
      description: "Invoke an operation by id with vars. Uses the server-side executor when possible.",
      input_schema: {
        type: "object",
        properties: {
          operationId: { type: "string" },
          vars: { type: "object", additionalProperties: true },
        },
        required: ["operationId"],
      },
      destructive: false,
      run: async ({ operationId, vars }) => {
        const r = await call("POST", `/operations/${operationId}/run`, { vars: vars || {}, executor: "auto" });
        return r.body;
      },
    },
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

  // wiki | research | look up | page on
  const wikiPrefixes = [
    { re: /^import\s+wiki(?:pedia)?\s+(.+)$/i, mode: "import" },
    { re: /^(?:research|look\s*up|page\s+on)\s+(.+)$/i, mode: "import" },
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
    "I don't have an LLM provider configured, so I only respond to a few set patterns:\n" +
    "  • `wiki <topic>`         — search Wikipedia\n" +
    "  • `look up <topic>`      — research + create a Moduli page\n" +
    "  • `page on <topic>`      — same as look up\n" +
    "  • `import:\\n<markdown>` — turn pasted markdown into a page\n" +
    "  • `list ops`             — show runnable operations\n" +
    "\nSet ANTHROPIC_API_KEY in server/.env to unlock full natural language."
  );
}

// =========================================================================
// Entry point
// =========================================================================
export async function assistantChat({ messages, userId, gridId, baseUrl, apiToken }) {
  if (!gridId) throw new Error("gridId required");
  const tools = buildTools({ baseUrl, apiToken, userId, gridId });
  if (process.env.ANTHROPIC_API_KEY) {
    return llmLoop({ messages, tools, userId, gridId });
  }
  return deterministicDispatch({ messages, tools });
}
