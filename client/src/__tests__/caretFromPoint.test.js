// Clicking an embedded container's header sent the caret to the END of the text
// (user, 2026-09-15). jsdom has no layout, so the browser's point lookup is
// stubbed; what is tested is that the caret lands where that lookup says.
import { describe, it, expect, afterEach } from "vitest";
import { placeCaretAtPoint } from "../helpers/caretFromPoint";

function label(text) {
  const el = document.createElement("span");
  el.contentEditable = "true";
  el.textContent = text;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  delete document.caretPositionFromPoint;
  delete document.caretRangeFromPoint;
  window.getSelection().removeAllRanges();
  document.body.innerHTML = "";
});

describe("placeCaretAtPoint", () => {
  it("puts the caret at the offset under the pointer (Firefox API)", () => {
    const el = label("Daily Question");
    document.caretPositionFromPoint = () => ({ offsetNode: el.firstChild, offset: 5 });
    expect(placeCaretAtPoint(el, 10, 10)).toBe(true);
    const sel = window.getSelection();
    expect(sel.anchorNode).toBe(el.firstChild);
    expect(sel.anchorOffset).toBe(5);
  });

  it("works with the Chromium API too", () => {
    const el = label("Journal");
    document.caretRangeFromPoint = () => {
      const r = document.createRange(); r.setStart(el.firstChild, 3); return r;
    };
    expect(placeCaretAtPoint(el, 10, 10)).toBe(true);
    expect(window.getSelection().anchorOffset).toBe(3);
  });

  // Word-select and drag-select must survive the click.
  it("leaves a RANGE selection alone", () => {
    const el = label("Highlights");
    const r = document.createRange(); r.setStart(el.firstChild, 0); r.setEnd(el.firstChild, 4);
    window.getSelection().addRange(r);
    document.caretPositionFromPoint = () => ({ offsetNode: el.firstChild, offset: 7 });
    expect(placeCaretAtPoint(el, 10, 10)).toBe(false);
    expect(window.getSelection().toString()).toBe("High");
  });

  // The control: a point outside the label must not move the caret into it.
  it("ignores a point outside the element", () => {
    const el = label("Notes");
    const other = label("Elsewhere");
    document.caretPositionFromPoint = () => ({ offsetNode: other.firstChild, offset: 2 });
    expect(placeCaretAtPoint(el, 10, 10)).toBe(false);
  });

  it("no element, no caret", () => {
    expect(placeCaretAtPoint(null, 1, 1)).toBe(false);
  });
});
