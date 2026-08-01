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

  it("a stray extra endAction cannot leave the scope negative", () => {
    beginAction("x");
    endAction();
    endAction();
    expect(getActionId()).toBeNull();
    beginAction("y");
    expect(getActionId()).toBeTruthy();
  });
});
