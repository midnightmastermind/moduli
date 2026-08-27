// A WRITE WITH NO USER BEHIND IT IS NOT AN UNDO STEP.
//
// `derived = !actionId` (server/utils/txRecorder.js:162) is the ONLY rule, and
// every write helper opens its own action — so the load sweep, the scheduler
// and feed sync each turned their own bookkeeping into undo steps.
//
// MEASURED ON THE LIVE GRID, a page load with NOTHING clicked, twice, the
// second immediately after the first with nothing changed in between:
//
//                              load A    load B
//   transactions written         55        52
//   ON THE UNDO STACK            29        26     <- Ctrl+Z pops one of these
//   derived                       0         0
//   distinct action ids          29        26
//   occurrences touched           6         2     -> the tracker tiles
//
// So after any reload Ctrl+Z reverted a tracker recomputation instead of the
// last thing the user did. Load B is the control that rules out "the sweep was
// catching up on stale state".
import { describe, it, expect, beforeEach } from "vitest";
import {
  beginAction, endAction, withAction, getActionId, runDerived, isDerived,
  captureAction, runInAction, retainAction, releaseAction, setActionCloseHook,
  _resetActionScope,
} from "../helpers/actionScope";

beforeEach(() => _resetActionScope());

describe("a derived scope produces no action id", () => {
  it("beginAction inside it mints NOTHING", () => {
    runDerived(() => {
      expect(beginAction("Updated occurrence")).toBeNull();
      expect(getActionId()).toBeNull();
      endAction();
    });
  });

  it("withAction inside it is a pass-through, not an action", () => {
    // This is the shape that actually bit: the write helpers call withAction,
    // not beginAction, and every tracker recompute went through one.
    const inside = runDerived(() => withAction("Updated occurrence", () => getActionId()));
    expect(inside).toBeNull();
  });

  it("MANY writes in one derived scope still mint nothing — the 26-step case", () => {
    const ids = [];
    runDerived(() => {
      for (let i = 0; i < 26; i++) withAction("Updated occurrence", () => ids.push(getActionId()));
    });
    expect(ids).toHaveLength(26);
    expect(ids.every(id => id === null)).toBe(true);
  });

  it("A REAL GESTURE AFTER IT STILL GETS ITS OWN ACTION — the control", () => {
    // Without this the guard would be indistinguishable from breaking undo.
    runDerived(() => withAction("Recomputed", () => {}));
    const real = withAction("Toggled", () => getActionId());
    expect(real).toBeTruthy();
  });

  it("restores the ambient action afterwards — it suppresses, it does not close", () => {
    let outer = null, insideDerived = null, afterDerived = null;
    withAction("Toggled", () => {
      outer = getActionId();
      runDerived(() => { insideDerived = getActionId(); });
      afterDerived = getActionId();
    });
    expect(insideDerived).toBeNull();
    expect(afterDerived).toBe(outer);
  });

  it("nests without leaking, and isDerived reports the state", () => {
    expect(isDerived()).toBe(false);
    runDerived(() => {
      expect(isDerived()).toBe(true);
      runDerived(() => expect(isDerived()).toBe(true));
      expect(isDerived()).toBe(true);
    });
    expect(isDerived()).toBe(false);
  });

  it("restores derived state even when fn throws", () => {
    expect(() => runDerived(() => { throw new Error("boom"); })).toThrow("boom");
    expect(isDerived()).toBe(false);
    expect(withAction("Toggled", () => getActionId())).toBeTruthy();
  });

  it("closes NO action — the server has no buffer to flush", () => {
    const closed = [];
    setActionCloseHook((id) => closed.push(id));
    runDerived(() => withAction("Recomputed", () => {}));
    expect(closed).toEqual([]);
  });
});

describe("the derived scope survives a deferred cascade", () => {
  // The load sweep defers its cascade past the paint. Without carrying the
  // scope the continuation runs at derivedDepth 0 and every write it makes
  // opens an action again — the guard would cover only the synchronous half of
  // the very sweep it was written for.
  it("a continuation captured inside it stays derived", () => {
    const captured = runDerived(() => captureAction());
    expect(captured).toEqual({ derived: true });
    let inside = "unset";
    runInAction(captured, () => { inside = getActionId(); });
    expect(inside).toBeNull();
  });

  it("a write in that continuation mints nothing", () => {
    const captured = runDerived(() => captureAction());
    const id = runInAction(captured, () => withAction("Updated occurrence", () => getActionId()));
    expect(id).toBeNull();
  });

  it("and restores what was there afterwards", () => {
    const captured = runDerived(() => captureAction());
    runInAction(captured, () => {});
    expect(isDerived()).toBe(false);
    expect(getActionId()).toBeNull();
  });

  it("A USER GESTURE'S continuation is UNAFFECTED — the control", () => {
    // The whole point of captureAction; a derived marker must not swallow it.
    let captured = null;
    const outer = withAction("Toggled", () => { captured = captureAction(); return getActionId(); });
    expect(captured).toEqual({ id: outer, label: "Toggled" });
    const inside = runInAction(captured, () => getActionId());
    expect(inside).toBe(outer);
  });

  it("retain/release on a derived capture signals no close", () => {
    const closed = [];
    setActionCloseHook((id) => closed.push(id));
    const captured = runDerived(() => captureAction());
    retainAction(captured);
    releaseAction(captured);
    expect(closed).toEqual([]);
  });
});
