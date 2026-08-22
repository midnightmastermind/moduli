// "if i open a page in a panel, and its already opened in another visible
// panel, highlight the page in the spot thats opened (still open the page in
// the original spot)".
//
// The notifier already existed and flashed the whole PANEL SHELL. The user asked
// for the page's tab — and there is no tab strip: a panel shows one page at a
// time with its name in `.page-header`. So the header is the target, and these
// tests pin the choice, because "which element" is the part that silently
// regresses (nothing throws when a flash lands on the wrong box).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { alreadyOpenFlashTarget, flashAlreadyOpen, flashPanelAlreadyOpen }
  from "../helpers/alreadyOpenFlash";

function panel({ withHeader = true } = {}) {
  const el = document.createElement("div");
  el.setAttribute("data-panel-id", "p1");
  el.className = "panel-shell";
  if (withHeader) {
    const h = document.createElement("div");
    h.className = "page-header";
    el.appendChild(h);
  }
  document.body.appendChild(el);
  return el;
}
beforeEach(() => { document.body.innerHTML = ""; });

describe("alreadyOpenFlashTarget", () => {
  it("picks the PAGE HEADER, not the panel shell", () => {
    const el = panel();
    expect(alreadyOpenFlashTarget(el).className).toBe("page-header");
  });

  it("falls back to the panel when no page is mounted", () => {
    // A panel with no page still deserves the notice; silently doing nothing
    // is worse than ringing something slightly too big.
    const el = panel({ withHeader: false });
    expect(alreadyOpenFlashTarget(el)).toBe(el);
  });

  it("returns null for a missing panel rather than throwing", () => {
    expect(alreadyOpenFlashTarget(null)).toBeNull();
    expect(alreadyOpenFlashTarget({})).toBeNull();
  });

  it("picks the header of THIS panel, not another panel's", () => {
    // Two panels are always on screen; a document-wide lookup would ring the
    // wrong one — the same scoping bug openOccurrenceInPanel records for search.
    const a = panel(); a.setAttribute("data-panel-id", "A");
    const b = panel(); b.setAttribute("data-panel-id", "B");
    b.querySelector(".page-header").id = "bHeader";
    expect(alreadyOpenFlashTarget(b).id).toBe("bHeader");
  });
});

describe("flashAlreadyOpen", () => {
  it("adds the class and removes it on animationend", () => {
    const el = panel().querySelector(".page-header");
    expect(flashAlreadyOpen(el)).toBe(true);
    expect(el.classList.contains("already-open-flash")).toBe(true);
    el.dispatchEvent(new Event("animationend"));
    expect(el.classList.contains("already-open-flash")).toBe(false);
  });

  it("RE-flashes when the class is already present", () => {
    // Adding a class that is already there does not restart a CSS animation, so
    // opening the same page twice would flash once. The remove + reflow is what
    // makes the second one visible.
    const el = panel().querySelector(".page-header");
    const seen = [];
    const spy = vi.spyOn(el.classList, "remove").mockImplementation((...a) => { seen.push(a[0]); });
    el.classList.add("already-open-flash");
    flashAlreadyOpen(el);
    expect(seen).toContain("already-open-flash");
    spy.mockRestore();
  });

  it("a null element is not a crash", () => {
    expect(flashAlreadyOpen(null)).toBe(false);
  });
});

describe("flashPanelAlreadyOpen", () => {
  it("resolves and flashes the header in one call", () => {
    const el = panel();
    const t = flashPanelAlreadyOpen(el);
    expect(t.className).toContain("page-header");
    expect(t.classList.contains("already-open-flash")).toBe(true);
  });

  it("does not flash the panel shell when a header exists — the control", () => {
    // Without this, a target resolver that returned the panel every time would
    // pass the test above.
    const el = panel();
    flashPanelAlreadyOpen(el);
    expect(el.classList.contains("already-open-flash")).toBe(false);
  });
});
