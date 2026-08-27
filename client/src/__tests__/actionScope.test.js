// client/src/__tests__/actionScope.test.js
//
// safeEmit is the single chokepoint every socket write passes through, so it is
// where a user action gets stamped onto the wire. What matters:
//   * a write during an open action carries the id (that is what lets the server
//     group a drop with its ~40 tracker writes into ONE undo step);
//   * a write with no action open carries nothing (scheduler / feed sync must
//     not land on the user's undo stack);
//   * nested gestures share one id, so one Ctrl+Z reverts the whole gesture;
//   * reads are never stamped.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { safeEmit } from "../helpers/offlineQueue";
import { beginAction, endAction, getActionId, setActionCloseHook, _resetActionScope, captureAction, retainAction, releaseAction, runInAction, withAction } from "../helpers/actionScope";

function fakeSocket() {
  return { connected: true, emit: vi.fn() };
}

beforeEach(() => { _resetActionScope(); });

describe("actionScope", () => {
  it("stamps __actionId on a write made inside an action", () => {
    const socket = fakeSocket();
    const id = beginAction("Changed a value");
    safeEmit(socket, "update_occurrence", { occurrence: { id: "o1" } });
    endAction();

    const [, payload] = socket.emit.mock.calls[0];
    expect(payload.__actionId).toBe(id);
    expect(payload.__actionLabel).toBe("Changed a value");
    expect(payload.occurrence).toEqual({ id: "o1" });
  });

  it("stamps NOTHING when no action is open", () => {
    const socket = fakeSocket();
    safeEmit(socket, "update_occurrence", { occurrence: { id: "o1" } });
    const [, payload] = socket.emit.mock.calls[0];
    expect(payload.__actionId).toBeUndefined();
  });

  it("gives every write in one action the SAME id — the whole cascade is one undo step", () => {
    const socket = fakeSocket();
    beginAction("Moved item");
    safeEmit(socket, "update_occurrence", { occurrence: { id: "task" } });
    safeEmit(socket, "update_occurrence", { occurrence: { id: "tracker1" } });
    safeEmit(socket, "create_occurrence", { occurrence: { id: "new" } });
    endAction();

    const ids = socket.emit.mock.calls.map(([, p]) => p.__actionId);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBeTruthy();
  });

  it("nested gestures share one action and close with the outermost", () => {
    beginAction("outer");
    const outer = getActionId();
    beginAction("inner");
    expect(getActionId()).toBe(outer);
    endAction();                       // inner closes — action stays open
    expect(getActionId()).toBe(outer);
    endAction();                       // outer closes
    expect(getActionId()).toBeNull();
  });

  it("does not stamp reads — they are not part of the user's undo step", () => {
    const socket = fakeSocket();
    beginAction("Moved item");
    safeEmit(socket, "request_full_state", {});
    safeEmit(socket, "undo_transaction", { gridId: "g1" });
    endAction();

    for (const [, payload] of socket.emit.mock.calls) {
      expect(payload.__actionId).toBeUndefined();
    }
  });

  // The bug this pins: the grouping mechanism existed but only setOccurrenceFieldValue
  // and the drop batch ever opened an action. Typing, creating and deleting reached the
  // server with NO actionId, were recorded as `derived`, and the undo stack skipped them
  // — measured on the live grid, 33 of 35 transactions were derived, so Ctrl+Z had
  // almost nothing to undo. Every ordinary write must carry a stamp.
  it("ordinary writes carry an action stamp, so they reach the undo stack", async () => {
    const { updateOccurrence, createOccurrence, deleteOccurrence } =
      await import("../helpers/CommitHelpers");
    const socket = fakeSocket();
    const dispatch = () => {};

    updateOccurrence({ dispatch, socket, occurrence: { id: "o1", textmap: { type: "doc" } } });
    createOccurrence({ dispatch, socket, occurrence: { id: "o2" } });
    deleteOccurrence({ dispatch, socket, occurrenceId: "o3" });

    const writes = socket.emit.mock.calls.filter(([evt]) =>
      ["update_occurrence", "create_occurrence", "delete_occurrence"].includes(evt));
    expect(writes.length).toBeGreaterThanOrEqual(3);
    for (const [evt, payload] of writes) {
      expect(payload.__actionId, `${evt} must carry an action id`).toBeTruthy();
    }
  });

  it("derived writes (fireTrigger:false) stay OUT of the undo stack", async () => {
    const { createOccurrence } = await import("../helpers/CommitHelpers");
    const socket = fakeSocket();
    createOccurrence({ dispatch: () => {}, socket, occurrence: { id: "feed1" }, fireTrigger: false });
    const [, payload] = socket.emit.mock.calls.find(([e]) => e === "create_occurrence") || [];
    expect(payload?.__actionId).toBeUndefined();
  });

  it("a stray extra endAction cannot leave the scope negative", () => {
    beginAction("x");
    endAction();
    endAction();
    expect(getActionId()).toBeNull();
    beginAction("y");
    expect(getActionId()).toBeTruthy();
  });
});

// The server buffers writes per action and, without a close signal, only
// flushes on a 1500ms idle timer — so an undo pressed right after an edit
// targeted the PREVIOUS transaction.
describe("the action-close signal", () => {
  it("fires once with the id of the action that just closed", () => {
    const closed = [];
    setActionCloseHook(id => closed.push(id));

    const id = beginAction("Changed a value");
    endAction();

    expect(closed).toEqual([id]);
  });

  it("fires only when the OUTERMOST scope closes — a nested gesture is still one action", () => {
    const closed = [];
    setActionCloseHook(id => closed.push(id));

    const id = beginAction("Moved item");
    beginAction("Changed a value");   // a cascade write joins the open action
    endAction();
    expect(closed).toHaveLength(0);
    endAction();

    expect(closed).toEqual([id]);
  });

  it("does not fire when there was no open action", () => {
    const closed = [];
    setActionCloseHook(id => closed.push(id));
    endAction();
    expect(closed).toHaveLength(0);
  });

  it("a throwing hook still leaves the scope closed", () => {
    setActionCloseHook(() => { throw new Error("socket died"); });
    beginAction("x");
    expect(() => endAction()).not.toThrow();
    expect(getActionId()).toBeNull();
  });
});

// ─── DEFERRED CONTINUATIONS ────────────────────────────────────────────────
//
// `withAction` closes synchronously, but a field write defers its operation
// cascade past the paint — so every write that cascade made landed OUTSIDE the
// action and opened one of its own. Measured on the live grid: one checkbox
// toggle produced 40-54 transactions across 201 DISTINCT action ids, one
// document each, which is why Ctrl+Z undid a derived write instead of the
// toggle and undo appeared not to work.

describe("an action survives a deferred cascade", () => {
  beforeEach(() => _resetActionScope());

  it("a continuation writes under the SAME action id", () => {
    let captured = null, inside = null;
    const outer = withAction("Toggled", () => {
      captured = captureAction();
      return getActionId();
    });
    expect(getActionId()).toBeNull();          // the synchronous scope is shut
    runInAction(captured, () => { inside = getActionId(); });
    expect(inside).toBe(outer);
  });

  it("restores what was there afterwards — it re-enters, it does not open", () => {
    const captured = { id: "act-1", label: "x" };
    runInAction(captured, () => {});
    expect(getActionId()).toBeNull();
  });

  it("holds the CLOSE signal until the last continuation drains", () => {
    // The server flushes the buffer on this signal; anything arriving after it
    // becomes a second transaction, which is the defect from the other side.
    const closed = [];
    setActionCloseHook((id) => closed.push(id));
    let captured = null;
    withAction("Toggled", () => { captured = captureAction(); retainAction(captured); });
    expect(closed).toEqual([]);                       // NOT closed yet
    releaseAction(captured);
    expect(closed).toEqual([captured.id]);            // closed exactly once
  });

  it("several continuations close it ONCE, not once each", () => {
    const closed = [];
    setActionCloseHook((id) => closed.push(id));
    let captured = null;
    withAction("Toggled", () => {
      captured = captureAction();
      retainAction(captured); retainAction(captured); retainAction(captured);
    });
    releaseAction(captured); releaseAction(captured);
    expect(closed).toEqual([]);
    releaseAction(captured);
    expect(closed).toEqual([captured.id]);
  });

  it("A NEW GESTURE BETWEEN CONTINUATIONS IS ITS OWN ACTION — the control", () => {
    // The hazard this design has to avoid: a long cascade swallowing the next
    // thing the user does, so one Ctrl+Z reverts both. Between continuations
    // the ambient id is null, so `beginAction` mints a fresh one.
    let captured = null;
    withAction("Toggled", () => { captured = captureAction(); retainAction(captured); });
    const second = withAction("Something else", () => getActionId());
    expect(second).not.toBe(captured.id);
    releaseAction(captured);
  });

  it("a capture with no action open is inert, and cannot close anything", () => {
    const closed = [];
    setActionCloseHook((id) => closed.push(id));
    const captured = captureAction();
    expect(captured).toBeNull();
    retainAction(captured);
    releaseAction(captured);
    expect(closed).toEqual([]);
    expect(runInAction(captured, () => "ran")).toBe("ran");
  });
});
