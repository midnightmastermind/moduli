// __tests__/jumpToOccurrence.test.js
// jsdom-friendly coverage for the shared jump-to-occurrence helper.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  jumpToOccurrence,
  findOccurrenceElement,
  scrollAndFlash,
} from "../helpers/jumpToOccurrence";

beforeEach(() => {
  document.body.innerHTML = "";
});

function mountOccurrence(id, attr = "data-occ-id") {
  const el = document.createElement("div");
  el.setAttribute(attr, id);
  el.scrollIntoView = vi.fn();
  document.body.appendChild(el);
  return el;
}

describe("findOccurrenceElement", () => {
  it("finds the canonical [data-occ-id] marker", () => {
    const el = mountOccurrence("abc");
    expect(findOccurrenceElement("abc")).toBe(el);
  });

  it("falls back to the legacy [data-occurrence-id] marker", () => {
    const el = mountOccurrence("xyz", "data-occurrence-id");
    expect(findOccurrenceElement("xyz")).toBe(el);
  });

  it("escapes UUID hyphens that would otherwise break the selector", () => {
    const id = "abc-123-def-456";
    const el = mountOccurrence(id);
    expect(findOccurrenceElement(id)).toBe(el);
  });

  it("returns null when nothing matches", () => {
    expect(findOccurrenceElement("missing")).toBe(null);
  });

  it("returns null for empty/null input", () => {
    expect(findOccurrenceElement(null)).toBe(null);
    expect(findOccurrenceElement("")).toBe(null);
  });
});

describe("scrollAndFlash", () => {
  it("calls scrollIntoView on the target element", () => {
    const el = mountOccurrence("a");
    scrollAndFlash(el);
    expect(el.scrollIntoView).toHaveBeenCalled();
  });

  it("adds the anchor-highlight class and removes it after the timeout", async () => {
    vi.useFakeTimers();
    const el = mountOccurrence("a");
    scrollAndFlash(el, { highlightMs: 50 });
    expect(el.classList.contains("anchor-highlight")).toBe(true);
    vi.advanceTimersByTime(60);
    expect(el.classList.contains("anchor-highlight")).toBe(false);
    vi.useRealTimers();
  });

  it("no-ops for null el without throwing", () => {
    expect(() => scrollAndFlash(null)).not.toThrow();
  });
});

describe("jumpToOccurrence", () => {
  it("returns true and scrolls when the element is mounted", () => {
    const el = mountOccurrence("here");
    expect(jumpToOccurrence("here")).toBe(true);
    expect(el.scrollIntoView).toHaveBeenCalled();
  });

  it("returns false when not mounted + no onActivatePage", () => {
    expect(jumpToOccurrence("nowhere")).toBe(false);
  });

  it("invokes onActivatePage and retries after the grace window", () => {
    vi.useFakeTimers();
    const activate = vi.fn((id) => {
      // Simulate the activation by mounting the element after the call.
      mountOccurrence(id);
    });
    const result = jumpToOccurrence("late", { onActivatePage: activate });
    expect(result).toBe(true);
    expect(activate).toHaveBeenCalledWith("late");
    // The retry runs after PAGE_SWITCH_GRACE_MS (220ms internally).
    vi.advanceTimersByTime(300);
    const el = document.querySelector('[data-occ-id="late"]');
    expect(el?.classList.contains("anchor-highlight")).toBe(true);
    vi.useRealTimers();
  });

  it("returns false for null/undefined occurrenceId", () => {
    expect(jumpToOccurrence(null)).toBe(false);
    expect(jumpToOccurrence(undefined)).toBe(false);
  });
});

// --- Scoping: the same occurrence mounted in more than one panel -------------
// An unscoped document query returns whichever copy comes first in document
// order, so a search that opened the target in panel B highlighted panel A's
// copy (user 2026-07-27).

describe("findOccurrenceElement scoping", () => {
  function twoPanels(occId) {
    document.body.innerHTML = `
      <div id="panelA" data-panel-id="A"><div data-occ-id="${occId}"></div></div>
      <div id="panelB" data-panel-id="B"><div data-occ-id="${occId}"></div></div>`;
    document.querySelectorAll("[data-occ-id]").forEach(el => { el.scrollIntoView = vi.fn(); });
    return {
      a: document.querySelector("#panelA [data-occ-id]"),
      b: document.querySelector("#panelB [data-occ-id]"),
    };
  }

  it("unscoped returns the FIRST copy in document order", () => {
    const { a } = twoPanels("dup");
    expect(findOccurrenceElement("dup")).toBe(a);
  });

  it("scoped to a panel returns THAT panel's copy", () => {
    const { b } = twoPanels("dup");
    expect(findOccurrenceElement("dup", document.querySelector("#panelB"))).toBe(b);
  });

  it("accepts a lazy resolver function", () => {
    const { b } = twoPanels("dup");
    expect(findOccurrenceElement("dup", () => document.querySelector("#panelB"))).toBe(b);
  });

  it("a root that resolves to nothing yields null — never a document-wide fallback", () => {
    twoPanels("dup");
    expect(findOccurrenceElement("dup", () => null)).toBe(null);
    expect(findOccurrenceElement("dup", () => document.querySelector("#panelZ"))).toBe(null);
  });

  it("matches the root element itself, not just its descendants", () => {
    document.body.innerHTML = `<div id="page" data-page-occ-id="p1"></div>`;
    const page = document.querySelector("#page");
    expect(findOccurrenceElement("p1", page)).toBe(page);
  });

  it("finds a PAGE by its data-page-occ-id marker", () => {
    document.body.innerHTML = `<div data-page-occ-id="p1"></div>`;
    expect(findOccurrenceElement("p1")).toBe(document.querySelector("[data-page-occ-id]"));
  });

  it("a real occurrence node outranks a page marker with the same id", () => {
    document.body.innerHTML = `<div data-page-occ-id="x"></div><div data-occ-id="x"></div>`;
    expect(findOccurrenceElement("x")).toBe(document.querySelector("[data-occ-id]"));
  });
});

describe("jumpToOccurrence retries", () => {
  it("keeps looking inside the scope and flashes once it mounts", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="panelB" data-panel-id="B"></div>`;
    const root = () => document.querySelector("#panelB");
    const onMissing = vi.fn();
    expect(jumpToOccurrence("late", { root, retries: 5, retryMs: 10, onMissing })).toBe(true);
    vi.advanceTimersByTime(20);
    // Mounts after a couple of misses.
    const el = document.createElement("div");
    el.setAttribute("data-occ-id", "late");
    el.scrollIntoView = vi.fn();
    document.querySelector("#panelB").appendChild(el);
    vi.advanceTimersByTime(20);
    expect(el.classList.contains("anchor-highlight")).toBe(true);
    expect(onMissing).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("reports onMissing after the last retry fails", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="panelB" data-panel-id="B"></div>`;
    const onMissing = vi.fn();
    jumpToOccurrence("never", { root: () => document.querySelector("#panelB"), retries: 3, retryMs: 10, onMissing });
    vi.advanceTimersByTime(100);
    expect(onMissing).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("without retries or an activation hook it still reports a synchronous miss", () => {
    expect(jumpToOccurrence("nope")).toBe(false);
  });
});

// --- Render-all timing -------------------------------------------------------
// Opening a bookmark activates a new page and jumps to it. Asking every render
// window to open on the FIRST miss expanded the board being LEFT from 80 cards to
// 1,465 before the panel switched (user, 2026-09-15: "it still taking way too
// long to open"). A caller that swaps/polls must look again before expanding.
describe("jumpToOccurrence render-all timing", () => {
  const RENDER_ALL = "moduli:render-all";

  it("does not expand any window when the target mounts on the first retry", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="panelB" data-panel-id="B"></div>`;
    const heard = vi.fn();
    window.addEventListener(RENDER_ALL, heard);
    jumpToOccurrence("page-1", { root: () => document.querySelector("#panelB"), retries: 5, retryMs: 10 });
    expect(heard).not.toHaveBeenCalled();
    const el = document.createElement("div");
    el.setAttribute("data-page-occ-id", "page-1");
    el.scrollIntoView = vi.fn();
    document.querySelector("#panelB").appendChild(el);
    vi.advanceTimersByTime(15);
    expect(el.classList.contains("anchor-highlight")).toBe(true);
    expect(heard).not.toHaveBeenCalled();
    window.removeEventListener(RENDER_ALL, heard);
    vi.useRealTimers();
  });

  // The control: a row genuinely past a window is still found — the expansion
  // moved later, it did not go away.
  it("expands after a retry misses, then finds a row that was past the window", () => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="panelB" data-panel-id="B"></div>`;
    const onMissing = vi.fn();
    const mountOnExpand = () => {
      const el = document.createElement("div");
      el.setAttribute("data-occ-id", "row-800");
      el.scrollIntoView = vi.fn();
      document.querySelector("#panelB").appendChild(el);
    };
    window.addEventListener(RENDER_ALL, mountOnExpand, { once: true });
    // A single retry must still get its look AFTER the expansion.
    jumpToOccurrence("row-800", { root: () => document.querySelector("#panelB"), retries: 1, retryMs: 10, onMissing });
    vi.advanceTimersByTime(30);
    expect(document.querySelector('[data-occ-id="row-800"]').classList.contains("anchor-highlight")).toBe(true);
    expect(onMissing).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("with no swap and no retries it still expands synchronously", () => {
    const heard = vi.fn();
    window.addEventListener(RENDER_ALL, heard);
    jumpToOccurrence("nope");
    expect(heard).toHaveBeenCalledTimes(1);
    window.removeEventListener(RENDER_ALL, heard);
  });
});
