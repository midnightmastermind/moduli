// The executor keeps TWO views of the world and different emitters patch
// different ones: `context.occurrencesById` (the live-store overlay a merge
// reads its target through) and `$vars.$allOccurrences` + the role slices (what
// a FIND iterates). `listChildInOverlays` is the one place that grows a
// parent's child list, so the two cannot disagree about what a parent holds.
//
// The defect it was extracted for is pinned in `mergedTemplateLayers.test.js`
// (two template layers sharing a 7:00am slot). What is pinned HERE is the half
// that test does not discriminate: a parent present only in `$vars`, which the
// previous adoption write skipped entirely because its guard read
// `occurrencesById[parentId]` and nothing else.
import { describe, it, expect } from "vitest";
import { listChildInOverlays } from "../helpers/operationActions";

describe("listChildInOverlays", () => {
  it("grows the list in the occurrencesById overlay", () => {
    const occ = { p: { id: "p", occurrences: ["a"] } };
    const $vars = {};
    expect(listChildInOverlays("p", "b", occ, $vars)).toEqual(["a", "b"]);
    expect(occ.p.occurrences).toEqual(["a", "b"]);
  });

  it("grows a parent that lives ONLY in $vars — the case the old guard skipped", () => {
    // A same-pipeline clone is published into $vars and never into
    // occurrencesById, so a later merge whose parent IS that clone resolves it
    // here and nowhere else.
    const occ = {};
    const parent = { id: "p", role: "container", occurrences: ["a"] };
    const $vars = { $allOccurrences: [parent], $allContainers: [parent], $allItems: [parent] };
    expect(listChildInOverlays("p", "b", occ, $vars)).toEqual(["a", "b"]);
    expect($vars.$allOccurrences[0].occurrences).toEqual(["a", "b"]);
    // The role slices must move together, or a role-filtered FIND reads a
    // different child list than an unfiltered one.
    expect($vars.$allContainers[0].occurrences).toEqual(["a", "b"]);
    expect($vars.$allItems[0].occurrences).toEqual(["a", "b"]);
  });

  it("occurrencesById WINS when a parent is in both — the merge's own precedence", () => {
    // `parentOcc` resolves `occurrencesById[id] || $vars…find(id)`. If this
    // helper preferred the other one, a read and the write built from it would
    // describe different parents.
    const occ = { p: { id: "p", occurrences: ["live"] } };
    const $vars = { $allOccurrences: [{ id: "p", occurrences: ["stale"] }] };
    expect(listChildInOverlays("p", "b", occ, $vars)).toEqual(["live", "b"]);
  });

  it("is idempotent — a child already listed is not appended twice", () => {
    const occ = { p: { id: "p", occurrences: ["a"] } };
    expect(listChildInOverlays("p", "a", occ, {})).toEqual(["a"]);
    expect(occ.p.occurrences).toEqual(["a"]);
  });

  it("returns null for a parent in NEITHER overlay, and that is not a failure", () => {
    // A clone's own freshly-minted parent is created carrying its children
    // inline, so there is no list to grow. Callers fall back rather than throw.
    expect(listChildInOverlays("nope", "b", {}, {})).toBe(null);
    expect(listChildInOverlays(null, "b", { p: {} }, {})).toBe(null);
    expect(listChildInOverlays("p", null, { p: {} }, {})).toBe(null);
  });

  it("treats a parent with no occurrences[] as empty rather than throwing", () => {
    const occ = { p: { id: "p" } };
    expect(listChildInOverlays("p", "b", occ, {})).toEqual(["b"]);
  });
});
