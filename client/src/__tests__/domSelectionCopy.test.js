// @vitest-environment jsdom
// A highlight across several textblocks lives in no single ProseMirror editor, so the doc menu
// reads the browser's selection to offer Copy (user 2026-10-16, book Magic view).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { domSelectionTextTouching } from "../helpers/textClipboard";

function setup() {
  document.body.innerHTML = `<div id="a"><p id="pa">first block text</p></div><div id="b"><p id="pb">second block</p></div><div id="c"><p>elsewhere</p></div>`;
  return { a: document.getElementById("a"), b: document.getElementById("b"), c: document.getElementById("c") };
}
function select(fromNode, fromOff, toNode, toOff) {
  const r = document.createRange(); r.setStart(fromNode, fromOff); r.setEnd(toNode, toOff);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}

describe("domSelectionTextTouching", () => {
  it("returns the text of a selection that spans this editor and the next", () => {
    const { a, b } = setup();
    select(document.getElementById("pa").firstChild, 6, document.getElementById("pb").firstChild, 6);
    expect(domSelectionTextTouching(a)).toBe("block textsecond");
    expect(domSelectionTextTouching(b)).toBe("block textsecond");
  });
  it("is empty for an editor the selection does not touch", () => {
    const { c } = setup();
    select(document.getElementById("pa").firstChild, 0, document.getElementById("pa").firstChild, 5);
    expect(domSelectionTextTouching(c)).toBe("");
  });
  it("is empty for a collapsed caret", () => {
    const { a } = setup();
    select(document.getElementById("pa").firstChild, 3, document.getElementById("pa").firstChild, 3);
    expect(domSelectionTextTouching(a)).toBe("");
  });
  it("the doc menu offers Copy from it when its own selection is empty", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../ui/Editor.jsx"), "utf8");
    expect(src).toMatch(/domSelectionTextTouching\(editor\.view\?\.dom\)/);
    expect(src).toMatch(/const clipboardItems = domText \?/);
  });
});
