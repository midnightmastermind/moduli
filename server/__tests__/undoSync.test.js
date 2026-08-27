// An undo must tell the client what changed — cheaply, and without lying.
//
// Undoing one checkbox took ~26s to settle: the handler re-read all 21,039
// occurrences into the cache and then made the client re-hydrate the whole
// grid, which re-ran the op sweep and wrote ~30 occurrences back. This planner
// is the decision that replaces it, and the property that matters is which way
// it fails: an incremental apply that is WRONG leaves the user staring at stale
// state believing their undo did nothing, while a needless full reload is only
// slow. So every doubt returns `incremental: false`.

import { describe, it, expect } from "vitest";
import { planUndoSync, CACHE_KEY_BY_MODEL } from "../utils/undoSync.js";

const restored = (model, id) => ({ type: "restored", model, id, doc: { id } });

describe("planUndoSync", () => {
  it("patches an ordinary restore", () => {
    const p = planUndoSync([restored("occurrence", "a"), restored("module", "m")]);
    expect(p.incremental).toBe(true);
    expect(p.docs).toEqual([
      { model: "occurrence", id: "a", doc: { id: "a" } },
      { model: "module", id: "m", doc: { id: "m" } },
    ]);
  });

  it("carries a DELETE as a null document rather than dropping it", () => {
    // A transaction that undoes a create must remove the row. Omitting it here
    // would leave a document on screen that no longer exists.
    const p = planUndoSync([{ type: "deleted", model: "occurrence", id: "gone" }]);
    expect(p.incremental).toBe(true);
    expect(p.docs).toEqual([{ model: "occurrence", id: "gone", doc: null }]);
  });

  it("REFUSES a grid restore — it fans out past a keyed patch", () => {
    // Grid state carries filters, layout and the panel tree at once.
    const p = planUndoSync([restored("occurrence", "a"), restored("grid", "g")]);
    expect(p.incremental).toBe(false);
    // The SPECIFIC refusal, not the generic one. `/grid/` alone passes against
    // a version with this guard deleted, because "grid" is absent from
    // CACHE_KEY_BY_MODEL and the unknown-model check catches it with a message
    // that also contains the word — an A/B caught that on the first try.
    // Naming the reason is what makes the deliberate refusal testable at all.
    expect(p.reason).toBe("grid restored");
  });

  it("REFUSES a model it cannot place", () => {
    expect(planUndoSync([restored("wormhole", "x")]).incremental).toBe(false);
  });

  it("REFUSES a snapshot with no id, and one with no document", () => {
    expect(planUndoSync([{ type: "restored", model: "occurrence", doc: {} }]).incremental).toBe(false);
    expect(planUndoSync([{ type: "restored", model: "occurrence", id: "a" }]).incremental).toBe(false);
  });

  it("REFUSES an empty restore — there is nothing to publish", () => {
    expect(planUndoSync([]).incremental).toBe(false);
    expect(planUndoSync(null).incremental).toBe(false);
  });

  it("ONE bad snapshot condemns the whole set, not just itself", () => {
    // Applying the good half and silently skipping the rest is the worst
    // outcome: a partial undo looks like a successful one.
    const p = planUndoSync([restored("occurrence", "a"), restored("grid", "g"), restored("field", "f")]);
    expect(p.incremental).toBe(false);
  });

  it("every model it accepts has a cache map to be patched into", () => {
    // The control on the table itself: a model the planner passes but the cache
    // cannot hold would be applied on the client and stale on the server.
    for (const model of Object.keys(CACHE_KEY_BY_MODEL)) {
      expect(planUndoSync([restored(model, "x")]).incremental).toBe(true);
    }
    expect(CACHE_KEY_BY_MODEL.grid).toBeUndefined();
  });
});
