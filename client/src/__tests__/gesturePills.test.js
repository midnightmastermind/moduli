/**
 * gesturePills.test.js — the notification stack is the change history
 * (2026-09-25). One gesture = one pill, however many rows it and the operations
 * it set off wrote; only the pill holding the newest undoable transaction can
 * undo, and the server refuses anything else.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

let store;
beforeEach(async () => {
  vi.resetModules();
  store = await import("../state/notificationStore");
});
const items = () => { let out; store.subscribeTxNotifications(x => { out = x; })(); return out; };

describe("gesture pills", () => {
  it("a gesture's field writes + its undo record make ONE pill", () => {
    store.upsertGesturePill({ actionId: "a1", label: "Drink Water · Done: false → true", bump: 1, touchedIds: ["row"] });
    store.upsertGesturePill({ actionId: "a1", label: "Total Water: 3 → 4", bump: 1, touchedIds: ["goal"] });
    store.upsertGesturePill({ actionId: "a1", transactionId: "tx1", fallbackLabel: "Updated occurrence", touchedIds: ["row", "goal"] });
    const pills = items().filter(n => n.gesture);
    expect(pills).toHaveLength(1);
    expect(store.gesturePillText(pills[0])).toBe("Drink Water · Done: false → true · +1 update");
    expect(pills[0].transactionId).toBe("tx1");
    expect(pills[0].touchedIds.sort()).toEqual(["goal", "row"]);
  });

  it("the undo record arriving FIRST is named by the field change that follows", () => {
    store.upsertGesturePill({ actionId: "a2", transactionId: "tx2", fallbackLabel: "Updated occurrence" });
    store.upsertGesturePill({ actionId: "a2", label: "Mood: Calm", bump: 1 });
    expect(store.gesturePillText(items()[0])).toBe("Mood: Calm");
  });

  it("only the pill holding the stack top can undo, and it sends its own id", () => {
    const handler = vi.fn();
    store.upsertGesturePill({ actionId: "old", transactionId: "txOld", label: "old" });
    store.upsertGesturePill({ actionId: "new", transactionId: "txNew", label: "new" });
    store.setUndoTop("txNew", handler);
    const [newest, older] = items();
    expect(store.canUndoPill(newest)).toBe(true);
    expect(store.canUndoPill(older)).toBe(false);
    expect(store.undoPill(older)).toBe(false);
    store.undoPill(newest);
    expect(handler).toHaveBeenCalledWith("txNew");
  });

  it("after an undo the pill reads undone and the button moves to the next one", () => {
    store.upsertGesturePill({ actionId: "old", transactionId: "txOld", label: "old" });
    store.upsertGesturePill({ actionId: "new", transactionId: "txNew", label: "new" });
    store.setUndoTop("txNew", vi.fn());
    store.markTransactionUndone("txNew");
    store.setUndoTop("txOld");
    const [newest, older] = items();
    expect(store.gesturePillText(newest)).toBe("new — undone");
    expect(store.canUndoPill(newest)).toBe(false);
    expect(store.canUndoPill(older)).toBe(true);
  });

  it("a plain notification (an operation's own write) never offers undo", () => {
    store.pushTxNotification({ kind: "info", label: "Total Water: 4" });
    store.setUndoTop("anything", vi.fn());
    expect(store.canUndoPill(items()[0])).toBe(false);
  });
});
