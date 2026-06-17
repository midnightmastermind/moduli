// server/__tests__/assistantAgent.test.js
//
// Covers the pure helpers added to harden the Ollama-backed assistant against
// the "… thinking" hang / placeholder-id looping:
//  - buildOllamaRequestBody — num_ctx + tool shape (Fix #1)
//  - buildDestinationsHint   — named-destination resolution (Fix #2)
//  - selectToolsForBackend   — curated offline toolset (Fix #3)
//  - summarizeGridState      — bounded grid snapshot (Fix #4)
//  - buildSystemPrompt       — location injection
import { describe, it, expect } from "vitest";
import {
  buildOllamaRequestBody,
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

describe("buildOllamaRequestBody (Fix #1 — context window)", () => {
  it("requests an explicit num_ctx so Ollama doesn't default to ~4096", () => {
    const body = buildOllamaRequestBody({ model: "m", messages: [], tools: TOOLS, numCtx: 8192, numPredict: 768 });
    expect(body.options).toEqual({ num_ctx: 8192, num_predict: 768 });
  });

  it("caps output tokens and keeps the model resident", () => {
    const body = buildOllamaRequestBody({ model: "m", messages: [], tools: [], numPredict: 512, keepAlive: "10m" });
    expect(body.options.num_predict).toBe(512);
    expect(body.keep_alive).toBe("10m");
  });

  it("defaults stream:false and maps tools to the OpenAI function shape", () => {
    const body = buildOllamaRequestBody({ model: "qwen", messages: [{ role: "user", content: "hi" }], tools: TOOLS });
    expect(body.stream).toBe(false);
    expect(body.model).toBe("qwen");
    expect(body.tools[0]).toEqual({
      type: "function",
      function: { name: "wikipedia_import", description: "import", parameters: { type: "object", properties: {} } },
    });
  });

  it("opts into streaming when stream:true (live token narration)", () => {
    expect(buildOllamaRequestBody({ model: "m", messages: [], tools: [], stream: true }).stream).toBe(true);
  });

  it("defaults num_ctx when not passed", () => {
    const body = buildOllamaRequestBody({ model: "m", messages: [], tools: [] });
    expect(body.options.num_ctx).toBeGreaterThanOrEqual(8192);
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
      { id: "occ_page", targetId: "m_page", occurrences: ["occ_slot"] },
      { id: "occ_slot", targetId: "m_slot", occurrences: ["occ_inst"] },
      { id: "occ_gen", targetId: "m_gen", parentId: "folder-tasks" },
      { id: "occ_inst", targetId: "m_inst" },
    ],
    folders: [{ id: "folder-tasks", name: "Tasks" }, { id: "bad" }],
  };

  it("derives pages and containers by joining occurrence.targetId → module", () => {
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
  it("narrows the catalog to the core allowlist for ollama", () => {
    const out = selectToolsForBackend(TOOLS, "ollama");
    const names = out.map(t => t.name);
    expect(names).toContain("wikipedia_import");
    expect(names).toContain("create_occurrence");
    expect(names).not.toContain("delete_module");
    expect(names).not.toContain("update_grid");
  });

  it("returns the full catalog for non-ollama backends", () => {
    expect(selectToolsForBackend(TOOLS, "anthropic")).toHaveLength(TOOLS.length);
    expect(selectToolsForBackend(TOOLS, "deterministic")).toHaveLength(TOOLS.length);
  });

  it("honors an explicit allowlist", () => {
    const out = selectToolsForBackend(TOOLS, "ollama", new Set(["update_grid"]));
    expect(out.map(t => t.name)).toEqual(["update_grid"]);
  });

  it("falls back to the full catalog when the allowlist matches nothing", () => {
    const out = selectToolsForBackend(TOOLS, "ollama", new Set(["nonexistent_tool"]));
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
      { id: "occ_page", targetId: "m_page" },
      ...Array.from({ length: 600 }, (_, i) => ({ id: `occ${i}`, targetId: "m_inst" })),
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

  it("derives pages by joining occurrence.targetId → page-role module", () => {
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
