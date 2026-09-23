// A CONTAINER DRAG SHOWS WHERE IT WILL LAND.
//
// USER, 2026-09-23: *"the highlights for dropping places should be in between
// those containers too (and before and after), so i should be able to drop
// outside of those containers"* → *"i see no highlight lines for dropping
// containers"*.
//
// Two things were missing and only together do they produce a line:
//
//   1. DragProvider drew NOTHING for a container drag — it left the cue to
//      `useDragDrop`'s closestEdge bars, which appear only while the pointer is
//      OVER a container. The gap BETWEEN two, and the space before the first
//      and after the last, showed nothing.
//   2. Even asked, the line had no members to measure: `collectMemberCards`
//      keys on `[data-container-id]` ownership, and a PAGE carries
//      `data-page-occ-id`, so a page came back with zero members.
//
// This file covers (2), which is the pure half. (1) is a branch inside
// DragProvider's rAF hover handler — it needs a live drag session to reach, so
// it is pinned by a source guard and verified by dragging in a browser.
import { describe, it, expect, beforeEach } from "vitest";
import { collectMemberCards } from "../helpers/dragHitTesting";

function build(html) {
  document.body.innerHTML = html;
  return document.body;
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("collectMemberCards on a PAGE", () => {
  it("returns the page's TOP-LEVEL containers", () => {
    build(`
      <div id="page" data-page-occ-id="p1">
        <div data-container-id="creative">
          <div data-container-id="nested-inside-creative"></div>
        </div>
        <div data-container-id="environmental"></div>
      </div>`);
    const cards = collectMemberCards(document.getElementById("page"));
    expect(cards.map(c => c.getAttribute("data-container-id"))).toEqual(["creative", "environmental"]);
  });

  it("does NOT include a container nested inside another", () => {
    // The nested one is the Routines case — "Mr Brews Taphouse" inside
    // Creative. A line drawn at its edge would promise a page-level position
    // that does not exist there.
    build(`
      <div id="page" data-page-occ-id="p1">
        <div data-container-id="creative"><div data-container-id="brews"></div></div>
      </div>`);
    const ids = collectMemberCards(document.getElementById("page"))
      .map(c => c.getAttribute("data-container-id"));
    expect(ids).toEqual(["creative"]);
    expect(ids).not.toContain("brews");
  });

  it("ignores containers belonging to a page rendered INSIDE this one", () => {
    build(`
      <div id="outer" data-page-occ-id="outer">
        <div data-container-id="mine"></div>
        <div data-page-occ-id="inner"><div data-container-id="theirs"></div></div>
      </div>`);
    const ids = collectMemberCards(document.getElementById("outer"))
      .map(c => c.getAttribute("data-container-id"));
    expect(ids).toEqual(["mine"]);
  });

  it("a CONTAINER still collects its own rows and nested shells (the control)", () => {
    // Without this, "a page returns its containers" is equally satisfied by a
    // change that broke the original behaviour for every leaf drag.
    build(`
      <div id="c" data-container-id="c">
        <div class="instance-wrap" id="r1"></div>
        <div data-container-id="sub"></div>
        <div data-container-id="other"><div class="instance-wrap" id="deep"></div></div>
      </div>`);
    const el = document.getElementById("c");
    const cards = collectMemberCards(el);
    expect(cards).toContain(document.getElementById("r1"));
    expect(cards.map(c => c.getAttribute?.("data-container-id")).filter(Boolean)).toEqual(["sub", "other"]);
    expect(cards).not.toContain(document.getElementById("deep"));
  });

  it("an empty page has no members rather than throwing", () => {
    build(`<div id="page" data-page-occ-id="p1"></div>`);
    expect(collectMemberCards(document.getElementById("page"))).toEqual([]);
  });
});

describe("DragProvider asks for the line on a container drag", () => {
  const src = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../helpers/DragProvider.jsx"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("has a CONTAINER branch that draws indicators", () => {
    expect(code).toMatch(/else if \(t === DragType\.CONTAINER\)/);
    const at = code.indexOf("else if (t === DragType.CONTAINER)");
    expect(code.slice(at, at + 500)).toContain("showDropIndicators(");
  });

  it("resolves the PAGE under the pointer", () => {
    const at = code.indexOf("else if (t === DragType.CONTAINER)");
    expect(code.slice(at, at + 500)).toContain('closest?.("[data-page-occ-id]")');
  });

  it("draws the LINE ONLY — never a box around the whole page", () => {
    const at = code.indexOf("else if (t === DragType.CONTAINER)");
    expect(code.slice(at, at + 500)).toMatch(/showDropIndicators\(el, clientX, clientY, false\)/);
  });
});

// ── A LEAF AIMED AT THE PAGE ──────────────────────────────────────────────
//
// USER, 2026-09-23: *"anything can land page level"* / *"i meant the hover line
// on where it can drop"*. The line is drawn from `computeInsertIndexFromPointer`
// and the DROP places from the same number, so the helper has to resolve a PAGE
// element — which carries `data-page-occ-id` and NOT `data-occ-id`. Until it
// did, the helper returned null for a page and the caller appended: the line
// would sit between two containers and the row would land at the end.
describe("computeInsertIndexFromPointer on a PAGE", () => {
  // jsdom gives every element a zero rect, so the cards are stubbed with the
  // geometry a real stacked page has.
  function stubRects(spec) {
    for (const [id, r] of Object.entries(spec)) {
      const el = document.querySelector(`[data-container-id="${id}"]`);
      el.getBoundingClientRect = () => ({ top: r[0], bottom: r[1], left: 0, right: 700,
        width: 700, height: r[1] - r[0], x: 0, y: r[0] });
    }
  }
  const PAGE_HTML = `
      <div data-page-occ-id="p1">
        <div data-container-id="m-today" data-occ-id="today"></div>
        <div data-container-id="m-week" data-occ-id="week"></div>
      </div>`;
  const pageOcc = { id: "p1", moduleId: "m-page", occurrences: ["today", "week"] };

  it("resolves the page and indexes BEFORE the first container", async () => {
    const { computeInsertIndexFromPointer } = await import("../helpers/dragHitTesting");
    build(PAGE_HTML);
    stubRects({ "m-today": [100, 200], "m-week": [200, 300] });
    expect(computeInsertIndexFromPointer(pageOcc, { x: 350, y: 110 })).toBe(0);
  });

  it("indexes BETWEEN the two containers", async () => {
    const { computeInsertIndexFromPointer } = await import("../helpers/dragHitTesting");
    build(PAGE_HTML);
    stubRects({ "m-today": [100, 200], "m-week": [200, 300] });
    expect(computeInsertIndexFromPointer(pageOcc, { x: 350, y: 205 })).toBe(1);
  });

  it("indexes AFTER the last container", async () => {
    const { computeInsertIndexFromPointer } = await import("../helpers/dragHitTesting");
    build(PAGE_HTML);
    stubRects({ "m-today": [100, 200], "m-week": [200, 300] });
    expect(computeInsertIndexFromPointer(pageOcc, { x: 350, y: 295 })).toBe(2);
  });

  it("returns null for a page that is not in the DOM (caller appends)", async () => {
    const { computeInsertIndexFromPointer } = await import("../helpers/dragHitTesting");
    build(`<div></div>`);
    expect(computeInsertIndexFromPointer(pageOcc, { x: 1, y: 1 })).toBe(null);
  });
});

describe("DragProvider draws the line for a LEAF over a page", () => {
  // Comments are STRIPPED before matching: an anchor that lives in a comment
  // would keep passing against a file whose code had been deleted.
  const src = require("node:fs").readFileSync(
    require("node:path").resolve(__dirname, "../helpers/DragProvider.jsx"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("falls back to the page when no container resolves", () => {
    const at = code.indexOf("const pageEl =");
    expect(at).toBeGreaterThan(-1);
    expect(code.slice(at, at + 400)).toContain('closest?.("[data-page-occ-id]")');
    expect(code.slice(at, at + 400)).toMatch(/showDropIndicators\(pageEl, clientX, clientY, false\)/);
  });

  it("still hides the indicators when there is no page either (the control)", () => {
    const at = code.indexOf("const pageEl =");
    expect(code.slice(at, at + 400)).toMatch(/else hideDropIndicators\(\)/);
  });

  it("draws the LINE ONLY for a page — never a box (the control)", () => {
    const at = code.indexOf("const pageEl =");
    // a `true` fourth argument would outline the whole page surface
    expect(code.slice(at, at + 400)).not.toMatch(/showDropIndicators\(pageEl, clientX, clientY, true\)/);
  });
});
