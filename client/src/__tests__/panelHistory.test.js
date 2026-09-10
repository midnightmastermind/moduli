// BACK, FOR A PANEL.
//
// User, 2026-09-10: *"a back button on the panel header... that way i can press
// back again if im on a browser page from a bookmark."*
//
// The awkward parts are all here rather than in the header: a move WE made must
// not push a new entry, a page that has since been deleted must be stepped over
// rather than opened, and re-opening the page you are already on is not a
// navigation.
import { describe, it, expect, beforeEach } from "vitest";
import {
  recordActive, canBack, canForward, back, forward, navFor, _reset,
} from "../helpers/panelHistory";

const V = "view-1";
beforeEach(() => { _reset(); });

describe("panelHistory", () => {
  it("records pages and steps back through them", () => {
    recordActive(V, "a"); recordActive(V, "b"); recordActive(V, "c");
    expect(canBack(V)).toBe(true);
    expect(back(V)).toBe("b");
    expect(back(V)).toBe("a");
    expect(canBack(V)).toBe(false);
    expect(back(V)).toBe(null);
  });

  // THE ONE THAT MAKES BACK WORK MORE THAN ONCE. The write a Back causes comes
  // straight back through `updateView` — if that pushed, the history would grow
  // by the page you just left and Back would never reach further than one step.
  it("does not record the write its OWN back causes", () => {
    recordActive(V, "a"); recordActive(V, "b"); recordActive(V, "c");
    const t1 = back(V);
    recordActive(V, t1);              // what updateView reports right after
    expect(back(V), "back got stuck one step from the end").toBe("a");
  });

  it("re-opening the page you are on is not a navigation", () => {
    recordActive(V, "a"); recordActive(V, "a"); recordActive(V, "a");
    expect(navFor(V).entries).toEqual(["a"]);
    expect(canBack(V)).toBe(false);
  });

  // A page in the history may have been deleted or unpinned since. Opening a
  // hole is worse than skipping it.
  it("steps OVER a page that no longer exists", () => {
    recordActive(V, "a"); recordActive(V, "gone"); recordActive(V, "c");
    expect(back(V, (id) => id !== "gone")).toBe("a");
  });

  it("returns null when everything behind it is gone", () => {
    recordActive(V, "gone1"); recordActive(V, "gone2"); recordActive(V, "c");
    expect(back(V, (id) => id === "c")).toBe(null);
  });

  it("forward retraces, and a new page truncates the branch", () => {
    recordActive(V, "a"); recordActive(V, "b"); recordActive(V, "c");
    back(V); recordActive(V, "b");
    expect(canForward(V)).toBe(true);
    expect(forward(V)).toBe("c");
    forward(V); recordActive(V, "c");
    recordActive(V, "d");                       // somewhere new
    expect(canForward(V), "the forward branch survived a new navigation").toBe(false);
  });

  // THE CONTROL. Two panels must not share one history, or navigating in one
  // would offer Back in the other.
  it("keeps panels apart", () => {
    recordActive("v1", "a"); recordActive("v1", "b");
    recordActive("v2", "x");
    expect(canBack("v1")).toBe(true);
    expect(canBack("v2")).toBe(false);
    expect(back("v1")).toBe("a");
  });

  it("ignores junk rather than recording a hole", () => {
    recordActive(V, null); recordActive(null, "a"); recordActive(V, "");
    expect(navFor(V).entries).toEqual([]);
  });
});
