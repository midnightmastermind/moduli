import { describe, it, expect, vi, beforeAll } from "vitest";

beforeAll(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

import { registerDocTouchDrop, getDocTouchDrop, getDocTouchDropZone } from "../helpers/dragSystem.js";

// Build: page editor > (textblock sub-editor, nested doc-container editor > inner textblock)
function buildDom() {
  const page = document.createElement("div");
  page.className = "doc-editor";
  const textblock = document.createElement("div");
  textblock.className = "doc-editor";
  const nestedDoc = document.createElement("div");
  nestedDoc.className = "doc-editor";
  const innerTb = document.createElement("div");
  innerTb.className = "doc-editor";
  page.appendChild(textblock);
  page.appendChild(nestedDoc);
  nestedDoc.appendChild(innerTb);
  document.body.appendChild(page);
  return { page, textblock, nestedDoc, innerTb };
}

describe("doc touch-drop zone registry (nested doc-container delegation)", () => {
  it("climbs past unregistered sub-editors to the page editor", () => {
    const { page, textblock } = buildDom();
    const pageFn = vi.fn();
    const off = registerDocTouchDrop(page, pageFn);
    const zone = getDocTouchDropZone(textblock);
    expect(zone.el).toBe(page);
    expect(zone.fn).toBe(pageFn);
    expect(getDocTouchDrop(textblock)).toBe(pageFn);
    off();
    page.remove();
  });

  it("resolves a registered nested doc-container zone before the page editor", () => {
    const { page, nestedDoc, innerTb } = buildDom();
    const pageFn = vi.fn();
    const nestedFn = vi.fn();
    const off1 = registerDocTouchDrop(page, pageFn);
    const off2 = registerDocTouchDrop(nestedDoc, nestedFn);
    // Point inside the nested doc container → its own zone, not the page's.
    expect(getDocTouchDropZone(nestedDoc)).toEqual({ el: nestedDoc, fn: nestedFn });
    // A textblock INSIDE the nested container climbs to the container, not the page.
    expect(getDocTouchDropZone(innerTb)).toEqual({ el: nestedDoc, fn: nestedFn });
    // The page editor itself still resolves to itself (no self-delegation loop).
    expect(getDocTouchDropZone(page)).toEqual({ el: page, fn: pageFn });
    off1(); off2();
    page.remove();
  });

  it("returns null when nothing up the chain registered", () => {
    const { page, innerTb } = buildDom();
    expect(getDocTouchDropZone(innerTb)).toBeNull();
    expect(getDocTouchDrop(innerTb)).toBeNull();
    page.remove();
  });

  it("unregistering the nested zone falls back to the page editor", () => {
    const { page, nestedDoc, innerTb } = buildDom();
    const pageFn = vi.fn();
    const nestedFn = vi.fn();
    const off1 = registerDocTouchDrop(page, pageFn);
    const off2 = registerDocTouchDrop(nestedDoc, nestedFn);
    off2();
    expect(getDocTouchDropZone(innerTb)).toEqual({ el: page, fn: pageFn });
    off1();
    page.remove();
  });
});
