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
