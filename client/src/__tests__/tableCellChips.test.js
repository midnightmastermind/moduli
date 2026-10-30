// Typing into an empty table cell makes a mini textblock chip (user, 2026-10-30: "make it a typing rule that it auto
// creates a chip when i type in an empty table cell" · "it should be a normal doc chip, not a new one").
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Schema } from "prosemirror-model";
import { cellDocIsEmpty, cellChipIds, withoutCellChip } from "../helpers/tableCells";
import { isEmptyListItemLine } from "../helpers/typedChip";
import { TextSelection } from "prosemirror-state";

const schema = new Schema({
  nodes: {
    doc: { content: "(paragraph | bulletList)+" },
    paragraph: { content: "inline*" },
    text: { group: "inline" },
    chip: { group: "inline", inline: true, atom: true, attrs: { occurrenceId: { default: null } } },
    bulletList: { content: "listItem+" },
    listItem: { content: "paragraph+" },
  },
});
const pm = (json) => schema.nodeFromJSON(json);

describe("cellDocIsEmpty", () => {
  it("an empty cell is empty", () => {
    expect(cellDocIsEmpty(pm({ type: "doc", content: [{ type: "paragraph" }] }))).toBe(true);
  });
  it("text or a chip is not (control)", () => {
    expect(cellDocIsEmpty(pm({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "a" }] }] }))).toBe(false);
    expect(cellDocIsEmpty(pm({ type: "doc", content: [{ type: "paragraph", content: [{ type: "chip", attrs: { occurrenceId: "x" } }] }] }))).toBe(false);
  });
});

describe("cell chips", () => {
  const doc = { type: "doc", content: [{ type: "paragraph", content: [
    { type: "instanceTextblockInline", attrs: { occurrenceId: "a" } }, { type: "text", text: " " },
    { type: "instanceTextblockInline", attrs: { occurrenceId: "b" } },
  ] }] };
  it("lists the chips a cell holds, in order", () => {
    expect(cellChipIds(doc)).toEqual(["a", "b"]);
    expect(cellChipIds({ type: "doc", content: [{ type: "paragraph" }] })).toEqual([]);
  });
  it("takes one chip out", () => {
    expect(cellChipIds(withoutCellChip(doc, "a"))).toEqual(["b"]);
  });
});

describe("wiring", () => {
  const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  it("the cell editor hands the first character of an empty cell to the table", () => {
    const ed = read("ui/Editor.jsx");
    expect(ed).toMatch(/isCell && onEmptyCellInputRef\.current && cellDocIsEmpty\(view\.state\.doc\)/);
  });
  it("the table makes the doc's own chip, and draws it idle without an editor", () => {
    const t = read("modules/containers/ContainerTable.jsx");
    expect(t).toMatch(/onEmptyCellInput=\{handleEmptyCellInput\}/);
    expect(t).toMatch(/mintTypedChip\(\{ view, pos: 1, text, owner: ownerOccurrence/);
    expect(t).toMatch(/const showEditor = isFocused \|\| hovered;/);
    // an idle chip cell draws the doc chip's own component — no editor mounted per chip cell
    expect(t).toMatch(/<InstanceTextblockInlineNode key=\{attrs\.occurrenceId\} node=\{\{ attrs, nodeSize: 1 \}\} editor=\{null\}/);
  });
  it("a chip asked to take the caret takes it", () => {
    expect(read("docs/pills/InstanceTextblockInlineNode.jsx")).toMatch(/claimTextblockFocus\(occurrenceId\)/);
  });
});

describe("an empty bullet takes a chip", () => {
  const doc = pm({ type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "intro" }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
    { type: "paragraph" },
  ] });
  const at = (pos) => TextSelection.create(doc, pos);
  it("an empty paragraph in a list item is the spot", () => {
    expect(isEmptyListItemLine(at(10))).toBe(true); // inside the empty bullet's paragraph
  });
  it("prose and a plain empty line are not (controls)", () => {
    expect(isEmptyListItemLine(at(3))).toBe(false);
    expect(isEmptyListItemLine(at(doc.content.size - 1))).toBe(false);
  });
  it("the doc editor runs it", () => {
    expect(readFileSync(new URL("../ui/Editor.jsx", import.meta.url), "utf8")).toMatch(/!isCell && isEmptyListItemLine\(view\.state\.selection\)/);
  });
});

describe("Table cell text: scroll (default) or wrap", () => {
  const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
  it("a table defaults to scroll and takes wrap from the layout cascade", () => {
    const t = readFileSync(new URL("../modules/containers/ContainerTable.jsx", import.meta.url), "utf8");
    expect(t).toMatch(/cellText = "scroll"/);
    expect(t).toMatch(/cellText === "wrap" \? " table-cells-wrap" : ""/);
    expect(readFileSync(new URL("../modules/ModuleContainer.jsx", import.meta.url), "utf8")).toMatch(/cellText=\{layoutCascade\?\.resolved\?\.cellText\}/);
    expect(readFileSync(new URL("../ui/LayoutCascadeEditor.jsx", import.meta.url), "utf8")).toMatch(/label="Table cell text"/);
  });
  it("scroll keeps a chip on one line, idle and while edited", () => {
    expect(css).toMatch(/\.table-container:not\(\.table-cells-wrap\) \.table-td \.instance-textblock-inline \*[\s\S]*?white-space: nowrap !important/);
    expect(css).toMatch(/\.table-container:not\(\.table-cells-wrap\) \.table-td \.doc-editor-content\.ProseMirror p \{\s*white-space: nowrap;/);
  });
});

describe("a chip in a table cell (user's video, 2026-10-30)", () => {
  const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
  it("is the doc pill unchanged — no table-only margin, handle or arrow rules", () => {
    expect(css).not.toMatch(/\.table-td \.itbi-handle/);
    expect(css).not.toMatch(/\.table-td \.itbi-arrow/);
    expect(css).not.toMatch(/\.table-td \.instance-textblock-inline \{ margin/);
  });
  it("the cell's line starts 3px in, so the pill's -3px margin stays inside", () => {
    expect(css).toMatch(/\.table-td \.doc-editor-content\.ProseMirror p \{ padding-left: 3px; \}/);
  });
  it("a hovered cell clips; only a cell being typed in scrolls", () => {
    expect(css).toMatch(/\.table-td:not\(:focus-within\) \.doc-editor-content\.ProseMirror p \{ overflow-x: clip; \}/);
  });
  it("a hovered cell lets go when the pointer is anywhere outside it; a chip counts as hovered on any movement", () => {
    const t = readFileSync(new URL("../modules/containers/ContainerTable.jsx", import.meta.url), "utf8");
    expect(t).toMatch(/if \(el && e\.target instanceof Node && !el\.contains\(e\.target\)\) setHovered\(false\);/);
    expect(readFileSync(new URL("../docs/pills/InstanceTextblockInlineNode.jsx", import.meta.url), "utf8")).toMatch(/onMouseMove=\{\(\) => \{ if \(!hovered\) setHovered\(true\); \}\}/);
  });
});
