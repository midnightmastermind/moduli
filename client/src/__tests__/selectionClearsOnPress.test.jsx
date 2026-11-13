// A multi-selection ends when you click off it or do something with it (user 2026-11-13).
import { describe, it, expect, vi } from "vitest";
import { pressKeepsSelection } from "../state/SelectionContext";
import { setSelectionClearer, clearSelectionAfterAction } from "../helpers/selectionDrag";

const dom = (html) => { document.body.innerHTML = html; return document.body; };
const press = (sel, extra = {}) => ({ target: document.querySelector(sel), button: 0, shiftKey: false, ctrlKey: false, ...extra });
const isSelected = (id) => id === "a" || id === "b";

describe("a press ends the selection", () => {
  it("when it lands outside the selected items", () => {
    dom(`<div class="instance-wrap" data-occurrence-id="a"><span id="in-a">A</span></div><div class="instance-wrap" data-occurrence-id="z"><span id="in-z">Z</span></div><div id="empty"></div>`);
    expect(pressKeepsSelection(press("#empty"), isSelected)).toBe(false);
    expect(pressKeepsSelection(press("#in-z"), isSelected)).toBe(false);
  });
  it("but not on a selected item (dragging the group)", () => {
    dom(`<div class="instance-wrap" data-occurrence-id="a"><button id="handle">⠿</button></div>`);
    expect(pressKeepsSelection(press("#handle"), isSelected)).toBe(true);
  });
  it("nor with shift held, nor a right-click", () => {
    dom(`<div id="empty"></div>`);
    expect(pressKeepsSelection(press("#empty", { shiftKey: true }), isSelected)).toBe(true);
    expect(pressKeepsSelection(press("#empty", { button: 2 }), isSelected)).toBe(true);
  });
  it("nor inside a menu — the bulk menu's items must run first", () => {
    dom(`<div class="menu-surface"><div class="context-menu-item" id="item">Delete 2 selected</div></div><div role="dialog"><button id="d">ok</button></div>`);
    expect(pressKeepsSelection(press("#item"), isSelected)).toBe(true);
    expect(pressKeepsSelection(press("#d"), isSelected)).toBe(true);
  });
});

describe("an action ends the selection", () => {
  it("a group drop that lands clears it through the registered clearer", () => {
    const clear = vi.fn();
    setSelectionClearer(clear);
    clearSelectionAfterAction();
    expect(clear).toHaveBeenCalledTimes(1);
    setSelectionClearer(null);
    expect(() => clearSelectionAfterAction()).not.toThrow();
  });
});
