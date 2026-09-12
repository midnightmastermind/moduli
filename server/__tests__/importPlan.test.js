import { describe, it, expect, vi, beforeEach } from "vitest";

// Mongoose models are mocked so a WRITE is OBSERVABLE: if `import_plan` ever
// starts persisting, insertMany fires and the test says so. That is the whole
// point of this file — the handler's value is what it does NOT do.
const insertManyModule = vi.fn();
const insertManyOccurrence = vi.fn();
const findOneAndUpdate = vi.fn();

vi.mock("../models/Module.js", () => ({
  default: { insertMany: (...a) => insertManyModule(...a) },
}));
vi.mock("../models/Occurrence.js", () => ({
  default: {
    insertMany: (...a) => insertManyOccurrence(...a),
    findOneAndUpdate: (...a) => findOneAndUpdate(...a),
  },
}));

const { registerImportHandlers } = await import("../socketHandlers/import.js");
const { markdownToReaderDoc } = await import("../services/markdownImporter.js");

const MARKDOWN = [
  "# An Article",
  "",
  "Some **bold** prose with a [link](https://example.com/a).",
  "",
  "## A Section",
  "",
  "More prose underneath it.",
].join("\n");

function harness() {
  const handlers = {};
  const emitted = [];
  const socket = {
    userId: "user-1",
    on: (evt, fn) => { handlers[evt] = fn; },
    emit: (evt, payload) => emitted.push({ evt, payload }),
  };
  const ioEmitted = [];
  const io = { to: () => ({ emit: (evt, payload) => ioEmitted.push({ evt, payload }) }) };
  registerImportHandlers(socket, { io, getUC: async () => ({}), userRoom: (u) => `user:${u}` });
  return { handlers, emitted, ioEmitted, socket };
}

beforeEach(() => {
  insertManyModule.mockClear();
  insertManyOccurrence.mockClear();
  findOneAndUpdate.mockClear();
});

describe("import_plan", () => {
  it("plans a tree from markdown", async () => {
    const { handlers } = harness();
    const out = await new Promise((res) =>
      handlers.import_plan({ content: MARKDOWN, gridId: "g1", requestId: "r1" }, res));

    expect(out.ok).toBe(true);
    expect(out.rootOccurrenceId).toBeTruthy();
    expect(out.occurrences.length).toBeGreaterThan(1);
    expect(out.modules.length).toBeGreaterThan(1);
    // The root must be IN the plan, or the client renders an empty box.
    expect(out.occurrences.some((o) => o.id === out.rootOccurrenceId)).toBe(true);
  });

  it("produces the containers/textblocks the importer produces — the point of the feature", async () => {
    const { handlers } = harness();
    const out = await new Promise((res) =>
      handlers.import_plan({ content: MARKDOWN, gridId: "g1" }, res));

    const roles = new Set(out.modules.map((m) => m.role));
    expect(roles.has("container")).toBe(true);
    expect(roles.has("textblock")).toBe(true);
  });

  // THE LOAD-BEARING TEST. Reading a page must not mint rows: measured at an
  // average of 299 occurrences per page read against a 21,415-row grid.
  it("WRITES NOTHING — no Mongo, no parent $push", async () => {
    const { handlers } = harness();
    await new Promise((res) => handlers.import_plan({ content: MARKDOWN, gridId: "g1" }, res));

    expect(insertManyModule).not.toHaveBeenCalled();
    expect(insertManyOccurrence).not.toHaveBeenCalled();
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  // An `occurrence_created` here would fold phantom rows into every open tab's
  // store — the 2026-08-04 dangling-child-ref class handed a megaphone.
  it("BROADCASTS NOTHING — only its own correlated reply", async () => {
    const { handlers, emitted, ioEmitted } = harness();
    await new Promise((res) =>
      handlers.import_plan({ content: MARKDOWN, gridId: "g1", requestId: "r9" }, res));

    expect(ioEmitted).toHaveLength(0);
    expect(emitted.map((e) => e.evt)).toEqual(["import_plan_result"]);
    expect(emitted[0].payload.requestId).toBe("r9");
  });

  it("refuses empty content and an unauthenticated socket", async () => {
    const { handlers } = harness();
    const empty = await new Promise((res) => handlers.import_plan({ content: "   ", gridId: "g1" }, res));
    expect(empty.ok).toBe(false);

    const h2 = harness();
    h2.socket.userId = null;
    // re-register against the now-unauthenticated socket
    registerImportHandlers(h2.socket, { io: { to: () => ({ emit: () => {} }) }, getUC: async () => ({}), userRoom: () => "r" });
    const anon = await new Promise((res) => h2.handlers.import_plan({ content: MARKDOWN, gridId: "g1" }, res));
    expect(anon.ok).toBe(false);
  });

  // gridId is stamped onto planned rows so they look ordinary to the renderers;
  // it is NOT authorization, because nothing is written. Refusing without one
  // would make the reader fail on a surface that never needed a grid.
  it("plans without a gridId rather than refusing", async () => {
    const { handlers } = harness();
    const out = await new Promise((res) => handlers.import_plan({ content: MARKDOWN }, res));
    expect(out.ok).toBe(true);
  });
});

// User, 2026-09-12: "the reader shows one container and one textblock for the
// entire articles. magic makes them the way i just had you do it".
describe("import_plan shape", () => {
  const plan = (payload) => {
    const { handlers } = harness();
    return new Promise((res) => handlers.import_plan({ content: MARKDOWN, gridId: "g1", ...payload }, res));
  };

  it("READER is exactly one container embedding one textblock", async () => {
    const out = await plan({ shape: "reader" });
    expect(out.ok).toBe(true);
    expect(out.modules.map((m) => `${m.role}/${m.kind}`).sort()).toEqual(["container/doc", "textblock/doc"]);
    expect(out.occurrences).toHaveLength(2);

    const root = out.occurrences.find((o) => o.id === out.rootOccurrenceId);
    const tb = out.occurrences.find((o) => o.id !== out.rootOccurrenceId);
    // Listed AND embedded — a doc container renders its textmap, so a listed-only
    // child is present in the data and invisible on screen.
    expect(root.occurrences).toEqual([tb.id]);
    expect(root.textmap.content).toEqual([{ type: "moduleEmbed", attrs: { occurrenceId: tb.id } }]);
    // The leading H1 is the container's label, not a duplicate line in the body.
    expect(out.modules.find((m) => m.role === "container").label).toBe("An Article");
  });

  it("READER keeps the whole article inside that one textblock, links as marks", async () => {
    const out = await plan({ shape: "reader" });
    const tb = out.occurrences.find((o) => o.id !== out.rootOccurrenceId);
    const json = JSON.stringify(tb.textmap);
    expect(json).toContain("A Section");
    expect(json).toContain("More prose underneath it.");
    expect(json).toContain('"type":"link"');
    // No chips: a link chip IS an occurrence, and this shape has exactly two.
    expect(json).not.toContain("instanceTextblockInline");
  });

  it("READER writes and broadcasts nothing either", async () => {
    const { handlers, emitted, ioEmitted } = harness();
    await new Promise((res) => handlers.import_plan({ content: MARKDOWN, shape: "reader" }, res));
    expect(insertManyModule).not.toHaveBeenCalled();
    expect(insertManyOccurrence).not.toHaveBeenCalled();
    expect(findOneAndUpdate).not.toHaveBeenCalled();
    expect(ioEmitted).toHaveLength(0);
    expect(emitted.map((e) => e.evt)).toEqual(["import_plan_result"]);
  });

  // THE CONTROL. Without it, "reader is one textblock" is also satisfied by a
  // handler that ignores shape and always collapses.
  it("MAGIC (and the default) is still the full tree", async () => {
    for (const payload of [{ shape: "magic" }, {}, { shape: "nonsense" }]) {
      const out = await plan(payload);
      expect(out.modules.filter((m) => m.role === "container").length).toBeGreaterThan(1);
    }
  });
});

describe("markdownToReaderDoc", () => {
  const walk = (node, fn) => { fn(node); (node.content || []).forEach((c) => walk(c, fn)); };
  const RICH = [
    "# Title",
    "Intro with \\[escaped\\] brackets and **bold**.",
    "",
    "##### Deep heading",
    "",
    "- one",
    "- ",
    "",
    "> A quote — Someone Famous",
    "",
    "```js",
    "const x = 1;",
    "```",
    "",
    "| | |",
    "| --- | --- |",
    "| Born | 1972 |",
    "",
    "![alt](https://img.test/a.png)",
  ].join("\n");

  it("never emits an empty text node — one throws the whole doc in ProseMirror", () => {
    const { content } = markdownToReaderDoc(RICH);
    walk({ content }, (n) => {
      if (n.type === "text") expect(n.text.length).toBeGreaterThan(0);
    });
  });

  it("clamps headings to the levels the doc editor registers", () => {
    const { content } = markdownToReaderDoc(RICH);
    const levels = content.filter((n) => n.type === "heading").map((n) => n.attrs.level);
    expect(levels.length).toBeGreaterThan(0);
    expect(Math.max(...levels)).toBeLessThanOrEqual(3);
  });

  it("maps every block kind to a node, and drops a header row of blanks", () => {
    const { label, content } = markdownToReaderDoc(RICH);
    expect(label).toBe("Title");
    const types = content.map((n) => n.type);
    for (const t of ["paragraph", "heading", "bulletList", "blockquote", "codeBlock", "table", "image"]) {
      expect(types).toContain(t);
    }
    const table = content.find((n) => n.type === "table");
    expect(table.content).toHaveLength(1);
    expect(table.content[0].content.every((c) => c.type === "tableCell")).toBe(true);
    // Escapes resolve (the brackets land as separate adjacent text nodes, so
    // read the paragraph's TEXT rather than grepping the JSON).
    const text = [];
    walk(content[0], (n) => { if (n.type === "text") text.push(n.text); });
    expect(text.join("")).toContain("[escaped]");
  });
});
