// The page doc's strict-block sweep wraps loose TEXT in a textblock — and only
// text. Typing beside a pill on Wrap Lab minted five textblocks, swallowed the
// page's container embed, tore the wrap group in two and dropped its picture
// (2026-10-02): the rule was "everything that is not a textblock".
import { describe, it, expect } from "vitest";
import { Schema } from "prosemirror-model";
import fs from "fs";
import path from "path";
import { looseTextBlocks, lineHasInlineNodes } from "../helpers/strictBlockSweep";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*" },
    bulletList: { group: "block", content: "listItem+" },
    listItem: { content: "paragraph+" },
    table: { group: "block", content: "paragraph+" },
    text: { group: "inline" },
    instanceTextblockInline: { group: "inline", inline: true, atom: true, attrs: { occurrenceId: { default: "" } } },
    instanceTextblock: { group: "block", atom: true, attrs: { occurrenceId: { default: "" } } },
    moduleEmbed: { group: "block", atom: true, attrs: { occurrenceId: { default: "" } } },
    wrapGroup: { group: "block", content: "moduleEmbed{2,}" },
  },
});
const n = schema.nodes;
const T = (t) => schema.text(t);
const P = (...c) => n.paragraph.create(null, c);
const E = (id) => n.moduleEmbed.create({ occurrenceId: id });
const chip = n.instanceTextblockInline.create({ occurrenceId: "charlie" });
const D = (...c) => n.doc.create(null, c);
const types = (list) => list.map((c) => c.nodeJson.type);

describe("looseTextBlocks", () => {
  it("the Wrap Lab page: embeds, a wrap group and a typed line — only the line", () => {
    const doc = D(E("container"), P(chip, T(" Q7")), n.wrapGroup.create(null, [E("pic"), E("yin"), E("bravo"), E("alpha")]), P());
    const out = looseTextBlocks(doc);
    expect(types(out)).toEqual(["paragraph"]);
    // …and the line keeps its pill.
    expect(JSON.stringify(out[0].nodeJson)).toContain("charlie");
  });
  it("never an embed, a wrap group, a textblock or a table", () => {
    const doc = D(E("a"), n.wrapGroup.create(null, [E("b"), E("c")]), n.instanceTextblock.create({ occurrenceId: "t" }), n.table.create(null, [P(T("cell"))]));
    expect(looseTextBlocks(doc)).toEqual([]);
  });
  it("typed paragraphs, headings and lists are loose text (the control)", () => {
    const doc = D(P(T("pasted text")), n.heading.create(null, [T("Title")]), n.bulletList.create(null, [n.listItem.create(null, [P(T("x"))])]));
    expect(types(looseTextBlocks(doc))).toEqual(["paragraph", "heading", "bulletList"]);
  });
  it("an empty line, and a line holding only a pill, are left alone", () => {
    expect(looseTextBlocks(D(P(), P(chip)))).toEqual([]);
  });
  it("offsets are document positions, in order", () => {
    const doc = D(E("a"), P(T("one")), P(T("two")));
    const out = looseTextBlocks(doc);
    expect(out.map((c) => doc.nodeAt(c.offset).textContent)).toEqual(["one", "two"]);
  });
});

describe("lineHasInlineNodes", () => {
  it("is true for a line with a pill, false for plain text", () => {
    expect(lineHasInlineNodes(P(chip, T(" ")))).toBe(true);
    expect(lineHasInlineNodes(P(T("a")))).toBe(false);
  });
});

describe("Editor wiring", () => {
  const src = fs.readFileSync(path.join(__dirname, "../ui/Editor.jsx"), "utf8");
  it("the sweep takes its list from looseTextBlocks", () => {
    expect(src).toMatch(/const conversions = looseTextBlocks\(editor\.state\.doc\);/);
    expect(src).not.toMatch(/if \(node\.type\.name === "instanceTextblock"\) return;\s*\/\/ Skip truly empty/);
  });
  it("a first character typed beside a pill moves the whole line into the textblock", () => {
    expect(src).toMatch(/if \(lineHasInlineNodes\(currentNode\)\) onAutoCreateTextblock\(capturedStart, null, currentNode\.nodeSize, currentNode\.toJSON\(\)\);/);
  });
});
