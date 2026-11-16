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
    expect(toolsForModel(tools, "build", "Make a doc page called Home that is a glossary").map((t) => t.name)).toEqual(["build", "import_url", "list_folders"]);   // no change: nothing to edit (2026-11-16)
  });
  it("the page list is the start of every other build request's list (the runner reuses that prefix)", () => {
    const full = toolsForModel(tools, "build", "Add my CPS classes").map((t) => t.name);
    const page = toolsForModel(tools, "build", "Make a doc page called Home").map((t) => t.name);
    expect(full.slice(0, page.length)).toEqual(page);
    const pageEdit = toolsForModel(tools, "build", "rename the Mail section on my Home page").map((t) => t.name);
    expect(full.slice(0, pageEdit.length)).toEqual(pageEdit);
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

describe("a question about your own things goes to the grid, not the notes", async () => {
  const { notesTopicFor } = await import("../services/assistantAgent.js");
  it.each(["What links are on my Eval Notebook page?", "What's on my schedule today?", "How many books do I have on the board?"])("%s → no notes", (q) => expect(notesTopicFor(q)).toBe(null));
  it("how Moduli works still reads the notes", () => expect(notesTopicFor("How do feeds work in Moduli?")).toBeTruthy());
});

describe("the grid's answer in plain words", async () => {
  const { formatLookup, answerUsesLookup, localLoop } = await import("../services/assistantAgent.js");
  const r = { name: "Eval Notebook", path: "Eval Notebook", kind: "page doc", count: 0, items: [], sections: [{ name: "Mail" }, { name: "Social" }],
    links: [{ label: "Gmail", url: "https://mail.google.com" }, { label: "Facebook", url: "https://www.facebook.com" }] };
  it("says the links, items and sections", () => {
    expect(formatLookup(r)).toBe("**Eval Notebook** (page doc)\n- 2 links: Gmail (mail.google.com), Facebook (facebook.com)\n- 2 sections: Mail, Social");
    expect(answerUsesLookup("The tool call was successful.", r)).toBe(false);
    expect(answerUsesLookup("You have Gmail and Facebook.", r)).toBe(true);
  });
  it("an answer that ignores the lookup is replaced by it; one that uses it is left alone", async () => {
    const tool = { name: "look_up", description: "d", input_schema: { type: "object" }, run: async () => r };
    for (const [reply, expectAdded] of [["This output confirms that the tool call was successful.", true], ["Your page links Gmail and Facebook.", false]]) {
      const replies = [{ content: "", toolCalls: [{ id: "c1", function: { name: "look_up", arguments: '{"name":"Eval Notebook"}' } }] }, { content: reply, toolCalls: [] }];
      let n = 0;
      const out = await localLoop({ messages: [{ role: "user", content: "what links are on my page?" }], tools: [tool], model: "fast", deps: { streamChat: async () => replies[n++] } });
      const last = out.transcript.at(-1).content;
      expect(last.includes("Gmail (mail.google.com)")).toBe(expectAdded);
      expect(last.startsWith(reply)).toBe(!expectAdded);   // an answer that ignores the lookup is replaced, not kept
    }
  });
});

describe("the selection reaches Jonah", async () => {
  const { buildSelectionHint, buildLocationHint } = await import("../services/assistantAgent.js");
  it("lists the selected items with their ids", () => {
    const h = buildSelectionHint({ selection: [{ id: "a", label: "Clean", path: "Tasks › Todo" }, { id: "b", label: "Book a massage" }] });
    expect(h).toMatch(/"these" \/ "this" \/ "them" \/ "the selected" mean exactly these 2/);
    expect(h).toMatch(/1\. Clean \(in Tasks › Todo\) id:a/);
    expect(h).toMatch(/2\. Book a massage id:b/);
  });
  it("rides with the location note, and alone when there is no location", () => {
    expect(buildLocationHint({ id: "p", label: "Tasks", selection: [{ id: "a", label: "Clean" }] })).toMatch(/CURRENT LOCATION[\s\S]*SELECTED/);
    expect(buildLocationHint({ selection: [{ id: "a", label: "Clean" }] })).toMatch(/SELECTED/);
    expect(buildSelectionHint({})).toBe("");
  });
});

describe("a request to MAKE a page is not offered the edit tools (2026-11-16)", async () => {
  const { toolsForModel } = await import("../services/assistantAgent.js");
  const T = ["build", "change", "remove", "undo", "create_items", "look_up"].map((name) => ({ name }));
  it("make a page → build, no change/remove/undo", () => {
    expect(toolsForModel(T, "build", "Make a doc page called Home with sections").map((t) => t.name)).toEqual(["build", "look_up"]);
  });
  it("an edit of a page keeps them", () => {
    expect(toolsForModel(T, "build", "rename the Mail section on my Home page").map((t) => t.name)).toEqual(expect.arrayContaining(["change", "remove", "undo"]));
    expect(toolsForModel(T, "build", "undo that page").map((t) => t.name)).toContain("undo");
  });
});

describe("an automation is checked against the request (2026-11-16)", async () => {
  const { automationAgainstRequest } = await import("../services/assistantAgent.js");
  it("days the request never named are sent back", () => {
    expect(automationAgainstRequest("Remind me every day at 2pm to drink water", { when: { at: "2pm", days: "weekdays" } })).toHaveLength(1);
    expect(automationAgainstRequest("Remind me every day at 2pm", { when: { at: "2pm", days: ["Mon"] } })).toHaveLength(1);
  });
  it("named days, or none at all, pass", () => {
    expect(automationAgainstRequest("every weekday at 9am", { when: { at: "9am", days: "weekdays" } })).toEqual([]);
    expect(automationAgainstRequest("on Mondays at 9", { when: { at: "9am", days: ["Mon"] } })).toEqual([]);
    expect(automationAgainstRequest("every day at 2pm", { when: { at: "2pm" } })).toEqual([]);
  });
});

describe("which requests are automations (2026-11-16)", async () => {
  const { isAutomationShaped } = await import("../services/assistantAgent.js");
  it("reminders and whenevers are; a dated batch is not", () => {
    expect(isAutomationShaped("Remind me every day at 2pm to drink water")).toBe(true);
    expect(isAutomationShaped("Whenever I tick Completed, stamp the date")).toBe(true);
    expect(isAutomationShaped("Add my CPS classes: every Monday, Tuesday, Wednesday and Thursday in November 2026")).toBe(false);
  });
});
