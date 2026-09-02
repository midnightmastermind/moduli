/**
 * THE ROW'S DROP BARS COME FROM AN ATTRIBUTE, NOT REACT STATE.
 *
 * The device's own capture, one 49-second drag on the tablet (2026-09-02):
 *
 *     renders=387(container:189, instance:151, panel:36)
 *     causes=instance{(none) @Drink=34  (none) @Eat=28}
 *
 * `(none)` means no subscribed input changed — the signature of LOCAL state,
 * which for a row is `isOver`/`closestEdge`. `ModuleContainer` opted into
 * `edgeAsAttribute` on 2026-09-01 (2,004-3,383 renders per drag -> 75);
 * `ModuleInstance` never did, which is the user's own discriminator: "it only
 * jitters when its passing over other instances."
 *
 * Mounting ModuleInstance needs the whole grid store, so what is pinned is the
 * seam that carries the change: the attribute writer, and the CSS that has to
 * name the ROW's own bar classes — the opt-in without those selectors is a
 * hover that costs nothing and draws nothing, which is worse than the cost it
 * removed.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { setDropOver, setDropEdge } from "../helpers/dropEdgeAttr.js";

const src = (rel) => readFileSync(join(process.cwd(), "src", rel), "utf8");

describe("ModuleInstance uses the attribute path", () => {
  const jsx = src("modules/ModuleInstance.jsx");

  it("opts in", () => {
    expect(jsx).toMatch(/edgeAsAttribute:\s*true/);
  });

  it("no longer takes isOver / closestEdge out of the hook", () => {
    // They are hard-coded false/null in that mode, so a conditional render on
    // them would silently draw nothing — the failure this test exists for.
    const destructure = jsx.match(/const \{[^}]*\} = useDragDrop\(/s)?.[0] || "";
    expect(destructure).not.toMatch(/isOver/);
    expect(destructure).not.toMatch(/closestEdge/);
  });

  it("mounts all four bars unconditionally, each carrying --auto", () => {
    for (const edge of ["top", "bottom", "left", "right"]) {
      expect(jsx).toMatch(
        new RegExp(`<div className="drop-indicator drop-indicator--auto drop-indicator-inst-${edge}" />`)
      );
    }
  });
});

describe("the CSS reveals the ROW's own bar classes", () => {
  const css = src("index.css").replace(/\/\*[\s\S]*?\*\//g, "");
  it("names every -inst- edge under data-drop-edge", () => {
    for (const edge of ["top", "bottom", "left", "right"]) {
      expect(css).toMatch(
        new RegExp(`\\[data-drop-edge="${edge}"\\]\\s*>\\s*\\.drop-indicator--auto\\.drop-indicator-inst-${edge}`)
      );
    }
  });

  it("still keeps them hidden by default", () => {
    expect(css).toMatch(/\.drop-indicator--auto\s*\{\s*display:\s*none/);
  });
});

describe("the writer, against a real element", () => {
  it("sets and clears the attributes the CSS keys on", () => {
    const el = document.createElement("div");
    setDropOver(el, true); setDropEdge(el, "bottom");
    expect(el.getAttribute("data-drop-edge")).toBe("bottom");
    setDropOver(el, false);
    // Clearing `over` must clear the EDGE too, or a bar stays lit on a row the
    // finger has already left — invisible in a unit test, obvious in a drag.
    expect(el.hasAttribute("data-drop-edge")).toBe(false);
  });
});

/**
 * THE CONTAINER HEADER'S INSERT BAR — the last local-state hover.
 *
 * After the row fix shipped, the device's own capture on a SETTLED 14.7s drag
 * still read `renders=126(container:99 ...)` with
 * `causes=container{(none) @11:30pm=5  (none) @12:30am=3}`. `(none)` is
 * hook-internal state, and `isHeaderOver` was the only one left.
 *
 * Its bar shows for 5 of the 7 types the header ACCEPTS, so the type test moved
 * to CSS rather than narrowing `accepts` — narrowing that would stop
 * module/artifact drops landing on the header, a behaviour change to fix a
 * render. That is why `data-drag-type` exists: `data-drag-kind` collapses all
 * seven into "leaf".
 */
describe("the container header uses the attribute path too", () => {
  const jsx = src("modules/ModuleContainer.jsx");
  const css = src("index.css").replace(/\/\*[\s\S]*?\*\//g, "");
  const provider = src("helpers/DragProvider.jsx");

  it("opts in and stops destructuring isOver", () => {
    const hook = jsx.match(/const \{[^}]*\} = useDroppable\(\{\s*type: "container-header"[\s\S]*?\}\);/)?.[0] || "";
    expect(hook).toMatch(/overAsAttribute:\s*true/);
    expect(hook).not.toMatch(/isOver/);
  });

  it("mounts the bar on the render-time condition only", () => {
    expect(jsx).toMatch(/items\.length > 0 && \(\s*<div className="drop-indicator drop-indicator-insert drop-indicator-insert--auto"/);
    expect(jsx).not.toMatch(/isHeaderOver/);
  });

  it("DragProvider stamps the exact type exactly ONCE, and clears it", () => {
    // The stamp is PRE-EXISTING — I added a duplicate before noticing, and the
    // A/B removing mine changed nothing, which is how I found out. Counting is
    // what makes this test discriminate: without the stamp the CSS matches
    // nothing and the affordance is free AND invisible, and with two of them
    // the next reader deletes the "spare" one.
    expect(provider.match(/dataset\.dragType\s*=/g) || []).toHaveLength(1);
    expect(provider.match(/delete document\.body\.dataset\.dragType/g) || []).toHaveLength(1);
  });

  it("CSS shows it for exactly the five types, and hides it by default", () => {
    expect(css).toMatch(/\.drop-indicator-insert--auto\s*\{\s*display:\s*none/);
    for (const t of ["instance", "external", "file", "text", "url"]) {
      expect(css).toMatch(new RegExp(`body\\[data-drag-type="${t}"\\][^{]*\\.drop-indicator-insert--auto`));
    }
    // module/artifact are ACCEPTED as drops but must not draw the bar — that
    // asymmetry is the whole reason the test lives here.
    for (const t of ["module", "artifact"]) {
      expect(css).not.toMatch(new RegExp(`body\\[data-drag-type="${t}"\\][^{]*\\.drop-indicator-insert--auto`));
    }
  });
});
