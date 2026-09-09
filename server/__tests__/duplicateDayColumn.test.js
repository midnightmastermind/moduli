// server/__tests__/duplicateDayColumn.test.js
//
// `0317` deletes subtrees on live data and had NO tests. On 2026-09-09 it
// destroyed the grid's one shared `Emotions Wheel` — multi-parented into every
// day column by `0297` — because it was a child of a doomed duplicate, and its
// unlink pulled the id from EVERY parent before the delete. It also could not
// see a duplicate the parent did not list, so one survived the same repair.
//
// Both rules are pinned here against the pure planner.
import { describe, it, expect } from "vitest";
import { planDuplicateRemoval } from "../migrations/0317-one-day-page-column-per-day.mjs";

const occ = (id, over = {}) => ({ id, label: id, parentId: null, occurrences: [], textmap: null, ...over });
// A node whose CALLER declared the signature as its identity — what
// APPLY_TEMPLATE stamps for `rootSignature`. Uniqueness is opt-in (`0303`).
const col = (id, parentId, sig, over = {}) =>
  occ(id, { parentId, identitySignature: sig, meta: { signatureUnique: true }, ...over });

const SIG = "daypage:col:2026-09-09";

describe("0317 — a doomed column owns only what nothing else lists", () => {
  it("SPARES a child that a surviving parent also lists, and never unlinks it", () => {
    // THE REGRESSION. `wheel` is listed by the doomed column AND by a column
    // that is staying. Deleting it is data loss; so is pulling it out of the
    // survivor. (A/B'd: without the shared-child rule it lands in removeIds.)
    const board = occ("board", { occurrences: ["keep", "dup"] });
    const keep = col("keep", "board", SIG, { occurrences: ["wheel", "k1", "k2"] });
    const dup  = col("dup",  "board", SIG, { occurrences: ["wheel"] });
    const wheel = occ("wheel", { parentId: "tpl" });
    const plan = planDuplicateRemoval({ occurrences: [board, keep, dup, wheel, occ("k1"), occ("k2")] });

    expect(plan.doomed).toHaveLength(1);
    const d = plan.doomed[0];
    expect(d.occ.id).toBe("dup");
    expect(d.removeIds).toEqual(["dup"]);          // the column, and nothing else
    expect(d.removeIds).not.toContain("wheel");
    expect(d.sparedIds).toContain("wheel");
  });

  it("still removes a child NOTHING else lists — the control", () => {
    // Without this, "spares shared children" is also satisfied by a planner
    // that never deletes any child at all.
    const board = occ("board", { occurrences: ["keep", "dup"] });
    const keep = col("keep", "board", SIG, { occurrences: ["k1", "k2"] });
    const dup  = col("dup",  "board", SIG, { occurrences: ["own"] });
    const plan = planDuplicateRemoval({
      occurrences: [board, keep, dup, occ("own", { parentId: "dup" }), occ("k1"), occ("k2")] });
    expect(plan.doomed[0].removeIds.sort()).toEqual(["dup", "own"]);
    expect(plan.doomed[0].sparedIds).toEqual([]);
  });

  it("a SPARED node keeps its own subtree", () => {
    // 2026-08-11's rule. Deleting a spared node's children would strand the
    // node it was spared to protect.
    const board = occ("board", { occurrences: ["keep", "dup"] });
    const keep = col("keep", "board", SIG, { occurrences: ["shared", "k1"] });
    const dup  = col("dup",  "board", SIG, { occurrences: ["shared"] });
    const shared = occ("shared", { occurrences: ["grand"] });
    const plan = planDuplicateRemoval({
      occurrences: [board, keep, dup, shared, occ("grand"), occ("k1")] });
    expect(plan.doomed[0].removeIds).toEqual(["dup"]);
    expect(plan.doomed[0].sparedIds.sort()).toEqual(["grand", "shared"]);
  });
});

describe("0317 — a duplicate nobody lists is still a duplicate", () => {
  it("finds a column that is PARENTED but never listed", () => {
    // THE BLIND SPOT. Grouping only by what a parent lists made this invisible,
    // and one survived the 2026-09-09 repair because of it.
    const board = occ("board", { occurrences: ["listed"] });
    const listed   = col("listed",   "board", SIG, { occurrences: ["a", "b"] });
    const unlisted = col("unlisted", "board", SIG, { occurrences: ["c"] });
    const plan = planDuplicateRemoval({
      occurrences: [board, listed, unlisted, occ("a"), occ("b"), occ("c", { parentId: "unlisted" })] });
    expect(plan.doomed.map((d) => d.occ.id)).toEqual(["unlisted"]);
  });

  it("keeps the LISTED column even when the unlisted one has more children", () => {
    // The listing is what renders, so an unlisted column must never win on a
    // child count alone — that would delete the one you can actually see.
    const board = occ("board", { occurrences: ["listed"] });
    const listed   = col("listed",   "board", SIG, { occurrences: ["a"] });
    const unlisted = col("unlisted", "board", SIG, { occurrences: ["c", "d", "e"] });
    const plan = planDuplicateRemoval({
      occurrences: [board, listed, unlisted, occ("a"),
        occ("c", { parentId: "unlisted" }), occ("d", { parentId: "unlisted" }), occ("e", { parentId: "unlisted" })] });
    expect(plan.decisions[0].keep).toBe("listed");
    expect(plan.doomed.map((d) => d.occ.id)).toEqual(["unlisted"]);
  });
});

describe("0317 — the narrowings that keep it from being data loss", () => {
  it("never groups a signature that is a shared MARKER rather than an identity", () => {
    // `0303`'s line: uniqueness is OPT-IN. Keyed on the signature alone this
    // matched the seven weekday templates and proposed deleting 400+ rows.
    const tpl = occ("tpl", { occurrences: ["m", "t"] });
    const mon = occ("m", { parentId: "tpl", identitySignature: "day-container" });
    const tue = occ("t", { parentId: "tpl", identitySignature: "day-container" });
    expect(planDuplicateRemoval({ occurrences: [tpl, mon, tue] }).doomed).toEqual([]);
  });

  it("refuses when MORE THAN ONE duplicate holds writing", () => {
    const withText = (id, parentId, words) => col(id, parentId, SIG,
      { textmap: { type: "doc", content: [{ type: "text", text: words }] } });
    const board = occ("board", { occurrences: ["x", "y"] });
    const plan = planDuplicateRemoval({
      occurrences: [board, withText("x", "board", "a journal entry"), withText("y", "board", "another one")] });
    expect(plan.doomed).toEqual([]);
    expect(plan.decisions[0].skipped).toMatch(/hold writing/);
  });

  it("keeps whichever holds writing, whatever its child count", () => {
    const board = occ("board", { occurrences: ["empty", "written"] });
    const empty = col("empty", "board", SIG, { occurrences: ["a", "b", "c"] });
    const written = col("written", "board", SIG,
      { textmap: { type: "doc", content: [{ type: "text", text: "today I" }] } });
    const plan = planDuplicateRemoval({
      occurrences: [board, empty, written, occ("a"), occ("b"), occ("c")] });
    expect(plan.decisions[0].keep).toBe("written");
  });

  it("a lone column is never a duplicate", () => {
    const board = occ("board", { occurrences: ["only"] });
    expect(planDuplicateRemoval({ occurrences: [board, col("only", "board", SIG)] }).doomed).toEqual([]);
  });
});
