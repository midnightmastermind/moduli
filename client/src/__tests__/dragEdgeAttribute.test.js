// Hover used to be React state. `isOver`/`closestEdge` exist to draw four 2px
// bars at an element's edges — and one crossing re-rendered the WHOLE
// component; for `ModuleContainer` that is 1,900 lines plus every row and field
// it renders. Measured on the user's tablet during ONE drag (2026-09-01):
// container renders 2,004-3,383, instance renders 225-248, for four bars.
import { describe, it, expect } from "vitest";
import { setDropOver, setDropEdge } from "../helpers/dropEdgeAttr";

const el = () => document.createElement("div");

describe("drop-edge as a DOM attribute", () => {
  it("marks the hovered element and its nearest edge", () => {
    const e = el();
    setDropOver(e, true);
    setDropEdge(e, "bottom");
    expect(e.getAttribute("data-drop-over")).toBe("");
    expect(e.getAttribute("data-drop-edge")).toBe("bottom");
  });

  it("clearing the hover ALSO clears the edge", () => {
    // The one that leaves a bar lit on an element the finger has left: the
    // touch path calls setIsOver(false) on the old target and only sets the
    // edge on the new one, so a surviving `data-drop-edge` shows a drop line
    // where nothing will drop.
    const e = el();
    setDropOver(e, true); setDropEdge(e, "top");
    setDropOver(e, false);
    expect(e.hasAttribute("data-drop-over")).toBe(false);
    expect(e.hasAttribute("data-drop-edge"), "the edge outlived the hover").toBe(false);
  });

  it("a null edge removes the attribute rather than writing 'null'", () => {
    const e = el();
    setDropEdge(e, "left");
    setDropEdge(e, null);
    expect(e.hasAttribute("data-drop-edge")).toBe(false);
  });

  it("does nothing, and does not throw, without an element", () => {
    // The drag system calls these through a ref that is null before mount and
    // after unmount — a throw there would break the gesture.
    expect(() => { setDropOver(null, true); setDropEdge(undefined, "top"); }).not.toThrow();
  });
});

// AND THE SAME DEFECT IN `useDroppable`. `ModuleContainer` destructured
// `isOver` for its LIST target and read it NOWHERE — but the hook kept it in
// state, so every hover crossing re-rendered the container and everything
// inside it. Measured during one drag on the user's tablet (2026-09-01): 1,681
// container renders, attributed to `(none)` — no tracked prop or subscription
// changed, because hook-internal state is invisible to the probe's input list
// and to a code review alike.
describe("useDroppable — hover without a render", () => {
  it("marks and unmarks the element", () => {
    const e = document.createElement("div");
    setDropOver(e, true);
    expect(e.hasAttribute("data-drop-over")).toBe(true);
    setDropOver(e, false);
    expect(e.hasAttribute("data-drop-over")).toBe(false);
  });
});
