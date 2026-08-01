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
import { beginAction, endAction, getActionId, _resetActionScope } from "../helpers/actionScope";

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
