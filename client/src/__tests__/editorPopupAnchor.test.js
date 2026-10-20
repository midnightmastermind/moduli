// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { editorPopupAnchor, EDITOR_POPUP_W, EDITOR_POPUP_H } from "../ui/Editor.jsx";

const wrap = { top: 100, left: 20 };
describe("editorPopupAnchor", () => {
  it("opens under the caret, wrapper-relative, when it fits", () => {
    expect(editorPopupAnchor({ top: 200, bottom: 218, left: 60 }, wrap, 1400, 900)).toEqual({ top: 122, left: 40 });
  });
  it("keeps the popup inside the screen on a phone (it ran 26px past the right edge)", () => {
    const a = editorPopupAnchor({ top: 180, bottom: 198, left: 136 }, { top: 0, left: 0 }, 390, 844);
    expect(a.left + EDITOR_POPUP_W).toBeLessThanOrEqual(390 - 8);
  });
  it("opens above the caret when there is no room below", () => {
    const a = editorPopupAnchor({ top: 800, bottom: 818, left: 60 }, { top: 0, left: 0 }, 1400, 900);
    expect(a.top).toBe(800 - 4 - EDITOR_POPUP_H);
  });
  it("stays below when there is no room above either", () => {
    const a = editorPopupAnchor({ top: 100, bottom: 118, left: 60 }, { top: 0, left: 0 }, 1400, 300);
    expect(a.top).toBe(122);
  });
});
