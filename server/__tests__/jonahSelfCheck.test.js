// Jonah checks a build before asking you (assistantAgent.holdForConfirm + localLoop), and a build turn must call a tool.
import { describe, it, expect } from "vitest";
import { localLoop, holdForConfirm } from "../services/assistantAgent.js";

const call = (input) => ({ content: "", toolCalls: [{ id: "c1", function: { name: "build", arguments: JSON.stringify(input) } }] });
const buildTool = (previews) => {
  const seen = [];
  return { seen, tool: { name: "build", description: "d", input_schema: { type: "object" }, requires_confirm: true,
    preview: async (input) => { seen.push(input); return previews.shift(); }, run: async () => { throw new Error("must not run"); } } };
};

describe("holdForConfirm", () => {
  it("sends problems back once, then makes the card", async () => {
    const checked = new Set();
    const t = { name: "build", description: "d", preview: async () => ({ problems: ["bad"], preview: { roots: ["r"] } }) };
    const a = await holdForConfirm({ tool: t, name: "build", input: {}, checked });
    expect(a.retry).toMatch(/Nothing was made/); expect(a.problems).toEqual(["bad"]);
    const b = await holdForConfirm({ tool: t, name: "build", input: {}, checked });
    expect(b.pending).toMatchObject({ name: "build", problems: ["bad"], preview: { roots: ["r"] } });
  });
  it("a tool without a preview, or a preview that throws, is a plain card", async () => {
    expect((await holdForConfirm({ tool: { description: "d" }, name: "x", input: { a: 1 }, checked: new Set() })).pending).toEqual({ name: "x", input: { a: 1 }, description: "d" });
    const t = { description: "d", preview: async () => { throw new Error("down"); } };
    expect((await holdForConfirm({ tool: t, name: "build", input: {}, checked: new Set() })).pending.name).toBe("build");
  });
});

describe("localLoop self-check", () => {
  it("a build with problems goes back to the model, and its fixed call becomes the card", async () => {
    const b = buildTool([{ problems: ["no page named Scheduling"] }, { problems: [], preview: { roots: ["p"], modules: [], occurrences: [] } }]);
    const replies = [call({ nodes: [{ page: "G", markdown: "- [[Scheduling]]" }] }), call({ nodes: [{ page: "G", markdown: "- [[Schedule]]" }] })];
    const bodies = []; let n = 0;
    const out = await localLoop({ messages: [{ role: "user", content: "build a glossary" }], tools: [b.tool], model: "build",
      deps: { streamChat: async ({ body }) => { bodies.push(JSON.parse(JSON.stringify(body))); return replies[n++]; } } });
    expect(b.seen).toHaveLength(2);
    expect(bodies[1].messages.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c1" });
    expect(bodies[1].messages.at(-1).content).toMatch(/Scheduling/);
    expect(out.pendingConfirmations).toHaveLength(1);
    expect(out.pendingConfirmations[0].input.nodes[0].markdown).toMatch(/\[\[Schedule\]\]/);
    expect(out.pendingConfirmations[0].preview.roots).toEqual(["p"]);
    // the corrected call is forced too — the model answered in words here before
    expect(bodies[1].tool_choice).toBe("required");
  });
  it("a clean check goes straight to the card", async () => {
    const b = buildTool([{ problems: [], preview: { roots: ["p"] } }]);
    const out = await localLoop({ messages: [{ role: "user", content: "build it" }], tools: [b.tool], model: "build", deps: { streamChat: async () => call({ nodes: [] }) } });
    expect(b.seen).toHaveLength(1);
    expect(out.pendingConfirmations[0].preview.roots).toEqual(["p"]);
  });
});

describe("a build turn must call a tool", () => {
  it("the build model's first turn asks for tool_choice required, later turns do not", async () => {
    const tool = { name: "list_folders", description: "d", input_schema: { type: "object" }, run: async () => ({ ok: true }) };
    const replies = [{ content: "", toolCalls: [{ id: "c1", function: { name: "list_folders", arguments: "{}" } }] }, { content: "Done.", toolCalls: [] }];
    const bodies = []; let n = 0;
    await localLoop({ messages: [{ role: "user", content: "build me a page" }], tools: [tool], model: "build",
      deps: { streamChat: async ({ body }) => { bodies.push(body); return replies[n++]; } } });
    expect(bodies[0].tool_choice).toBe("required");
    expect(bodies[1].tool_choice).toBeUndefined();
  });
  it("the fast model is never forced", async () => {
    const bodies = [];
    await localLoop({ messages: [{ role: "user", content: "what is due?" }], tools: [{ name: "t", description: "d", input_schema: {}, run: async () => ({}) }], model: "fast",
      deps: { streamChat: async ({ body }) => { bodies.push(body); return { content: "x", toolCalls: [] }; } } });
    expect(bodies[0].tool_choice).toBeUndefined();
  });
});

describe("a page request is offered build, not the one-row creators", async () => {
  const { toolsForModel, isPageShaped } = await import("../services/assistantAgent.js");
  const tools = ["build", "create_occurrence", "create_board", "create_items", "import_url", "list_folders", "change"].map((name) => ({ name }));
  it("glossary / doc page → no create_occurrence or create_board", () => {
    const names = toolsForModel(tools, "build", "Make a doc page called Home that is a glossary").map((t) => t.name);
    expect(names).toEqual(["build", "import_url", "list_folders", "change"]);
  });
  it("a board request, CPS rows, and a link import keep what they need", () => {
    expect(isPageShaped("Create a board called Quick Links")).toBe(false);
    expect(isPageShaped("Add my CPS classes to Tasks › Appointments")).toBe(false);
    expect(toolsForModel(tools, "build", "make a page from this link https://x.io").map((t) => t.name)).toContain("import_url");
    expect(toolsForModel(tools, "build", "Add my CPS classes").map((t) => t.name)).toContain("create_items");
  });
  it("questions still get read tools only", () => {
    expect(toolsForModel(tools, "fast", "what page is this").map((t) => t.name)).toEqual(["list_folders"]);
  });
});
