// @vitest-environment jsdom
// A press on a menu item or a button is a command, not a caret placed on a
// line. "Continue wrap into next block" left the caret on the empty line after
// the group, and the click that chose it minted a textblock there (2026-10-02).
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { isOnCommandControl, isUndoRedoChord } from "../ui/Editor.jsx";

describe("isOnCommandControl", () => {
  it("a radial menu item (a portalled button) is a command", () => {
    document.body.innerHTML = `<div class="radial-menu-items"><button class="radial-menu-item" id="b"><svg id="icon"><path id="p"/></svg></button></div>`;
    expect(isOnCommandControl(document.getElementById("b"))).toBe(true);
    expect(isOnCommandControl(document.getElementById("p"))).toBe(true);
  });
  it("a context menu item and a role=menuitem are commands", () => {
    document.body.innerHTML = `<div class="context-menu-item" id="c">Delete</div><div role="menuitem"><span id="m">Copy</span></div>`;
    expect(isOnCommandControl(document.getElementById("c"))).toBe(true);
    expect(isOnCommandControl(document.getElementById("m"))).toBe(true);
  });
  it("a line of text is not (the control)", () => {
    document.body.innerHTML = `<div class="ProseMirror" contenteditable="true"><p id="line"></p></div><div id="pad"></div>`;
    expect(isOnCommandControl(document.getElementById("line"))).toBe(false);
    expect(isOnCommandControl(document.getElementById("pad"))).toBe(false);
    expect(isOnCommandControl(document.getElementById("line").appendChild(document.createTextNode("x")))).toBe(false);
  });
  it("an editor inside a clickable card is still text — the nearest decides", () => {
    document.body.innerHTML = `<div role="button"><div class="ProseMirror" contenteditable="true"><p id="inner"></p></div><span id="chrome">open</span></div>`;
    expect(isOnCommandControl(document.getElementById("inner"))).toBe(false);
    expect(isOnCommandControl(document.getElementById("chrome"))).toBe(true);
  });
  it("the pointer stamp consults it", () => {
    const src = readFileSync(resolve(__dirname, "../ui/Editor.jsx"), "utf-8");
    expect(src).toMatch(/!isInNonEditableIsland\(e\.target\) && !isOnCommandControl\(e\.target\)\) stampUserInput\(\)/);
  });
});

// Ctrl+Z after an Unwrap restored the caret onto the empty line below the group
// and the keystroke minted a textblock there (2026-10-02).
describe("isUndoRedoChord", () => {
  it("undo and redo chords are commands", () => {
    expect(isUndoRedoChord({ key: "z", ctrlKey: true })).toBe(true);
    expect(isUndoRedoChord({ key: "Z", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(isUndoRedoChord({ key: "z", metaKey: true })).toBe(true);
    expect(isUndoRedoChord({ key: "y", ctrlKey: true })).toBe(true);
  });
  it("a modifier pressed on its own is not a caret either — it arrives before the Z", () => {
    expect(isUndoRedoChord({ key: "Control", ctrlKey: true })).toBe(true);
    expect(isUndoRedoChord({ key: "Meta", metaKey: true })).toBe(true);
    expect(isUndoRedoChord({ key: "Shift", shiftKey: true })).toBe(true);
  });
  it("typing and caret keys are not (the control)", () => {
    expect(isUndoRedoChord({ key: "z" })).toBe(false);
    expect(isUndoRedoChord({ key: "ArrowDown" })).toBe(false);
    expect(isUndoRedoChord({ key: "Enter" })).toBe(false);
    expect(isUndoRedoChord({ key: "End", ctrlKey: true })).toBe(false);
    expect(isUndoRedoChord({ key: "z", ctrlKey: true, altKey: true })).toBe(false);
  });
  it("the keydown stamp consults it", () => {
    const src = readFileSync(resolve(__dirname, "../ui/Editor.jsx"), "utf-8");
    expect(src).toMatch(/const stamp = \(e\) => \{ if \(!isUndoRedoChord\(e\)\) stampUserInput\(\); \};/);
  });
});
