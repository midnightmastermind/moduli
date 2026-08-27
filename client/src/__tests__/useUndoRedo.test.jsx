// client/src/__tests__/useUndoRedo.test.jsx
//
// The undo STACK, not the snapshot layer. What matters here:
//   * Ctrl+Z must act on the CURRENT top of the stack. The hook used to send a
//     cached `lastUndoableId`, which is only as fresh as the last `undo_state`
//     round trip — and nothing refreshed it when a new transaction landed. After
//     a few edits it pointed several steps back, so undo restored a stale
//     document while the newer transactions stayed `applied`.
//   * a new transaction has to re-sync `canUndo`, or the button and the
//     shortcut disagree right after the user's first edit.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUndoRedo } from "../hooks/useUndoRedo";

function fakeSocket() {
  const handlers = {};
  return {
    emit: vi.fn(),
    on: vi.fn((evt, fn) => { (handlers[evt] ||= []).push(fn); }),
    off: vi.fn((evt, fn) => { handlers[evt] = (handlers[evt] || []).filter(f => f !== fn); }),
    fire: (evt, payload) => { for (const fn of handlers[evt] || []) fn(payload); },
    handlers,
  };
}

const emitsOf = (socket, evt) => socket.emit.mock.calls.filter(([e]) => e === evt);

beforeEach(() => { vi.useRealTimers(); });

describe("undo targets the top of the stack", () => {
  it("sends NO transactionId — the server resolves it", () => {
    const socket = fakeSocket();
    const { result } = renderHook(() => useUndoRedo(socket, "g1"));

    // The server said the stack top was tx-1 when the hook last synced…
    act(() => { socket.fire("undo_state", { canUndo: true, canRedo: false, lastUndoableId: "tx-1" }); });
    // …then the user made more edits. The hook must not pin the stale id.
    act(() => { result.current.undo(); });

    const [, payload] = emitsOf(socket, "undo_transaction").at(-1);
    expect(payload).not.toHaveProperty("transactionId");
    expect(payload.gridId).toBe("g1");
  });

  // INVERTED 2026-08-27. Redo is disabled (user: "can we disable redo for the
  // moment and just keep undo"), and it was independently DEMONSTRABLY BROKEN —
  // driven end to end, a toggle undoes but does not re-apply, on a build both
  // before and after the undo-speed work. This case pinned the payload SHAPE of
  // a call that must no longer happen at all, so it now pins the silence.
  //
  // The `transactionId` contract it protected is not lost — the history panel
  // still targets a specific entry, and `nextRedoable`'s ascending sort
  // (2026-08-01 (21)) is still under test on the server.
  it("redo is DISABLED — it emits nothing and reports canRedo false", () => {
    const socket = fakeSocket();
    const { result } = renderHook(() => useUndoRedo(socket, "g1"));

    // The server still says redo is possible; the client must decline anyway.
    act(() => { socket.fire("undo_state", { canUndo: true, canRedo: true, lastRedoableId: "tx-9" }); });
    expect(result.current.canRedo).toBe(false);

    act(() => { result.current.redo(); });
    expect(emitsOf(socket, "redo_transaction")).toHaveLength(0);

    // THE CONTROL: undo, from the same payload, is untouched. Without it this
    // would also pass if the hook had simply stopped emitting anything.
    expect(result.current.canUndo).toBe(true);
    act(() => { result.current.undo(); });
    expect(emitsOf(socket, "undo_transaction").length).toBeGreaterThan(0);
  });

  it("does not fire a second time while one is in flight", () => {
    const socket = fakeSocket();
    const { result } = renderHook(() => useUndoRedo(socket, "g1"));

    act(() => { result.current.undo(); });
    act(() => { result.current.undo(); });

    expect(emitsOf(socket, "undo_transaction")).toHaveLength(1);
  });

  it("is usable again after the result lands", () => {
    const socket = fakeSocket();
    const { result } = renderHook(() => useUndoRedo(socket, "g1"));

    act(() => { result.current.undo(); });
    act(() => { socket.fire("undo_result", { success: true, transactionId: "tx-1" }); });
    act(() => { result.current.undo(); });

    expect(emitsOf(socket, "undo_transaction")).toHaveLength(2);
  });
});

describe("undo state stays fresh", () => {
  it("re-syncs when a new transaction lands", async () => {
    vi.useFakeTimers();
    try {
      const socket = fakeSocket();
      renderHook(() => useUndoRedo(socket, "g1"));
      const before = emitsOf(socket, "get_undo_state").length;

      socket.fire("transaction_created", { transaction: { id: "t1" } });
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });

      expect(emitsOf(socket, "get_undo_state").length).toBeGreaterThan(before);
    } finally {
      vi.useRealTimers();
    }
  });

  it("debounces a save burst into ONE refresh", async () => {
    vi.useFakeTimers();
    try {
      const socket = fakeSocket();
      renderHook(() => useUndoRedo(socket, "g1"));
      const before = emitsOf(socket, "get_undo_state").length;

      for (let i = 0; i < 5; i++) socket.fire("transaction_created", { transaction: { id: `t${i}` } });
      await act(async () => { await vi.advanceTimersByTimeAsync(200); });

      expect(emitsOf(socket, "get_undo_state").length - before).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("unsubscribes on unmount", () => {
    const socket = fakeSocket();
    const { unmount } = renderHook(() => useUndoRedo(socket, "g1"));
    unmount();
    expect(socket.handlers["transaction_created"] || []).toHaveLength(0);
  });
});
