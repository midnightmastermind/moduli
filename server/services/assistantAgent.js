// services/assistantAgent.js
//
// Jonah — the agent loop that drives the Moduli assistant chatbox.
// (Persona: a sophisticated turtle butler with a flowing Gandalf-like
//  beard. Personality lives ONLY here in the system prompt + in the UI
//  avatar — the tool layer stays impersonal.)
//
// Backend selection is OFFLINE-FIRST (see pickBackend):
//   1. Local (free, private) — llama.cpp's llama-server behind llama-swap on
//      the user's PC, reached at LLM_URL (OpenAI-compatible). A fast model
//      answers questions, a stronger one builds (pickModel). This is the
//      "the point is it runs offline" path.
//   2. Anthropic Claude (cloud) — optional, only when ANTHROPIC_API_KEY is set.
//   3. Deterministic dispatcher — no model at all. Recognizes a few
//      natural-language prefixes ("wiki <topic>", "import:\n<md>"). Lets
//      the chatbox demo end-to-end with zero AI setup (dev / CI).
//
// Override the auto-selection with ASSISTANT_BACKEND=local|anthropic|deterministic.
//
// All three modes drive the SAME tool catalog. Tools are thin wrappers
// over the existing /api/v1 REST endpoints — the agent has NO special
// privileges; its permissions are exactly the caller's Bearer token.

import Anthropic from "@anthropic-ai/sdk";
import { moduliToolPack, systemToolPack } from "./assistantTools.js";
import { buildChatBody, streamChat, reachable, summarizeHttpError } from "./llmClient.js";
export { summarizeHttpError };

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
// The local runner (llama-swap on the user's PC, docs/superpowers/specs/2026-11-15-local-llm-runner-design.md).
// Two models stay loaded: `fast` for questions, `build` for building (pickModel). Context size, threads and GPU
// layers are llama-server flags (infra/llm/llama-swap.yaml), not request options.
const LLM_URL = process.env.LLM_URL || "http://localhost:8080";
const LLM_BUILD_MODEL = process.env.LLM_BUILD_MODEL || "build";
// Questions are answered by the build model too (user, 2026-11-16: "is it a normal chatbot … ask it questions" →
// "do 1 and 2"): the 3B's answers were vague or wrong. A question still gets only the READING tools (toolsForModel),
// so it cannot build by accident; LLM_ASK_MODEL=fast puts it back on the 3B (`fast` stays loaded for the import clean-up).
const LLM_ASK_MODEL = process.env.LLM_ASK_MODEL || LLM_BUILD_MODEL;
// Cap output tokens per generation. Writing is the slow part on this hardware (~7.5 tok/s for a 7B on the Radeon,
// measured 2026-11-14). 1200: one create_items call listing 13 dated instances is ~600 tokens.
const LLM_NUM_PREDICT = Number(process.env.LLM_NUM_PREDICT) || 1200;
// Per-generation cap — guards against a genuinely wedged call.
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 180000;
// Whole-request wall-clock budget across all tool iterations. Each generation's effective timeout is
// min(per-gen cap, remaining budget), so the total run never exceeds this.
const LLM_TOTAL_BUDGET_MS = Number(process.env.LLM_TOTAL_BUDGET_MS) || 300000;
const MAX_TOOL_ITERATIONS = 6;

// The local model reads its whole prompt on CPU before answering (~64 tokens/s
// for llama3.2:3b, ~28 for the 7B, measured 2026-11-02), and Cloudflare drops a
// request that sends nothing for 100s. So it gets a SHORT prompt naming only the
// tools it is offered (OFFLINE_CORE_TOOLS); every other backend keeps SYSTEM_PROMPT.
export const OFFLINE_SYSTEM_PROMPT = `You are Jonah, the assistant for the Moduli workspace: a dry, precise, faintly formal turtle butler. Brief answers.

Act by calling tools. Before a tool call write ONE short sentence saying what you are doing; after it, confirm in one sentence.
- Build in ONE call. A page with sections, links or buttons (a doc page, a glossary, a dashboard) is ALWAYS build. A plain board of rows is create_board. Rows into an existing container is create_items. Tools: build, create_board (rows as one line each, see its description), create_items (many items into one container named by path like "Tasks › Appointments", fields given BY FIELD NAME; a dropdown value that does not exist is added; for something on many dates send ONE item with repeat {from, to, weekdays} instead of listing dates), add_filter (filter on a page/container, nav showing).
- Single things: create_occurrence (label + parentId), set_occurrence_field, create_field (a select takes options), save_bookmark (one link), import_url (a page from a link), wikipedia_import. change / remove a thing by name; undo takes back the last change.
- Look up: look_up (answer about the grid from it, never from memory), list_folders, list_fields, list_occurrences, get_occurrence, run_operation, jonah_notes (how Moduli works).
- Automations: automate.
- The world: web_search beyond the grid; read_page if snippets fall short. Answer from them; end with the source's address.
Names, not ids, in the build tools. Dates as YYYY-MM-DD, durations like "4h", times like "4:00pm". Never invent ids; use one from KNOWN PLACES or a list_* result. Put everything the user listed into ONE build call. Never write out a list of dates yourself — use repeat. After creating, say how many were made. Items in a container are "instances". If something is ambiguous, ask one question.`;

const SYSTEM_PROMPT = `You are Jonah — the assistant for the Moduli workspace. Persona: a sophisticated, unflappable turtle butler with a long Gandalf-like beard. Style: dry, precise, faintly formal; wise and patient, never folksy. Brief by default; expansive only when answering a genuine research question.

You operate by emitting structured tool calls. You have the FULL set of Moduli grid commands (the exact JSON schemas are provided to you separately):
- Research / lookup: wikipedia_search, wikipedia_summary (answer "what is X" without a page), wikipedia_import ("create a doc page of the Wikipedia article for X"), wikipedia_links + wikipedia_import_batch ("X AND its surrounding links" — one card imports many), import_markdown.
- Links: save_bookmark ("bookmark this link" / "save this url to X" — a bookmark card with the page's title + cover), import_url ("make a page from this link" — shape "magic" for sectioned containers, "reader" for one container + one textblock; if the user says "reader" or "one textblock" use reader, otherwise magic).
- Read the grid: get_grid_state, list_modules, list_occurrences, get_occurrence, list_fields, list_operations, list_folders.
- Create: create_module, create_occurrence, create_field, create_folder. (To add a folder page/panel: create_module with role page/panel of the right kind, then create_occurrence of it.)
- Edit: update_module, update_occurrence, set_occurrence_field (log/set a value), update_field, update_operation, update_folder.
- Build in ONE step (prefer these over chains of create_* calls): create_board (a board page in a folder + its rows: bookmark cards when a row has a url, plain items otherwise; optional selectFields and filterField), create_items (many rows into one container named by path, e.g. "Tasks › Appointments", with field values by FIELD NAME — a dropdown value that does not exist is added; something that repeats ("Mon-Thu in November", "every Tuesday until June") is ONE item with repeat {from, to, weekdays}, never a hand-written list of dates), add_filter (a filter for a field on a page/container, nav showing). Pass names, not ids; dates as YYYY-MM-DD; durations like "4h".
- Move / copy: move_occurrence (relocate — fixes both parents' child lists), copy_occurrence (duplicate with values; mode "copylink" keeps the copy in sync; deep:true copies children). Prefer these over update_occurrence for relocating/duplicating.
- Delete (destructive): delete_module, delete_occurrence, delete_field, delete_operation, delete_folder.
- Operations: run_operation, create_operation, update_operation, delete_operation.
- Grid + filters: update_grid (name/dimensions/meta + namedFilters), set_active_filter (switch the active filter / change the active date or period — what's visible).
- Batching: when the user asks for SEVERAL items at once ("add pages A, B, C to the Interfaces folder"), find the folder's id ONCE (get_grid_state / list_folders), then emit one create tool call per item into that parent — narrate each briefly.
(If filesystem/command tools appear in your list, they are sandboxed + require confirmation — present only when the operator enables them.)

How Moduli is shaped (so you pick the right command): a MODULE is a template (role panel/container/instance/page; kind list/doc/board/canvas/table); an OCCURRENCE is a placement of a module on the grid (carries fields, parentId, children); a FIELD defines a piece of data an instance collects; an OPERATION is an automation pipeline. To "add something to the grid" you usually create_module then create_occurrence (or create_occurrence of an existing moduleId). To "log a value" use set_occurrence_field.

Discipline:
- ALWAYS call a tool when an action is required; never pretend to act.
- Before each tool call, write ONE short sentence saying what you're about to do (e.g. "Creating the task in the 6:30pm slot…"). This is the user's only progress signal while tools run.
- NEVER invent or use placeholder ids like "<Timeslot-container-id>". Use a REAL id — from KNOWN PLACES in this prompt, or from a list_* / get_grid_state result. If you don't have the id, fetch it first.
- For a general-information question, prefer wikipedia_summary; only wikipedia_import when asked for a page.
- "Make a page on X AND the surrounding/linked articles": call wikipedia_links(title:X, max:N) to get the linked titles, THEN call wikipedia_import_batch ONCE with all the titles you'll import (the main one + each chosen link). The user gets ONE summary card to approve and can deselect titles; it imports each as its own doc page AND relinks the cross-references automatically — so you do NOT call wikipedia_import per title or relink_imports yourself. If the user didn't say HOW MANY links, default to the main article + the top 5 links; ask only if they want more/fewer.
- For anything destructive (delete_*, update_operation, apply_template, update_grid), briefly state what will change, then GO AHEAD and call the tool — the app shows the user an Approve/Decline card before it actually runs, so you don't need to ask permission in text first.
- After a tool runs, confirm what you did in ONE sentence. Do NOT ask a follow-up unless you genuinely need missing information to finish the task. (Never ask "what is the purpose" — just do it.)
- You keep notes in the grid's Jonah folder: call jonah_notes (which:"moduli" with a topic) when unsure how something in Moduli works, which:"about" for the user's preferences, which:"memory" for things you were told to remember. When told to remember something, call jonah_remember.
- The user built Moduli and likes short, direct answers. Call the items in a container "instances", never "rows".
- If uncertain, ask one clarifying question — one, not three.
- When a tool result says \`ambiguous: true\` (several things match, e.g. a Wikipedia title that names several articles), do NOT pick one: reply asking which one the user means, naming the options. The same goes for anything else you can't tell apart (two places or items with the same name): ask, don't guess.

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
// breadth invites wrong/looping calls. For the local backend we hand it a
// curated core that covers research/import + the common read/create verbs, and
// leave the long tail (manifests, views, grid settings, templates, destructive
// update/delete, operation authoring) to the cloud model. Override the set via
// LLM_TOOL_ALLOWLIST (comma-separated tool names); empty/unset → the default.
const OFFLINE_CORE_TOOLS = new Set([
  "build", "change", "remove", "undo", "create_board", "create_items", "add_filter",
  "create_occurrence", "set_occurrence_field", "create_field",
  "save_bookmark", "import_url", "wikipedia_import",
  "list_folders", "list_fields", "list_occurrences", "get_occurrence",
  "run_operation", "jonah_notes", "look_up", "web_search", "read_page", "automate",
]);

function offlineToolAllowlist() {
  const raw = (process.env.LLM_TOOL_ALLOWLIST || "").trim();
  if (!raw) return OFFLINE_CORE_TOOLS;
  return new Set(raw.split(",").map(s => s.trim()).filter(Boolean));
}

// Pure: narrow the catalog for a given backend. The local backend gets the curated core;
// everything else gets the full set. Never returns empty — if the allowlist
// matches nothing (misconfig), fall back to the full catalog so the assistant
// stays functional.
export function selectToolsForBackend(tools, backend, allowlist = offlineToolAllowlist()) {
  if (backend !== "local") return tools;
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
        content: toolResultForModel(resultPayload),
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
    const askLlm = ambiguityQuestion(transcript.filter((m) => m.role === "tool").slice(-toolResults.length).map((m) => m.output));
    if (askLlm) {
      transcript.push({ role: "assistant", content: askLlm });
      return { ok: true, mode: "llm", model: ANTHROPIC_MODEL, transcript };
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
    "\nFor full natural language, start the local model runner on the PC (infra/llm) or set ANTHROPIC_API_KEY."
  );
}

// =========================================================================
// Mode 0 — the local model runner (offline-first, preferred)
// =========================================================================
//
// llama-server speaks the OpenAI chat API (/v1/chat/completions) with native
// tool calling (--jinja). The loop mirrors llmLoop: send messages + tools,
// the model may answer with `tool_calls`, we run them and feed
// `{role:"tool", tool_call_id}` results back, repeat until it stops calling
// tools or we hit the cap.

// A streamed tool call's arguments arrive as a JSON string; a call recovered
// from text is already an object. Accept both.
function parseToolArgs(a) {
  if (a == null) return {};
  if (typeof a === "object") return a;
  try { return JSON.parse(a); } catch { return {}; }
}

// Some tool-capable models (notably qwen2.5-coder, and llama3.2 3B) frequently DON'T use the
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

// What the MODEL is shown of a tool's result. The drawer still gets the whole
// result (the transcript); the model only needs enough to answer or to pick an
// id. Measured: list_operations returned 329k characters of pipelines, which on
// the local model took ~195s to read and left it answering "The". A long list
// keeps each record's identifying keys; anything still too long is cut.
export const TOOL_RESULT_MAX_CHARS = 6000;
const RECORD_KEYS = ["id", "name", "label", "role", "kind", "type", "enabled", "parentId", "moduleId", "description", "triggerType", "unit"];
function slimRecord(r) {
  if (!r || typeof r !== "object" || Array.isArray(r)) return r;
  const out = {};
  for (const k of RECORD_KEYS) {
    if (r[k] == null || r[k] === "") continue;
    out[k] = typeof r[k] === "string" && r[k].length > 120 ? r[k].slice(0, 120) + "…" : r[k];
  }
  return Object.keys(out).length ? out : r;
}
// A tool that found several matches answers { ambiguous: true, title, options }.
// The turn then ENDS on a question: a guess from the model here is a guess the
// user never asked for, and the drawer shows the options as buttons to pick.
export function ambiguityQuestion(results) {
  const amb = (results || []).find((r) => r && r.ambiguous);
  if (!amb) return null;
  const names = (amb.options || []).map((o) => o.title).filter(Boolean);
  return `“${amb.title}” could mean several things${names.length ? ` (${names.slice(0, 6).join(", ")}${names.length > 6 ? ", …" : ""})` : ""}. Which one did you mean?`;
}

export function toolResultForModel(result, max = TOOL_RESULT_MAX_CHARS) {
  const whole = JSON.stringify(result ?? null);
  if (whole.length <= max) return whole;
  let slim = result;
  if (Array.isArray(result)) slim = result.map(slimRecord);
  else if (result && typeof result === "object") {
    slim = {};
    for (const [k, v] of Object.entries(result)) slim[k] = Array.isArray(v) ? v.map(slimRecord) : v;
  }
  const text = JSON.stringify(slim);
  if (text.length <= max) return text;
  return text.slice(0, max) + ` …(cut: the full result is ${whole.length} characters; ask for fewer, or filter)`;
}

// The gateway gave up waiting before the runner sent anything (reading a long
// prompt can outlast Cloudflare's 100s). The runner keeps the prompt it read,
// so the same request again is quick (measured on Ollama: 125s 524, then 18s).
export function isGatewayTimeout(err) {
  return [502, 503, 504, 524].includes(Number(err?.status));
}

/**
 * Which local model answers this turn. Pure. Building something goes to the stronger model; a question goes to the
 * fast one (spec: "the 3B answers questions; the 7B builds"). A cheap rule on the newest user message — it must not
 * cost a model round trip of its own. A tool call the fast model makes still runs.
 */
// Automations too (2026-11-16): "remind me…", "every morning…", "whenever I tick…", "automatically…".
const BUILD_VERBS = /\b(add|make|create|build|put|set|move|copy|import|rename|delete|remove|new|undo|change|edit|update|fix|remind|automate|automatically|whenever|every (?:day|morning|night|evening|week|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;
export function pickModel(text) {
  return BUILD_VERBS.test(String(text || "")) ? "build" : "fast";
}
// A question goes to the fast model, and the fast model only READS: asked "how many movies are on my Movies board?",
// llama3.2 3B answered by calling create_board (eval, 2026-11-15). Reading tools are named for what they do.
const READ_TOOL = /^(list_|get_|look_up$|wikipedia_search$|wikipedia_summary$|wikipedia_links$|jonah_notes$|web_search$|read_page$)/;
// A request for a PAGE (a doc page, a glossary, a dashboard, sections) without a board in it is a `build`: with the
// first turn forced to a tool call, the 7B picked create_occurrence or create_board for the glossary (eval,
// 2026-11-15). Those requests are not offered the one-row creators or create_board, so a forced call cannot land on
// them. Imports (import_url, wikipedia_*) stay — "make a page from this link" is page-shaped too.
const PAGE_SHAPED = /\b(doc page|page|glossary|dashboard|sections?)\b/i;
// add_filter too (2026-11-16): after the web tools were added, a glossary's forced first call landed on add_filter
// 26 times ("no container named Home › Mail"); a page request never wants a board's filter.
const NOT_FOR_PAGES = new Set(["create_occurrence", "set_occurrence_field", "create_field", "create_board", "create_items", "save_bookmark", "add_filter"]);
const EDIT_TOOLS = new Set(["change", "remove", "undo"]);
const EDIT_WORDS = /\b(undo|change|rename|move|delete|remove|edit|update|fix|replace|put back)\b/i;
export function isPageShaped(text) {
  const t = String(text || "");
  return PAGE_SHAPED.test(t) && !/\bboard\b/i.test(t);
}
// A page request is offered `build` and not the one-row creators (measured: narrowed 8 of 10 glossary runs passed,
// the same tools + a steering note 3 of 7, 2026-11-16). The dropped tools sit LAST in every build request, so the
// page list is the start of the full one: switching kinds re-reads ~2,600 prompt tokens (~50s) instead of ~4,200.
// An automation request ("remind me…", "every day at…", "whenever I tick…") gets `automate` and what it needs to name
// things; every other request does not see it — the whole list is re-read before each answer (2026-11-16).
const AUTOMATION_WORDS = /\b(remind|automate|automatically|automation|whenever|every (?:day|morning|night|evening|week|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|each (?:day|morning|night|week))\b/i;
const AUTOMATION_TOOLS = new Set(["automate", "look_up", "list_fields", "list_folders", "jonah_notes"]);
export function isAutomationShaped(text) { return AUTOMATION_WORDS.test(String(text || "")); }
export function toolsForModel(tools, which, text = "") {
  if (which === "build" && isAutomationShaped(text)) {
    const kept = (tools || []).filter((t) => AUTOMATION_TOOLS.has(t.name));
    if (kept.some((t) => t.name === "automate")) return kept;
  }
  tools = (tools || []).filter((t) => t.name !== "automate");
  if (which !== "build") return (tools || []).filter((t) => READ_TOOL.test(t.name));
  // Order: the rest, then the edit tools, then the one-row tools — so "make a page" (the rest) and "edit a page"
  // (+ edits) are each the START of the full list, and the runner reuses that prefix of the prompt.
  const ts = tools || [];
  const all = [...ts.filter((t) => !NOT_FOR_PAGES.has(t.name) && !EDIT_TOOLS.has(t.name)), ...ts.filter((t) => EDIT_TOOLS.has(t.name)), ...ts.filter((t) => NOT_FOR_PAGES.has(t.name))];
  if (!isPageShaped(text)) return all;
  // A request to MAKE a page that names no edit is not offered the edit tools: its forced first call landed on
  // `change` 5 times ("nothing named Home › Quick Links", 2026-11-16).
  const editing = EDIT_WORDS.test(String(text || ""));
  const kept = all.filter((t) => !NOT_FOR_PAGES.has(t.name) && (editing || !EDIT_TOOLS.has(t.name)));
  return kept.some((t) => t.name === "build") ? kept : all;   // never strip everything a page could be built with
}
function modelIdFor(which) {
  return which === "build" ? LLM_BUILD_MODEL : LLM_ASK_MODEL;
}
function lastUserText(messages) {
  const m = [...(messages || [])].reverse().find((x) => x.role === "user" && typeof x.content === "string");
  return m?.content || "";
}

// The request as the runner sees it. The FIXED system prompt goes first and the tools are rendered right after it by
// the chat template, so that prefix is byte-identical on every request and llama-server reuses it (cache_prompt).
// What changes per request (places, today, where the user is, notes) is `contextNote`, a system message placed just
// before the newest user message — after the history, so earlier turns stay part of the reusable prefix too.
export function buildLocalMessages({ systemPrompt, contextNote = "", messages = [] }) {
  const history = messages.map((m) => ({ role: m.role, content: m.content }));
  let lastUser = -1;
  for (let i = history.length - 1; i >= 0; i--) if (history[i].role === "user") { lastUser = i; break; }
  const out = [{ role: "system", content: systemPrompt }];
  if (!contextNote) return out.concat(history);
  if (lastUser < 0) return out.concat(history, [{ role: "system", content: contextNote }]);
  return out.concat(history.slice(0, lastUser), [{ role: "system", content: contextNote }], history.slice(lastUser));
}

// ── the running log (user, 2026-11-16: "i want real updated responses from the chat like you do") ──────────
// Each step Jonah takes is ONE sentence sent as `{phase:"step", text, status}` (status run | ok | warn). The window
// keeps them as a log under the request, so you see what it is doing and what it found, not one "thinking" line.
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export function describeCall(name, input = {}) {
  const i = input || {};
  const nodeName = (n) => (n && typeof n === "object") ? (n.page || n.folder || n.section || n.item || n.button || "") : String(n || "");
  switch (name) {
    case "build": {
      const names = (Array.isArray(i.nodes) ? i.nodes : []).map(nodeName).filter(Boolean);
      return `Building ${names.length ? names.map((x) => `"${x}"`).join(", ") : "it"}${i.under ? ` in "${i.under}"` : ""}`;
    }
    case "change": {
      const what = [i.rename && `rename to "${i.rename}"`, i.fields && `set ${plural(Object.keys(i.fields).length, "field")}`, i.moveTo && `move to "${i.moveTo}"`].filter(Boolean).join(", ");
      return `Changing "${i.name || "?"}"${what ? ` — ${what}` : ""}`;
    }
    case "remove": return `Removing "${i.name || "?"}" and what is inside it`;
    case "undo": return "Undoing the last change";
    case "create_items": return `Adding ${plural(Array.isArray(i.items) ? i.items.length : 0, "item")} to ${i.container || "a container"}`;
    case "create_board": return `Making the board "${i.name || "?"}"`;
    default: return `${String(name || "a tool").replace(/_/g, " ")}`;
  }
}
export function describeResult(name, r) {
  if (!r || typeof r !== "object") return "done";
  if (r.error) return `failed — ${String(r.error).slice(0, 120)}`;
  for (const k of ["folders", "fields", "occurrences", "items", "results", "operations", "modules"]) {
    if (Array.isArray(r[k])) return `found ${plural(r[k].length, k.replace(/s$/, ""))}`;
  }
  if (Array.isArray(r)) return `found ${r.length}`;
  return "done";
}
function planSummary(preview) {
  const mods = Array.isArray(preview?.modules) ? preview.modules : [];
  if (!mods.length) return "";
  const pages = mods.filter((m) => m.role === "page").length;
  const sections = mods.filter((m) => m.role === "container").length;
  const links = mods.filter((m) => m.kind === "inline" || m.kind === "bookmark").length;
  return [pages && plural(pages, "page"), sections && plural(sections, "section"), links && plural(links, "link")].filter(Boolean).join(", ");
}

/**
 * What the request asked for that a planned build leaves out — the check's other half (it only saw what was WRONG;
 * a run with no buttons at all, though asked for, passed it: 2026-11-16). Every web address the user typed must
 * appear in the plan, and "button" in the request needs at least one button field. Pure; [] when nothing is missing.
 */
export function missingFromRequest(text, preview) {
  if (!preview || !text) return [];
  const t = String(text);
  const blob = JSON.stringify([preview.modules || [], preview.occurrences || []]);
  const asked = [...new Set((t.match(/https?:\/\/[^\s,;)<>"]+/g) || []).map((u) => u.replace(/[.,;:!?]+$/, "")))];
  const missing = asked.filter((u) => !blob.includes(u) && !blob.includes(u.replace(/\/$/, "")));
  const out = [];
  if (missing.length) out.push(`left out ${missing.length === 1 ? "a link" : `${missing.length} links`} the user gave: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " …" : ""}`);
  const buttons = (preview.fields || []).filter((f) => f?.type === "button").length;
  if (/\bbuttons?\b/i.test(t) && buttons === 0) out.push(`the user asked for buttons and none were made — add [open links] to a section heading`);
  return out;
}

/**
 * A look_up result in plain words — what Jonah says when the model's own answer does not pass the data on (the 3B
 * answered "This output confirms that the tool call was successful", 2026-11-16). Pure; "" for nothing usable.
 */
export function formatLookup(r) {
  if (!r || typeof r !== "object" || r.error || !r.name) return "";
  const list = (xs, n = 12) => xs.slice(0, n).join(", ") + (xs.length > n ? ` and ${xs.length - n} more` : "");
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
  const parts = [`**${r.path || r.name}**${r.kind ? ` (${r.kind})` : ""}`];
  if (r.count) parts.push(`${plural(r.count, "item")}: ${list(r.items || [])}`);
  if ((r.links || []).length) parts.push(`${plural(r.links.length, "link")}: ${list(r.links.map((l) => l.url ? `${l.label} (${host(l.url) || l.url})` : `${l.label} → ${l.to}`))}`);
  if ((r.sections || []).length) parts.push(`${plural(r.sections.length, "section")}: ${list(r.sections.map((x) => x.name).filter(Boolean))}`);
  if (parts.length === 1) parts.push("nothing inside it yet");
  return parts.join("\n- ");
}
/** True when an answer passes on at least one name the lookup found (or there was nothing to pass on). */
export function answerUsesLookup(answer, r) {
  const names = [...(r?.items || []), ...(r?.links || []).map((l) => l.label), ...(r?.sections || []).map((x) => x.name)].filter(Boolean);
  if (!names.length) return true;
  const a = String(answer || "").toLowerCase();
  return names.some((n) => a.includes(String(n).toLowerCase()));
}

/**
 * A confirm-tool call, checked first (Jonah, 2026-11-15). A tool with `preview(input)` gets a practice run that writes
 * nothing. Problems on the FIRST check go back to the model to fix (`retry`, the text of the tool result); a clean
 * check, or a second one, becomes the confirm card with the preview attached so the card can draw it. Never throws:
 * a preview that fails just means a card without a picture.
 * @returns {Promise<{ retry: string, problems: string[] } | { pending: object }>}
 */
export async function holdForConfirm({ tool, name, input, checked, say = () => {}, request = "" }) {
  const pending = { name, input: input || {}, description: tool.description };
  if (typeof tool.preview !== "function") { say("Waiting for you to approve", "ok"); return { pending }; }
  say("Checking it first (a practice run — nothing is written yet)", "run");
  let preview = null;
  try { preview = await tool.preview(input || {}); } catch { preview = null; }
  const problems = [...(Array.isArray(preview?.problems) ? preview.problems : []),
    ...(name === "build" ? missingFromRequest(request, preview?.preview) : [])];
  if (problems.length && !checked.has(name)) {
    say(`Found ${plural(problems.length, "problem")}: ${problems[0]}${problems.length > 1 ? " …" : ""} — fixing`, "warn");
    checked.add(name);
    return { problems, retry: toolResultForModel({ ok: false, notDoneYet: true, checkedFirst: true, problems,
      // No words before the call: at ~7 tokens/s an explanation used up the request's time and the call never came
      // (glossary eval, 2026-11-15 — the answer stopped mid-sentence at 240s).
      next: `Nothing was made. Reply with ONLY the corrected ${name} call, the whole thing, no words before it (call it unchanged to keep it as is).` }) };
  }
  const summary = planSummary(preview?.preview);
  say(problems.length ? `${plural(problems.length, "problem")} left — showing it to you anyway` : `Check passed${summary ? `: ${summary}` : ""}`, problems.length ? "warn" : "ok");
  say("Waiting for you to approve", "ok");
  return { pending: { ...pending, ...(preview?.preview ? { preview: preview.preview } : {}), ...(problems.length ? { problems } : {}) } };
}

export async function localLoop({ messages, tools, systemPrompt = OFFLINE_SYSTEM_PROMPT, contextNote = "", model, forceFirst = true, onProgress = () => {}, deps = {} }) {
  const stream = deps.streamChat || streamChat;
  const useModel = model || modelIdFor(pickModel(lastUserText(messages)));
  const apiMessages = buildLocalMessages({ systemPrompt, contextNote, messages });

  const transcript = [];
  let toolIterations = 0;
  let callSeq = 0;
  const checked = new Set();   // confirm-tools already sent back once (holdForConfirm)
  let mustCallTool = false;    // set after a send-back: the next turn must be the corrected call
  const say = (text, status = "run") => onProgress({ phase: "step", text, status });
  const deadline = Date.now() + LLM_TOTAL_BUDGET_MS;

  while (toolIterations < MAX_TOOL_ITERATIONS) {
    // Stop launching new generations once the whole-request budget is spent.
    const remaining = deadline - Date.now();
    if (remaining < 5000) {
      transcript.push({ role: "assistant", content: "(stopped — Jonah ran out of time on this request; the local model is slow on this machine. Try a simpler step.)" });
      break;
    }
    onProgress({ phase: "thinking", iteration: toolIterations + 1 });
    say(toolIterations === 0 ? "Reading your request" : mustCallTool ? "Writing the corrected version" : "Reading the result");
    // Each attempt gets its own timer — a retry after a gateway timeout must not inherit the time the first spent.
    let streamed;
    for (let attempt = 0; ; attempt++) {
      const left = deadline - Date.now();
      const capMs = Math.min(LLM_TIMEOUT_MS, left);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), capMs);
      try {
        streamed = await stream({
          url: LLM_URL,
          // A build request's FIRST turn must be a tool call: llama.cpp then constrains the reply to a call whose
          // arguments match the tool's schema (Jonah wrote calls as plain text before). Later turns may answer.
          body: buildChatBody({ model: useModel, messages: apiMessages, tools, stream: true, maxTokens: LLM_NUM_PREDICT,
            // …and so must the turn right after a self-check sent a build back: the model otherwise answers "let's
            // fix that" in words and nothing is built (measured 2 of 4 glossary runs, 2026-11-15).
            // A question's first turn too: the 3B said "I'm calling list_occurrences" and answered from nothing
            // (0 of 4 known-answer questions, 2026-11-16). Only when it has tools — an explanation from the notes has none.
            // Not for a question on the 7B (2026-11-16, Jonah as a chatbot): "thanks" or "tell me a joke" needs no tool,
            // and the 7B looks things up unforced — forceFirst is false for questions (assistantChat).
            toolChoice: ((toolIterations === 0 && forceFirst) || mustCallTool) && tools.length ? "required" : undefined }),
          signal: ctrl.signal,
          onToken: (delta) => onProgress({ phase: "token", delta }),
        });
        break;
      } catch (e) {
        if (e?.name === "AbortError") throw new Error(`the local model timed out (>${Math.round(capMs / 1000)}s)`);
        // See isGatewayTimeout: the prompt is read by now, so asking again is fast.
        if (!isGatewayTimeout(e) || attempt >= 2 || deadline - Date.now() < 20000) throw e;
        onProgress({ phase: "retry", attempt: attempt + 1 });
      } finally {
        clearTimeout(timer);
      }
    }
    if (streamed.timings) onProgress({ phase: "timings", timings: streamed.timings, model: useModel });
    const toolCalls = Array.isArray(streamed.toolCalls) ? [...streamed.toolCalls] : [];

    // Recover a tool call the model wrote into content instead of the native tool_calls channel (see
    // parseContentToolCall). When recovered, the raw JSON blob is not shown — it is a tool call, not a message.
    let visibleContent = String(streamed.content || "").trim();
    if (!toolCalls.length) {
      const recovered = parseContentToolCall(streamed.content, new Set(tools.map(t => t.name)));
      if (recovered) {
        toolCalls.push({ id: null, function: { name: recovered.name, arguments: recovered.arguments } });
        visibleContent = "";
      }
    }
    // Every call needs an id to answer, and its arguments as a JSON string (the OpenAI message shape).
    for (const tc of toolCalls) {
      if (!tc.id) tc.id = `call_${++callSeq}`;
      if (typeof tc.function.arguments !== "string") tc.function.arguments = JSON.stringify(tc.function.arguments ?? {});
    }

    apiMessages.push({
      role: "assistant",
      content: streamed.content || "",
      ...(toolCalls.length ? { tool_calls: toolCalls.map((tc) => ({ id: tc.id, type: "function", function: tc.function })) } : {}),
    });
    transcript.push({
      role: "assistant",
      content: visibleContent,
      toolCalls: toolCalls.map(tc => ({ name: tc.function?.name, input: parseToolArgs(tc.function?.arguments) })),
    });

    if (!toolCalls.length) {
      // The grid's answer, in code's words, when the model's reply does not pass it on.
      const looked = [...transcript].reverse().find((t) => t.role === "tool" && t.name === "look_up" && t.output && !t.output.error);
      if (looked && !answerUsesLookup(visibleContent, looked.output)) {
        const said = formatLookup(looked.output);
        // REPLACES the model's sentence: one that names nothing it found is at best empty and at worst wrong ("I have
        // only one link." above two links, 2026-11-16).
        if (said) transcript[transcript.length - 1].content = said;
      }
      break; // model produced a final answer
    }

    // requires_confirm tools are held for user Approve/Decline (see llmLoop).
    const pending = [];
    const stepResults = [];
    let retried = false;
    for (const tc of toolCalls) {
      const name = tc.function?.name;
      const input = parseToolArgs(tc.function?.arguments);
      const tool = tools.find(t => t.name === name);
      say(describeCall(name, input));
      if (tool && tool.requires_confirm) {
        const held = await holdForConfirm({ tool, name, input, checked, say, request: lastUserText(messages) });
        if (held.retry) {
          apiMessages.push({ role: "tool", tool_call_id: tc.id, content: held.retry });
          transcript.push({ role: "tool", name, input, output: { checkedFirst: true, problems: held.problems } });
          retried = true;
          continue;
        }
        pending.push(held.pending);
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
      say(`${describeCall(name, input)} — ${describeResult(name, result)}`, result?.error ? "warn" : "ok");
      apiMessages.push({ role: "tool", tool_call_id: tc.id, content: toolResultForModel(result) });
      transcript.push({ role: "tool", name, input, output: result });
      stepResults.push(result);
    }
    if (pending.length) {
      return { ok: true, mode: "local", model: useModel, transcript, pendingConfirmations: pending };
    }
    mustCallTool = retried;
    if (retried) { toolIterations++; continue; }
    const ask = ambiguityQuestion(stepResults);
    if (ask) {
      transcript.push({ role: "assistant", content: ask });
      return { ok: true, mode: "local", model: useModel, transcript };
    }
    toolIterations++;
  }

  return { ok: true, mode: "local", model: useModel, transcript };
}

// =========================================================================
// Entry point — offline-first backend selection
// =========================================================================
async function pickBackend() {
  const forced = (process.env.ASSISTANT_BACKEND || "").toLowerCase();
  // A forced local backend still asks the runner first: a PC that is asleep must answer in ~1s, not after the
  // 180s generation timeout (final review, 2026-11-15).
  if (forced === "local") return (await reachable({ url: LLM_URL })) ? "local" : "deterministic";
  if (forced === "anthropic" || forced === "deterministic") return forced;
  // KEY-FIRST: configuring ANTHROPIC_API_KEY is an explicit opt-in to Claude, so
  // prefer it. Without a key, prefer the local runner (offline, private, free),
  // else the no-model dispatcher. ASSISTANT_BACKEND=local forces local.
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (await reachable({ url: LLM_URL })) return "local";
  return "deterministic";
}

// Compose the per-request system prompt: base persona + an optional
// "current location" line so the model can resolve "here" / "this folder"
// to a real id without the user spelling out the id.
export function buildSystemPrompt(context) {
  return SYSTEM_PROMPT + buildLocationHint(context);
}

// The "where the user is" line on its own, so the chat can put it LAST in the
// prompt: it changes with every page, and the runner only reuses the part of a prompt
// that matches the previous one from the start.
/**
 * What the user has selected, for "these" / "this" (user, 2026-11-16: act on what you are looking at). The window sends
 * `context.selection` = [{ id, label, path }] (built from its multi-selection). Pure; "" when nothing is selected.
 */
export function buildSelectionHint(context) {
  const sel = Array.isArray(context?.selection) ? context.selection.filter((x) => x && x.id).slice(0, 20) : [];
  if (!sel.length) return "";
  const lines = sel.map((x, i) => `${i + 1}. ${x.label || "(untitled)"}${x.path ? ` (in ${x.path})` : ""} id:${x.id}`);
  return `\n\nSELECTED — "these" / "this" / "them" / "the selected" mean exactly these ${sel.length}. To change or remove ` +
    `them pass each one's id (one call per item):\n${lines.join("\n")}`;
}

export function buildLocationHint(context) {
  if (!context || !context.id) return buildSelectionHint(context);
  const label = context.label || context.id;
  const isFolder = context.type === "folder";
  return `\n\nCURRENT LOCATION — the user is looking at "${label}" (${isFolder ? "folder" : "page/occurrence"} id: ${context.id}). ` +
    `When the user says "here", "this folder", "this page", or asks to create/import/place something WITHOUT naming a destination, use ${context.id} as the parentId.` +
    buildSelectionHint(context);
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

  const labelOf = (occ) => moduleById.get(occ.moduleId)?.label || null;
  const roleOf = (occ) => moduleById.get(occ.moduleId)?.role;
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

// The fixed system prompt and the per-request note, split so the fixed part is identical on every request
// (see buildLocalMessages). Pure. `today` is a Date.
export function composeSystemParts({ local = true, destinations = null, context = null, today = new Date() } = {}) {
  const dateHint = `TODAY is ${today.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} (${today.toISOString().slice(0, 10)}). Use this for "today"/"tonight" and for any date field.`;
  const systemPrompt = local ? OFFLINE_SYSTEM_PROMPT : SYSTEM_PROMPT;
  const contextNote = (buildDestinationsHint(destinations, { limit: local ? OFFLINE_PLACES_LIMIT : 120 }) + "\n\n" + dateHint + buildLocationHint(context)).trim();
  return { systemPrompt, contextNote };
}

// The tools and prompt parts a chat sends. Shared with warmAssistant so the warm-up reads exactly the prefix the
// next chat will start with.
async function composeChat({ userId, gridId, context, baseUrl, apiToken, backend }) {
  const local = backend === "local";
  const tools = buildTools({ baseUrl, apiToken, userId, gridId });
  // Resolve named places (folders/pages/containers) up front so the model can
  // create/move into any of them without a read round-trip.
  const destinations = await fetchDestinations({ baseUrl, apiToken, gridId });
  const { systemPrompt, contextNote } = composeSystemParts({ local, destinations, context });
  return { tools, systemPrompt, contextNote };
}

// Have the local model read the fixed part of the prompt before the user asks
// anything (called when the drawer opens). The first question then skips the
// long read that otherwise runs past Cloudflare's 100s. Fire-and-forget; one
// warm-up per grid per WARM_EVERY_MS.
const WARM_EVERY_MS = 10 * 60 * 1000;
// Known places listed to the local model (each line costs read time on CPU).
const OFFLINE_PLACES_LIMIT = 40;
const lastWarm = new Map();
export async function warmAssistant({ userId, gridId, baseUrl, apiToken }) {
  if (!gridId) return { warmed: false, reason: "no_grid" };
  if (await pickBackend() !== "local") return { warmed: false, reason: "not_local" };
  const now = Date.now();
  if (now - (lastWarm.get(gridId) || 0) < WARM_EVERY_MS) return { warmed: false, reason: "recent" };
  lastWarm.set(gridId, now);
  const { tools, systemPrompt } = await composeChat({ userId, gridId, context: null, baseUrl, apiToken, backend: "local" });
  // Only the fixed part: that is what every later request starts with. Builds are the slow ones, so warm that model.
  const body = buildChatBody({
    model: LLM_BUILD_MODEL,
    messages: [{ role: "system", content: systemPrompt }, { role: "user", content: "hi" }],
    tools: selectToolsForBackend(tools, "local"),
    stream: true,
    maxTokens: 1,
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await streamChat({ url: LLM_URL, body });
      return { warmed: true };
    } catch (e) {
      if (!isGatewayTimeout(e)) break;
    }
  }
  lastWarm.delete(gridId);
  return { warmed: false, reason: "failed" };
}

// A question about how Moduli works gets the matching part of Jonah's guide in
// that turn's prompt. The small local model rarely picks jonah_notes on its
// own, and a read only for these questions keeps every other turn as cheap.
const MODULI_WORDS = /\b(container|instance|occurrence|module|feed|template|operation|trigger|filter|copy.?link|panel|page|field|tracker|schedule|day ?page|command center|radial|share|undo)s?\b/i;
const NOTE_STOP = new Set("how do does did can could would should i you we it is are a an the in on of to for what whats what's work works working moduli me my this that with".split(" "));
export function notesTopicFor(text) {
  const t = String(text || "");
  const asksHow = /\b(how|what|why|where|explain)\b/i.test(t) && (/\bmoduli\b/i.test(t) || MODULI_WORDS.test(t));
  if (!asksHow) return null;
  // About the user's OWN things ("what links are on MY page", "what's on my schedule") is a question for the grid
  // (look_up), not for the notes on how Moduli works — answered from the notes, it had no tools and said "no links".
  if (/\b(my|mine|i have|do i|i've|i've got)\b/i.test(t)) return null;
  const words = t.toLowerCase().replace(/[^a-z0-9-]+/g, " ").split(" ").filter((w) => w && !NOTE_STOP.has(w));
  return words.length ? words.join(" ") : null;
}

const NOTES_HINT_MAX = 2000;
async function notesHintFor(messages, { baseUrl, apiToken, gridId }) {
  const last = [...(messages || [])].reverse().find((m) => m.role === "user" && typeof m.content === "string");
  const topic = notesTopicFor(last?.content);
  if (!topic) return "";
  try {
    const res = await fetch(`${baseUrl}/api/v1/assistant/notes?gridId=${encodeURIComponent(gridId)}&which=moduli&topic=${encodeURIComponent(topic)}`,
      { headers: { Authorization: `Bearer ${apiToken}` } });
    const j = await res.json();
    if (!j?.text) return "";
    return `\n\nFROM YOUR NOTES ON HOW MODULI WORKS. Answer the question in two or three sentences using ONLY what these notes say; do not add steps, options or buttons they do not mention, and if they do not answer it, say you are not sure:\n${j.text.slice(0, NOTES_HINT_MAX)}`;
  } catch { return ""; }
}

/**
 * The conversation the model sees: what the user said and what Jonah answered, as text. The window sends its whole
 * list back, which also holds approval cards, tool results, step logs and `_meta` lines — roles no chat template
 * knows, most with no `content`. Pure.
 */
export function conversationOnly(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }));
}

export async function assistantChat({ messages: rawMessages, userId, gridId, context = null, baseUrl, apiToken, onProgress = () => {} }) {
  if (!gridId) throw new Error("gridId required");
  const messages = conversationOnly(rawMessages);
  const backend = await pickBackend();
  const composed = await composeChat({ userId, gridId, context, baseUrl, apiToken, backend });
  const notesHint = await notesHintFor(messages, { baseUrl, apiToken, gridId });
  // An explanation needs no tools; offered them, the small model calls one
  // and answers from that instead of the notes it was just given.
  const tools = notesHint ? [] : composed.tools;
  const contextNote = (composed.contextNote + notesHint).trim();
  const systemPrompt = composed.systemPrompt + "\n\n" + contextNote;
  const contextId = context?.id || null;
  const backendTools = selectToolsForBackend(tools, backend);

  if (backend === "local") {
    const which = pickModel(lastUserText(messages));
    const model = modelIdFor(which);
    try {
      return await localLoop({ messages, tools: toolsForModel(backendTools, which, lastUserText(messages)), systemPrompt: composed.systemPrompt, contextNote, model,
        forceFirst: which === "build", onProgress });
    } catch (e) {
      // The runner answered the probe but the loop failed mid-run (timeout, model crashed). Be HONEST — the
      // deterministic dispatcher's "No LLM is running" would be wrong.
      if (process.env.ANTHROPIC_API_KEY) return llmLoop({ messages, tools, systemPrompt });
      return {
        ok: true,
        mode: "local-error",
        model,
        transcript: [{
          role: "assistant",
          content: `Jonah's local model (${model}) didn't finish: ${String(e?.message || e)}. Try again, or break the request into a smaller step.`,
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
const IMPORT_TOOL_NAMES = new Set([
  "wikipedia_import", "wikipedia_import_batch", "import_markdown", "import_html",
]);

export async function assistantConfirm({ name, input, userId, gridId, baseUrl, apiToken }) {
  if (!gridId) throw new Error("gridId required");
  const tools = buildTools({ baseUrl, apiToken, userId, gridId });
  const tool = tools.find(t => t.name === name);
  if (!tool) return { ok: false, name, error: `unknown tool ${name}` };
  // The confirm card IS the user's approval to actually do it, so a confirmed import
  // must never be a dry run — the model sometimes passes dryRun:true to "plan", which
  // would mint nothing and leave the user with "(planned only — nothing was imported)".
  let runInput = input || {};
  if (IMPORT_TOOL_NAMES.has(name) && runInput.dryRun) runInput = { ...runInput, dryRun: false };
  try {
    const output = await tool.run(runInput);
    return { ok: true, name, input: runInput, output };
  } catch (e) {
    return { ok: false, name, input: runInput, error: String(e?.message || e) };
  }
}
