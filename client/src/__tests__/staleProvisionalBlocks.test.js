/**
 * staleProvisionalBlocks.test.js
 *
 * The user's spec, stated directly: "each click should, negate the last empty
 * textblock, and then focus on a new textblock."
 *
 * The policy is one line; the POSITIONS are the part that is easy to get wrong,
 * so that is what these pin — above all the descending order, without which a
 * plan invalidates its own later entries the moment the caller applies it.
 */
import { describe, test, expect, vi } from "vitest";
import { planStaleCollapses } from "../helpers/staleProvisionalBlocks";

// A stand-in for a ProseMirror doc: `descendants(fn)` over a flat block list.
// Sizes differ deliberately so a position bug cannot hide behind uniform nodes.
function docOf(blocks) {
  return {
    descendants(fn) {
      let pos = 0;
      for (const b of blocks) {
        fn({ type: { name: b.type }, attrs: { occurrenceId: b.id }, nodeSize: b.size }, pos);
        pos += b.size;
      }
    },
  };
}
const pendingOf = (...ids) => (id) => ids.includes(id);

describe("planStaleCollapses", () => {
  test("collapses every OTHER provisional block, never the one just minted", () => {
    const doc = docOf([
      { type: "instanceTextblock", id: "a", size: 1 },
      { type: "paragraph", id: null, size: 3 },
      { type: "instanceTextblock", id: "b", size: 1 },
      { type: "instanceTextblock", id: "new", size: 1 },
    ]);
    const plan = planStaleCollapses(doc, "new", pendingOf("a", "b", "new"));
    expect(plan.map((p) => p.id)).toEqual(["b", "a"]);
  });

  // THE ONE THAT MATTERS. Applying a plan top-down shifts every position after
  // the first edit; descending, each edit only moves what the caller has already
  // consumed.
  test("is ordered DESCENDING by position", () => {
    const doc = docOf([
      { type: "instanceTextblock", id: "a", size: 1 },   // pos 0
      { type: "instanceTextblock", id: "b", size: 5 },   // pos 1
      { type: "instanceTextblock", id: "c", size: 2 },   // pos 6
      { type: "instanceTextblock", id: "new", size: 1 }, // pos 8
    ]);
    const plan = planStaleCollapses(doc, "new", pendingOf("a", "b", "c", "new"));
    expect(plan.map((p) => p.pos)).toEqual([6, 1, 0]);
    for (let i = 1; i < plan.length; i++) expect(plan[i].pos).toBeLessThan(plan[i - 1].pos);
  });

  test("carries each block's own size, not a shared one", () => {
    const doc = docOf([
      { type: "instanceTextblock", id: "a", size: 4 },
      { type: "instanceTextblock", id: "new", size: 1 },
    ]);
    expect(planStaleCollapses(doc, "new", pendingOf("a", "new"))[0]).toEqual({ pos: 0, size: 4, id: "a" });
  });

  // A COMMITTED block is the user's writing. Nothing here may touch it — and
  // "the registry no longer holds it" is the only signal that says so.
  test("never collapses a block the user typed into", () => {
    const doc = docOf([
      { type: "instanceTextblock", id: "typed", size: 1 },
      { type: "instanceTextblock", id: "new", size: 1 },
    ]);
    expect(planStaleCollapses(doc, "new", pendingOf("new"))).toEqual([]);
  });

  test("leaves paragraphs and other block types alone", () => {
    const doc = docOf([
      { type: "paragraph", id: null, size: 2 },
      { type: "moduleEmbed", id: "emb", size: 1 },
      { type: "instanceTextblock", id: "new", size: 1 },
    ]);
    expect(planStaleCollapses(doc, "new", pendingOf("emb", "new"))).toEqual([]);
  });

  // ProseMirror's schema repair inserts a default moduleEmbed/instanceTextblock
  // with occurrenceId "" — the documented `embed: missing` filler. Not ours.
  test("ignores a node carrying no occurrenceId", () => {
    const doc = docOf([
      { type: "instanceTextblock", id: "", size: 1 },
      { type: "instanceTextblock", id: "new", size: 1 },
    ]);
    const isPending = vi.fn(() => true);
    expect(planStaleCollapses(doc, "new", isPending)).toEqual([]);
    expect(isPending).not.toHaveBeenCalledWith("");
  });

  test("is inert for a missing doc or a missing predicate", () => {
    expect(planStaleCollapses(null, "new", pendingOf("a"))).toEqual([]);
    expect(planStaleCollapses(docOf([]), "new", null)).toEqual([]);
  });
});

// ── THE WIRING, WHICH NO TEST CAN MOUNT ────────────────────────────────────
//
// `DocContent`'s mint needs the whole grid store, so the planner above is where
// the decision is testable. Two things it cannot see are exactly the two that
// were wrong, so a source guard pins both.
import { readFileSync } from "fs";
import { resolve } from "path";

describe("DocContent's mint implements the spec", () => {
  const src = readFileSync(resolve(__dirname, "../modules/DocContent.jsx"), "utf-8");

  test("the collapse is wired", () => {
    expect(mintBody).toContain("planStaleCollapses");
  });

  // ORDERING. `requestTextblockFocus` must precede the dispatch that inserts the
  // block: dispatching runs handlers synchronously and the sub-editor claims the
  // caret in its own onCreate, so a claim made afterwards can arrive too late —
  // and an unfocused block never blurs, so it never vanishes.
  // SCOPED TO THE MINT'S OWN BODY. A bare `src.indexOf` matches the AUTO-CREATE
  // path's claim, which sits earlier in the file and before every dispatch — so
  // the assertion passed against the defect it exists to catch. Caught by A/B.
  const mintBody = (() => {
    const a = src.indexOf("const handleCaretMintTextblock");
    const b = src.indexOf("mintLedgerRef.current.add(occId, cancel)", a);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    return src.slice(a, b);
  })();

  test("the caret is claimed BEFORE the insert is dispatched", () => {
    const claim = mintBody.indexOf("requestTextblockFocus(occId)");
    const dispatch = mintBody.indexOf('mintStep("replaceLine"');
    expect(claim).toBeGreaterThan(-1);
    expect(dispatch).toBeGreaterThan(-1);
    expect(claim).toBeLessThan(dispatch);
  });

  // The collapse must be planned against the TRANSACTION's doc, not the editor's
  // pre-edit state — the new block has to be in it, or the planner cannot tell
  // which block to keep.
  test("the collapse is planned against the transaction's doc", () => {
    expect(mintBody).toMatch(/planStaleCollapses\(\s*tr\.doc/);
  });

  // The CONTROL: without it, every assertion above also passes against a file
  // whose mint path was deleted outright.
  test("the mint path is still there", () => {
    expect(src).toContain("handleCaretMintTextblock");
    expect(src).toContain("registerProvisionalTextblock");
  });
});
