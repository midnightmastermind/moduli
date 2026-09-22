// __tests__/manualOpRun.test.js
//
// Running an operation by hand — the trigger widget on a row, or a
// `button`-type field — dropped every real effect on the floor. Both surfaces
// did this:
//
//     const displayUpdates = updates.filter(u => !u._effect);
//     if (displayUpdates.length > 0) dispatch(setComputedValuesAction(displayUpdates));
//
// so CREATE_ITEM / UPDATE_ITEM_FIELD / DELETE_ITEM / NOTIFY were computed and
// then discarded. Measured on prod 2026-09-21: an operation whose only step is
// CREATE, bound to a row as a "Run: Log a Glass" widget, ran on click and left
// the grid unchanged — no row, no error, nothing in the log.
import { describe, it, expect, vi, beforeEach } from "vitest";

const applyEffect = vi.fn();
vi.mock("../state/bindSocketToStore", () => ({ operationsBridge: { applyEffect: (...a) => applyEffect(...a) } }));

import { applyManualOpUpdates } from "../helpers/manualOpRun";

beforeEach(() => vi.clearAllMocks());

describe("a hand-run operation's effects are applied", () => {
  it("applies a CREATE_ITEM effect", () => {
    const dispatch = vi.fn();
    const eff = { _effect: "CREATE_ITEM", module: { id: "m1" }, occurrence: { id: "o1" } };
    const out = applyManualOpUpdates([eff], { dispatch });
    expect(applyEffect).toHaveBeenCalledWith(eff);
    expect(out.effects).toBe(1);
  });

  it("applies every effect, not just the first", () => {
    const dispatch = vi.fn();
    applyManualOpUpdates([
      { _effect: "CREATE_ITEM" }, { _effect: "UPDATE_ITEM_FIELD" }, { _effect: "NOTIFY" },
    ], { dispatch });
    expect(applyEffect).toHaveBeenCalledTimes(3);
  });

  it("still dispatches the display updates alongside them", () => {
    // The CONTROL for the half that always worked: "effects are applied" must
    // not be satisfied by a version that stopped publishing computed values.
    const dispatch = vi.fn();
    const out = applyManualOpUpdates([
      { fieldId: "f1", value: 3 },
      { _effect: "CREATE_ITEM" },
    ], { dispatch });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ display: 1, effects: 1 });
  });

  it("does not dispatch when there is nothing to display", () => {
    const dispatch = vi.fn();
    applyManualOpUpdates([{ _effect: "CREATE_ITEM" }], { dispatch });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("skips a _suspend sentinel — it is a continuation, not an effect", () => {
    // Same rule the socket path follows; applying one would try to persist a
    // GET_USER_INPUT / CALL_API marker.
    const dispatch = vi.fn();
    applyManualOpUpdates([{ _effect: "CALL_API", _suspend: true }], { dispatch });
    expect(applyEffect).not.toHaveBeenCalled();
  });

  it("is a no-op on an empty run", () => {
    const dispatch = vi.fn();
    expect(applyManualOpUpdates([], { dispatch })).toEqual({ display: 0, effects: 0 });
    expect(dispatch).not.toHaveBeenCalled();
    expect(applyEffect).not.toHaveBeenCalled();
  });
});

describe("both hand-run surfaces go through the one helper", () => {
  // Source guards: each site lives in a component that needs the whole grid to
  // mount, and the defect was a one-line filter in each. Pinning the CALL is
  // what stops one of the two drifting back.
  const read = (p) => require("node:fs").readFileSync(require("node:path").join(__dirname, p), "utf8");

  it("the instance trigger widget calls applyManualOpUpdates", () => {
    expect(read("../modules/ModuleInstance.jsx")).toMatch(/applyManualOpUpdates\(/);
  });

  it("the button field calls applyManualOpUpdates", () => {
    expect(read("../ui/Field.jsx")).toMatch(/applyManualOpUpdates\(/);
  });

  it("neither still filters the effects out by hand", () => {
    for (const p of ["../modules/ModuleInstance.jsx", "../ui/Field.jsx"]) {
      expect(read(p), `${p} still drops effects with a !u._effect filter`)
        .not.toMatch(/filter\(\s*u\s*=>\s*!u\._effect\s*\)/);
    }
  });
});
