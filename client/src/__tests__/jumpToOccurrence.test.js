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
