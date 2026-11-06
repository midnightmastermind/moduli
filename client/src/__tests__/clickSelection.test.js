// Double-click could not select a word in a textblock: the editor's caret fix-up collapsed it (both browsers).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Schema } from "@tiptap/pm/model";
import { selectionForClicks } from "../helpers/clickSelection.js";

const schema = new Schema({ nodes: { doc: { content: "block+" }, paragraph: { group: "block", content: "text*" }, text: {} } });
const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("Bonsai is a Japanese art")]), schema.node("paragraph")]);
// paragraph content starts at pos 1
describe("selectionForClicks", () => {
  it("a single click selects nothing (the caret is placed as before)", () => {
    expect(selectionForClicks(doc, 3, 1)).toBeNull();
  });
  it("a double click selects the word under it", () => {
    const r = selectionForClicks(doc, 3, 2);
    expect(doc.textBetween(r.from, r.to)).toBe("Bonsai");
    const r2 = selectionForClicks(doc, 15, 2);
    expect(doc.textBetween(r2.from, r2.to)).toBe("Japanese");
  });
  it("a triple click selects the line", () => {
    const r = selectionForClicks(doc, 3, 3);
    expect(doc.textBetween(r.from, r.to)).toBe("Bonsai is a Japanese art");
  });
  it("an empty line has nothing to select", () => {
    const at = doc.child(0).nodeSize + 1;
    expect(selectionForClicks(doc, at, 2)).toBeNull();
    expect(selectionForClicks(doc, at, 3)).toBeNull();
  });
});

describe("wiring", () => {
  it("the caret fix-up selects for a double/triple click instead of collapsing it", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/ui/Editor.jsx"), "utf8");
    const fix = src.slice(src.indexOf("const docAtDown = editor.state.doc;"), src.indexOf("editor.commands.setTextSelection(coords.pos);"));
    expect(fix).toMatch(/const clicks = e\.detail \|\| 1;/);
    expect(fix).toMatch(/selectionForClicks\(editor\.state\.doc, coords\.pos, clicks\)/);
  });
});
