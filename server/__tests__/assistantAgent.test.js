// server/__tests__/assistantAgent.test.js
//
// Covers the pure helpers added to harden the locally-backed assistant against
// the "… thinking" hang / placeholder-id looping:
//  - pickModel / composeSystemParts / localLoop — the local runner (local LLM plan, Task 3)
//  - buildDestinationsHint   — named-destination resolution (Fix #2)
//  - selectToolsForBackend   — curated offline toolset (Fix #3)
//  - summarizeGridState      — bounded grid snapshot (Fix #4)
//  - buildSystemPrompt       — location injection
import { describe, it, expect } from "vitest";
import {
  assistantChat,
  summarizeHttpError,
  buildLocationHint,
  toolResultForModel,
  pickModel,
  composeSystemParts,
  buildLocalMessages,
  localLoop,
  buildDestinationsHint,
  extractDestinations,
  selectToolsForBackend,
  buildSystemPrompt,
  parseContentToolCall,
  assistantConfirm,
} from "../services/assistantAgent.js";
import { summarizeGridState } from "../services/assistantTools.js";

const TOOLS = [
  { name: "wikipedia_import", description: "import", input_schema: { type: "object", properties: {} } },
  { name: "create_occurrence", description: "create", input_schema: { type: "object", properties: {} } },
  { name: "delete_module", description: "delete", input_schema: { type: "object", properties: {} } },
  { name: "update_grid", description: "patch grid", input_schema: { type: "object", properties: {} } },
];

describe("pickModel — builds go to the build model", () => {
  it("sends a build to the build model", () => {
    expect(pickModel("make a board of my quick links")).toBe("build");
    expect(pickModel("add CPS classes Mon-Thu in November")).toBe("build");
  });
  it("sends a question to the fast model", () => {
    expect(pickModel("what's on my schedule today?")).toBe("fast");
    expect(pickModel("")).toBe("fast");
  });
});

describe("the fixed prompt stays the same between requests", () => {
  const A = { folders: [{ id: "f1", name: "Examples" }] };
  const B = { folders: [{ id: "f2", name: "Projects" }] };
  it("the system prompt is identical across pages and days", () => {
    const one = composeSystemParts({ destinations: A, context: { id: "x", label: "X" }, today: new Date("2026-11-15T12:00:00Z") });
    const two = composeSystemParts({ destinations: B, context: { id: "y", label: "Y" }, today: new Date("2026-11-16T12:00:00Z") });
    expect(one.systemPrompt).toBe(two.systemPrompt);
    expect(one.contextNote).not.toBe(two.contextNote);
    expect(one.contextNote).toContain("x");
    expect(one.contextNote).toContain("2026-11-15");
  });
  it("the per-request note goes just before the newest user message", () => {
    const msgs = buildLocalMessages({
      systemPrompt: "SYS", contextNote: "NOTE",
      messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }, { role: "user", content: "c" }],
    });
    expect(msgs.map((m) => m.content)).toEqual(["SYS", "a", "b", "NOTE", "c"]);
  });
});

describe("localLoop", () => {
  const recorder = () => {
    const calls = [];
    return { calls, tool: { name: "create_items", description: "d", input_schema: { type: "object" }, run: async (input) => { calls.push(input); return { ok: true }; } } };
  };
  it("recovers a tool call written as text", async () => {
    const r = recorder();
    const replies = [
      { content: '{"name":"create_items","arguments":{"container":"Tasks › Appointments","items":[]}}', toolCalls: [] },
      { content: "Done.", toolCalls: [] },
    ];
    let n = 0;
    const out = await localLoop({ messages: [{ role: "user", content: "add classes" }], tools: [r.tool], deps: { streamChat: async () => replies[n++] } });
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].container).toBe("Tasks › Appointments");
    expect(out.mode).toBe("local");
    expect(out.transcript.at(-1).content).toBe("Done.");
  });
  it("sends tool results with tool_call_id", async () => {
    const r = recorder();
    const bodies = [];
    const replies = [
      { content: "", toolCalls: [{ id: "c1", function: { name: "create_items", arguments: "{\"container\":\"X\",\"items\":[]}" } }] },
      { content: "ok", toolCalls: [] },
    ];
    let n = 0;
    await localLoop({ messages: [{ role: "user", content: "add" }], tools: [r.tool], deps: { streamChat: async ({ body }) => { bodies.push(JSON.parse(JSON.stringify(body))); return replies[n++]; } } });
    const second = bodies[1].messages;
    expect(second.find((m) => m.role === "assistant").tool_calls[0]).toEqual({ id: "c1", type: "function", function: { name: "create_items", arguments: "{\"container\":\"X\",\"items\":[]}" } });
    expect(second.find((m) => m.role === "tool")).toMatchObject({ role: "tool", tool_call_id: "c1" });
  });
  it("routes by the newest user message", async () => {
    const seen = [];
    await localLoop({ messages: [{ role: "user", content: "what is due today?" }], tools: [], deps: { streamChat: async ({ body }) => { seen.push(body.model); return { content: "x", toolCalls: [] }; } } });
    await localLoop({ messages: [{ role: "user", content: "create a page" }], tools: [], deps: { streamChat: async ({ body }) => { seen.push(body.model); return { content: "x", toolCalls: [] }; } } });
    expect(seen).toEqual(["fast", "build"]);
  });
});

describe("buildDestinationsHint (Fix #2 — named places: folders/pages/containers)", () => {
  it("lists folders with their id as parentId", () => {
    const hint = buildDestinationsHint({ folders: [{ id: "f1", name: "Examples" }, { id: "f2", name: "Projects" }] });
    expect(hint).toContain('"Examples" (folder, parentId: f1)');
    expect(hint).toContain('"Projects" (folder, parentId: f2)');
    expect(hint).toContain("do NOT invent an id");
  });

  it("includes pages and containers (with a parent breadcrumb) so you can place anywhere", () => {
    const hint = buildDestinationsHint({
      folders: [],
      pages: [{ id: "p1", label: "Schedule" }],
      containers: [{ id: "c1", label: "6:30pm", parent: "Schedule" }, { id: "c2", label: "General", parent: null }],
    });
    expect(hint).toContain('"Schedule" (page, parentId: p1)');
    expect(hint).toContain('"6:30pm" in "Schedule" (container, parentId: c1)');
    expect(hint).toContain('"General" (container, parentId: c2)');
  });

  it("collapses duplicate label@parent container lines", () => {
    const containers = [
      { id: "a", label: "6:30pm", parent: "Schedule" },
      { id: "b", label: "6:30pm", parent: "Schedule" },
    ];
    const hint = buildDestinationsHint({ containers });
    expect(hint.match(/6:30pm/g)).toHaveLength(1);
  });

  it("returns empty string when there is nothing to list", () => {
    expect(buildDestinationsHint({ folders: [], pages: [], containers: [] })).toBe("");
    expect(buildDestinationsHint()).toBe("");
  });

  it("caps at the limit and notes there are more", () => {
    const folders = Array.from({ length: 200 }, (_, i) => ({ id: `f${i}`, name: `F${i}` }));
    const hint = buildDestinationsHint({ folders }, { limit: 5 });
    expect(hint.match(/folder, parentId/g)).toHaveLength(5);
    expect(hint).toContain("and more");
  });
});

describe("extractDestinations (join state → named places)", () => {
  const state = {
    modules: [
      { id: "m_page", role: "page", label: "Schedule" },
      { id: "m_slot", role: "container", label: "6:30pm" },
      { id: "m_gen", role: "container", label: "General" },
      { id: "m_inst", role: "instance", label: "Drink Water" },
    ],
    occurrences: [
      { id: "occ_page", moduleId: "m_page", occurrences: ["occ_slot"] },
      { id: "occ_slot", moduleId: "m_slot", occurrences: ["occ_inst"] },
      { id: "occ_gen", moduleId: "m_gen", parentId: "folder-tasks" },
      { id: "occ_inst", moduleId: "m_inst" },
    ],
    folders: [{ id: "folder-tasks", name: "Tasks" }, { id: "bad" }],
  };

  it("derives pages and containers by joining occurrence.moduleId → module", () => {
    const d = extractDestinations(state);
    expect(d.pages).toEqual([{ id: "occ_page", label: "Schedule" }]);
    expect(d.containers).toContainEqual({ id: "occ_slot", label: "6:30pm", parent: "Schedule" });
    expect(d.containers).toContainEqual({ id: "occ_gen", label: "General", parent: "Tasks" });
  });

  it("resolves a container's parent via the occurrences[] reverse map and via folders", () => {
    const d = extractDestinations(state);
    const slot = d.containers.find(c => c.id === "occ_slot");
    expect(slot.parent).toBe("Schedule");          // via occurrences[] reverse map
    const gen = d.containers.find(c => c.id === "occ_gen");
    expect(gen.parent).toBe("Tasks");              // via parentId → folder name
  });

  it("filters malformed folders and is shape-safe on empty input", () => {
    expect(extractDestinations(state).folders).toEqual([{ id: "folder-tasks", name: "Tasks" }]);
    expect(extractDestinations({})).toEqual({ folders: [], pages: [], containers: [] });
  });
});

describe("selectToolsForBackend (Fix #3 — curated offline toolset)", () => {
  it("narrows the catalog to the core allowlist for the local backend", () => {
    const out = selectToolsForBackend(TOOLS, "local");
    const names = out.map(t => t.name);
    expect(names).toContain("wikipedia_import");
    expect(names).toContain("create_occurrence");
    expect(names).not.toContain("delete_module");
    expect(names).not.toContain("update_grid");
  });

  it("returns the full catalog for non-local backends", () => {
    expect(selectToolsForBackend(TOOLS, "anthropic")).toHaveLength(TOOLS.length);
    expect(selectToolsForBackend(TOOLS, "deterministic")).toHaveLength(TOOLS.length);
  });

  it("honors an explicit allowlist", () => {
    const out = selectToolsForBackend(TOOLS, "local", new Set(["update_grid"]));
    expect(out.map(t => t.name)).toEqual(["update_grid"]);
  });

  it("falls back to the full catalog when the allowlist matches nothing", () => {
    const out = selectToolsForBackend(TOOLS, "local", new Set(["nonexistent_tool"]));
    expect(out).toHaveLength(TOOLS.length);
  });
});

describe("summarizeGridState (Fix #4 — bounded snapshot)", () => {
  const state = {
    grid: { id: "g1", name: "Live", rows: 2, cols: 3, activeFilterId: "filter_daily", extra: "drop me" },
    modules: [
      { id: "m_page", role: "page", label: "Examples" },
      { id: "m_inst", role: "instance", label: "Drink Water" },
    ],
    occurrences: [
      { id: "occ_page", moduleId: "m_page" },
      ...Array.from({ length: 600 }, (_, i) => ({ id: `occ${i}`, moduleId: "m_inst" })),
    ],
    fields: [{ id: "fld1", name: "water", type: "number" }],
    operations: [{ id: "op1", name: "Tracker: Water" }],
    folders: [{ id: "f1", name: "Examples" }],
  };

  it("returns counts instead of dumping every occurrence", () => {
    const s = summarizeGridState(state);
    expect(s.counts.occurrences).toBe(601);
    expect(JSON.stringify(s).length).toBeLessThan(2000);
  });

  it("derives pages by joining occurrence.moduleId → page-role module", () => {
    const s = summarizeGridState(state);
    expect(s.pages).toEqual([{ id: "occ_page", label: "Examples" }]);
    expect(s.counts.pages).toBe(1);
  });

  it("projects folders/fields/operations to id+name and trims the grid object", () => {
    const s = summarizeGridState(state);
    expect(s.folders).toEqual([{ id: "f1", name: "Examples" }]);
    expect(s.fields).toEqual([{ id: "fld1", name: "water", type: "number" }]);
    expect(s.operations).toEqual([{ id: "op1", name: "Tracker: Water" }]);
    expect(s.grid).toEqual({ id: "g1", name: "Live", rows: 2, cols: 3, activeFilterId: "filter_daily" });
  });

  it("is null/shape-safe on empty input", () => {
    const s = summarizeGridState({});
    expect(s.counts.occurrences).toBe(0);
    expect(s.grid).toBeNull();
  });
});

describe("parseContentToolCall (recover content-channel tool calls)", () => {
  const known = new Set(["wikipedia_import", "create_occurrence"]);

  it("recovers the exact blob qwen emitted in the smoke test", () => {
    const content = '{\n  "name": "wikipedia_import",\n  "arguments": {\n    "parentId": "folder-examples-REAL-123",\n    "query": "eminem"\n  }\n}';
    expect(parseContentToolCall(content, known)).toEqual({
      name: "wikipedia_import",
      arguments: { parentId: "folder-examples-REAL-123", query: "eminem" },
    });
  });

  it("handles a ```json fenced block with surrounding prose", () => {
    const content = 'Certainly, sir.\n```json\n{"name":"wikipedia_import","arguments":{"title":"Eminem"}}\n```\nDone.';
    expect(parseContentToolCall(content, known)).toEqual({ name: "wikipedia_import", arguments: { title: "Eminem" } });
  });

  it("parses arguments delivered as a JSON string", () => {
    const content = '{"name":"create_occurrence","arguments":"{\\"moduleId\\":\\"m1\\"}"}';
    expect(parseContentToolCall(content, known)).toEqual({ name: "create_occurrence", arguments: { moduleId: "m1" } });
  });

  it("unwraps OpenAI-style tool_calls and function envelopes", () => {
    expect(parseContentToolCall('{"tool_calls":[{"function":{"name":"wikipedia_import","arguments":{"query":"x"}}}]}', known))
      .toEqual({ name: "wikipedia_import", arguments: { query: "x" } });
    expect(parseContentToolCall('{"function":{"name":"create_occurrence","arguments":{}}}', known))
      .toEqual({ name: "create_occurrence", arguments: {} });
  });

  it("does NOT match unknown tool names (guards against random prose JSON)", () => {
    expect(parseContentToolCall('{"name":"not_a_tool","arguments":{}}', known)).toBeNull();
  });

  it("returns null for plain prose / empty / non-string", () => {
    expect(parseContentToolCall("Hello, how may I help?", known)).toBeNull();
    expect(parseContentToolCall("", known)).toBeNull();
    expect(parseContentToolCall(null, known)).toBeNull();
  });

  it("recovers without a name guard when toolNames is omitted", () => {
    expect(parseContentToolCall('{"name":"anything","arguments":{"a":1}}')).toEqual({ name: "anything", arguments: { a: 1 } });
  });
});

describe("buildSystemPrompt (location injection)", () => {
  it("appends the current location id when context is provided", () => {
    const p = buildSystemPrompt({ id: "occ9", label: "Examples", type: "folder" });
    expect(p).toContain("occ9");
    expect(p).toContain("folder");
  });

  it("returns the base prompt unchanged when no context", () => {
    expect(buildSystemPrompt(null)).not.toContain("CURRENT LOCATION");
  });
});

describe("assistantConfirm (a confirmed import never runs as a dry run)", () => {
  it("forces dryRun:false on an import tool even when the model passed dryRun:true", async () => {
    const calls = [];
    const realFetch = global.fetch;
    global.fetch = async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return { status: 200, text: async () => JSON.stringify({ rootOccurrenceId: "occ1", dryRun: false }) };
    };
    try {
      const r = await assistantConfirm({
        name: "wikipedia_import",
        input: { query: "Eminem", dryRun: true },
        userId: "u", gridId: "g", baseUrl: "http://x", apiToken: "t",
      });
      expect(r.ok).toBe(true);
      expect(r.input.dryRun).toBe(false);          // overridden on the returned input
      const importCall = calls.find(c => String(c.url).includes("/research/wikipedia/import"));
      expect(importCall).toBeTruthy();
      expect(importCall.body.dryRun).toBe(false);   // and on the wire to the route
    } finally {
      global.fetch = realFetch;
    }
  });

  it("leaves a non-dry-run import untouched", async () => {
    const calls = [];
    const realFetch = global.fetch;
    global.fetch = async (url, init) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body) : null });
      return { status: 200, text: async () => JSON.stringify({ rootOccurrenceId: "occ2" }) };
    };
    try {
      const r = await assistantConfirm({
        name: "wikipedia_import",
        input: { query: "Eminem" },
        userId: "u", gridId: "g", baseUrl: "http://x", apiToken: "t",
      });
      expect(r.ok).toBe(true);
      const importCall = calls.find(c => String(c.url).includes("/research/wikipedia/import"));
      expect(importCall.body.dryRun).toBeFalsy();
    } finally {
      global.fetch = realFetch;
    }
  });
});

// Cloudflare cuts a request off at ~100s when the runner has not answered. Measured on prod: the
// real chat 524'd at 125s, the same request again took 18s (the runner had kept
// the prompt it read). So a gateway timeout is retried, and its HTML error page is
// reported as one line, never pasted into the chat.
describe("a gateway timeout in front of the local runner", () => {
  const CF_PAGE = `<!DOCTYPE html><html><head><title>viafluere.com | 524: A timeout occurred</title></head><body><h1>Error code 524</h1>${"x".repeat(5000)}</body></html>`;
  const okStream = `data: ${JSON.stringify({ choices: [{ delta: { content: "Here are a few." } }] })}\n\ndata: [DONE]\n\n`;

  async function chatWith(chatResponses) {
    const realFetch = global.fetch;
    const prevBackend = process.env.ASSISTANT_BACKEND;
    process.env.ASSISTANT_BACKEND = "local";
    let chatCalls = 0;
    global.fetch = async (url) => {
      if (String(url).includes("/v1/chat/completions")) {
        const r = chatResponses[Math.min(chatCalls++, chatResponses.length - 1)];
        return new Response(r.body, { status: r.status });
      }
      return new Response(JSON.stringify({ modules: [], occurrences: [], folders: [] }), { status: 200 });
    };
    try {
      const out = await assistantChat({ messages: [{ role: "user", content: "hi" }], gridId: "g1", baseUrl: "http://x", apiToken: "t" });
      return { out, chatCalls };
    } finally {
      global.fetch = realFetch;
      if (prevBackend === undefined) delete process.env.ASSISTANT_BACKEND; else process.env.ASSISTANT_BACKEND = prevBackend;
    }
  }

  it("asks again after a 524 and returns the answer", async () => {
    const { out, chatCalls } = await chatWith([{ status: 524, body: CF_PAGE }, { status: 200, body: okStream }]);
    expect(chatCalls).toBe(2);
    expect(out.mode).toBe("local");
    expect(out.transcript.at(-1).content).toBe("Here are a few.");
  });

  it("reports a gateway that keeps failing in one line, without the page", async () => {
    const { out } = await chatWith([{ status: 524, body: CF_PAGE }]);
    expect(out.mode).toBe("local-error");
    const text = out.transcript[0].content;
    expect(text).toContain("524: A timeout occurred");
    expect(text).not.toContain("<");
    expect(text.length).toBeLessThan(400);
  });

  it("does not retry an error that is not a timeout", async () => {
    const { out, chatCalls } = await chatWith([{ status: 400, body: "model not found" }]);
    expect(chatCalls).toBe(1);
    expect(out.transcript[0].content).toContain("model not found");
  });

  it("summarizeHttpError reads a page's title and trims plain text", () => {
    expect(summarizeHttpError(CF_PAGE)).toBe("viafluere.com | 524: A timeout occurred");
    expect(summarizeHttpError("plain failure")).toBe("plain failure");
    expect(summarizeHttpError("y".repeat(500)).length).toBeLessThanOrEqual(201);
  });
});

describe("the per-page location goes last in the prompt", () => {
  it("buildLocationHint is empty without a location and names it with one", () => {
    expect(buildLocationHint(null)).toBe("");
    expect(buildLocationHint({ id: "p1", label: "Tasks" })).toContain('"Tasks"');
  });
});

describe("toolResultForModel — what the model is shown of a tool result", () => {
  const op = (i) => ({ id: `op${i}`, name: `Op ${i}`, enabled: true, pipeline: { steps: Array(40).fill({ type: "action", config: { type: "FIND", predicate: { rules: [{ left: "id", right: "x".repeat(40) }] } } }) } });
  it("passes a small result through unchanged", () => {
    expect(toolResultForModel({ ok: true, id: "a" })).toBe('{"ok":true,"id":"a"}');
  });
  it("keeps each record's identifying keys when a list is long", () => {
    const text = toolResultForModel({ operations: Array.from({ length: 30 }, (_, i) => op(i)) });
    expect(text.length).toBeLessThanOrEqual(6000);
    const parsed = JSON.parse(text);
    expect(parsed.operations).toHaveLength(30);
    expect(parsed.operations[3]).toEqual({ id: "op3", name: "Op 3", enabled: true });
  });
  it("cuts what is still too long and says so", () => {
    const text = toolResultForModel({ operations: Array.from({ length: 400 }, (_, i) => op(i)) });
    expect(text.length).toBeLessThan(6200);
    expect(text).toMatch(/cut: the full result is \d+ characters/);
  });
});

// The PC asleep or the tunnel down: the probe must give up in well under a second
// and Jonah must fall to the no-model dispatcher, not hang for the 300s budget.
describe("an unreachable local runner", () => {
  it("answers fast without a model", async () => {
    const realFetch = global.fetch;
    const prev = { b: process.env.ASSISTANT_BACKEND, k: process.env.ANTHROPIC_API_KEY };
    delete process.env.ASSISTANT_BACKEND; delete process.env.ANTHROPIC_API_KEY;
    global.fetch = (url, init) => {
      if (String(url).includes("/v1/models")) return new Promise((_, rej) => init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))));
      return Promise.resolve(new Response(JSON.stringify({ modules: [], occurrences: [], folders: [] }), { status: 200 }));
    };
    const t0 = Date.now();
    try {
      const out = await assistantChat({ messages: [{ role: "user", content: "hello" }], gridId: "g1", baseUrl: "http://x", apiToken: "t" });
      expect(out.mode).toBe("deterministic");
      expect(Date.now() - t0).toBeLessThan(2000);
    } finally {
      global.fetch = realFetch;
      if (prev.b !== undefined) process.env.ASSISTANT_BACKEND = prev.b;
      if (prev.k !== undefined) process.env.ANTHROPIC_API_KEY = prev.k;
    }
  });
});
