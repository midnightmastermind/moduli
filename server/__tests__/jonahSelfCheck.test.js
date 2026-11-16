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
  // INVERTED 2026-11-16: a question's first turn is forced too — the 3B answered from nothing ("I'm calling
  // list_occurrences… you have 0 links", 0 of 4 known-answer questions). An explanation from the notes gets no tools,
  // and with no tools nothing is forced.
  it("a question's first turn must call a tool; with no tools nothing is forced", async () => {
    const bodies = [];
    await localLoop({ messages: [{ role: "user", content: "what is due?" }], tools: [{ name: "t", description: "d", input_schema: {}, run: async () => ({}) }], model: "fast",
      deps: { streamChat: async ({ body }) => { bodies.push(body); return { content: "x", toolCalls: [] }; } } });
    expect(bodies[0].tool_choice).toBe("required");
    const none = [];
    await localLoop({ messages: [{ role: "user", content: "how do feeds work?" }], tools: [], model: "fast",
      deps: { streamChat: async ({ body }) => { none.push(body); return { content: "x", toolCalls: [] }; } } });
    expect(none[0].tool_choice).toBeUndefined();
  });
});

describe("a page request is offered build, not the one-row creators", async () => {
  const { toolsForModel, isPageShaped } = await import("../services/assistantAgent.js");
  const tools = ["build", "create_occurrence", "create_board", "create_items", "import_url", "list_folders", "change"].map((name) => ({ name }));
  it("glossary / doc page → no create_occurrence or create_board", () => {
    expect(toolsForModel(tools, "build", "Make a doc page called Home that is a glossary").map((t) => t.name)).toEqual(["build", "import_url", "list_folders", "change"]);
  });
  it("the page list is the start of every other build request's list (the runner reuses that prefix)", () => {
    const full = toolsForModel(tools, "build", "Add my CPS classes").map((t) => t.name);
    const page = toolsForModel(tools, "build", "Make a doc page called Home").map((t) => t.name);
    expect(full.slice(0, page.length)).toEqual(page);
    expect(full).toContain("create_items");
    expect(isPageShaped("Create a board called Quick Links")).toBe(false);
  });
  it("questions still get read tools only", () => {
    expect(toolsForModel(tools, "fast", "what page is this").map((t) => t.name)).toEqual(["list_folders"]);
  });
});

describe("editing words go to the model that can edit", async () => {
  const { pickModel } = await import("../services/assistantAgent.js");
  it.each(["Undo that last change.", "Change the Mail section", "rename Mail to Email", "remove the Social section"])("%s → build", (t) => expect(pickModel(t)).toBe("build"));
  it("a question stays on the fast model", () => expect(pickModel("What's on my schedule today?")).toBe("fast"));
});

describe("the running log", async () => {
  const { describeCall, describeResult, holdForConfirm, localLoop } = await import("../services/assistantAgent.js");
  it("names what each call does", () => {
    expect(describeCall("build", { nodes: [{ page: "Home" }] })).toBe('Building "Home"');
    expect(describeCall("change", { name: "Notebook › Mail", rename: "Email" })).toBe('Changing "Notebook › Mail" — rename to "Email"');
    expect(describeCall("create_items", { container: "Tasks", items: [{}, {}] })).toBe("Adding 2 items to Tasks");
    expect(describeCall("list_folders", {})).toBe("list folders");
    expect(describeResult("list_folders", { folders: [1, 2, 3] })).toBe("found 3 folders");
    expect(describeResult("x", { error: "boom" })).toBe("failed — boom");
  });
  it("a checked build says what it found, then what it will show you", async () => {
    const said = [];
    const say = (t, st) => said.push([st, t]);
    const t = { description: "d", preview: async () => ({ problems: [], preview: { modules: [{ role: "page" }, { role: "container" }, { kind: "inline" }, { kind: "inline" }] } }) };
    await holdForConfirm({ tool: t, name: "build", input: {}, checked: new Set(), say });
    expect(said).toEqual([["run", "Checking it first (a practice run — nothing is written yet)"], ["ok", "Check passed: 1 page, 1 section, 2 links"], ["ok", "Waiting for you to approve"]]);
  });
  it("the loop sends steps as it goes", async () => {
    const steps = [];
    const tool = { name: "list_folders", description: "d", input_schema: { type: "object" }, run: async () => ({ folders: [1, 2] }) };
    const replies = [{ content: "", toolCalls: [{ id: "c1", function: { name: "list_folders", arguments: "{}" } }] }, { content: "Two.", toolCalls: [] }];
    let n = 0;
    await localLoop({ messages: [{ role: "user", content: "add a page" }], tools: [tool], model: "build",
      onProgress: (p) => { if (p.phase === "step") steps.push(p.text); }, deps: { streamChat: async () => replies[n++] } });
    expect(steps).toEqual(["Reading your request", "list folders", "list folders — found 2 folders", "Reading the result"]);
  });
});

describe("conversationOnly", async () => {
  const { conversationOnly } = await import("../services/assistantAgent.js");
  it("keeps only what was said, as text", () => {
    expect(conversationOnly([
      { role: "user", content: "make a page" }, { role: "steps", items: [] }, { role: "confirm", name: "build" },
      { role: "tool", name: "x", output: {} }, { role: "_meta", mode: "local" }, { role: "assistant", content: "" },
      { role: "assistant", content: "Done.", toolCalls: [] },
    ])).toEqual([{ role: "user", content: "make a page" }, { role: "assistant", content: "Done." }]);
  });
});

describe("listFoldersAnswer", async () => {
  const { listFoldersAnswer } = await import("../services/assistantTools.js");
  const body = { folders: [{ id: "r", name: "Root", parentId: null }, { id: "a", name: "Tasks", parentId: "r" }, { id: "b", name: "Daily", parentId: "a" }] };
  it("a made-up parent id lists every folder and says so", () => {
    const r = listFoldersAnswer(body, "folder_123");
    expect(r.folders.map((f) => f.name)).toEqual(["Root", "Tasks", "Daily"]);
    expect(r.note).toMatch(/no folder has the id/);
  });
  it("root means the top level; a real id its children; none everything with parent names", () => {
    expect(listFoldersAnswer(body, "root").folders.map((f) => f.name)).toEqual(["Tasks"]);
    expect(listFoldersAnswer(body, "a").folders).toEqual([{ id: "b", name: "Daily", parent: "Tasks" }]);
    expect(listFoldersAnswer(body).folders).toHaveLength(3);
  });
});

describe("missingFromRequest", async () => {
  const { missingFromRequest, holdForConfirm } = await import("../services/assistantAgent.js");
  const preview = { modules: [{ meta: { link: { kind: "url", url: "https://mail.google.com" } } }], occurrences: [], fields: [] };
  it("names the links the user gave that the plan left out", () => {
    expect(missingFromRequest("Gmail https://mail.google.com, GitHub https://github.com.", preview)).toEqual(["left out a link the user gave: https://github.com"]);
  });
  it("buttons asked for, none made", () => {
    expect(missingFromRequest("add a button that opens them", preview)[0]).toMatch(/asked for buttons/);
    expect(missingFromRequest("add a button", { ...preview, fields: [{ type: "button" }] })).toEqual([]);
  });
  it("a build missing what was asked goes back to the model", async () => {
    const t = { description: "d", preview: async () => ({ problems: [], preview }) };
    const r = await holdForConfirm({ tool: t, name: "build", input: {}, checked: new Set(), request: "links: https://github.com" });
    expect(r.retry).toMatch(/github\.com/);
  });
});
