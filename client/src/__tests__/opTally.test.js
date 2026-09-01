// `bumpOpRun` fires once per runMatchingOperations — a whole SWEEP over every
// operation, not one op. A 14-second scroll reported `runs:2 ms:2563` with no
// way to tell a load-tail sweep from a scheduler tick landing mid-gesture.
import { describe, it, expect } from "vitest";
import { bumpOpRun, snapshotOps, diffOps } from "../helpers/renderProbe";

describe("op sweep tally — attributed by trigger", () => {
  it("splits the sweeps by what set them off", () => {
    const before = snapshotOps();
    bumpOpRun(1200, "load");
    bumpOpRun(1363, "load");
    bumpOpRun(40, "occurrence_updated");
    const d = diffOps(before);
    expect(d.runs).toBe(3);
    expect(d.ms).toBe(2603);
    expect(d.by.load).toEqual({ runs: 2, ms: 2563 });
    expect(d.by.occurrence_updated).toEqual({ runs: 1, ms: 40 });
  });

  it("reports only triggers that fired IN the window", () => {
    // The control. The tallies are process-global and monotonic, so a diff that
    // leaked earlier labels would attribute a previous burst's sweeps to this
    // one — which is the whole point of taking a diff.
    bumpOpRun(10, "navigation");
    const before = snapshotOps();
    bumpOpRun(20, "load");
    const d = diffOps(before);
    expect(Object.keys(d.by)).toEqual(["load"]);
  });

  it("counts an unlabelled sweep rather than dropping it", () => {
    const before = snapshotOps();
    bumpOpRun(5);
    const d = diffOps(before);
    expect(d.runs).toBe(1);
    expect(d.by["?"]).toEqual({ runs: 1, ms: 5 });
  });
});

// ROLLUP EMITS THIS HELPER INTO MORE THAN ONE CHUNK — 4 of them carry
// `__renderAttrs`. With the tallies in module scope each copy keeps its own and
// each overwrites the same window globals, so the reader can be a different
// instance than the one the components write to. `loadDiag` has kept its state
// on `window` since 2026-08-06 after exactly this reported "0 editor mounts on
// a grid with 241 rows".
describe("the probe store is shared, not per-chunk", () => {
  it("lives on window so a second copy of the module sees the same counters", async () => {
    expect(window.__moduliRenderStore, "the store is not on window").toBeTruthy();
    const before = snapshotOps();
    bumpOpRun(7, "load");
    // What a second chunk copy would read: the same object, not its own.
    expect(window.__moduliRenderStore.ops.runs - before.runs).toBe(1);
    expect(window.__moduliRenderStore.ops.by.load).toBeTruthy();
  });

  it("keeps the render tally there too", () => {
    expect(window.__moduliRenderStore.tally).toBeTruthy();
    expect(window.__moduliRenderStore.attrs).toBeTruthy();
  });
});
