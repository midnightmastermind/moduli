// client/src/__tests__/editorSyncSignal.test.js
//
// The Editor's content-sync effect ignores incoming content while it has focus
// or was typed in within the last 3s — right for a stale debounced echo, fatal
// for an undo, which necessarily arrives under exactly those conditions. The
// revert reached the DB and the store but never the screen, and the next
// keystroke saved the stale text back over it (user: "its not undoing new
// textblocks or typing").
//
// Contract: the token bumps ONCE per applied undo, and only when one was
// actually requested — a routine full_state must not force-sync editors out
// from under the user's caret.
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  requestForceSync, commitForceSync, subscribeForceSync,
  getForceSyncToken, _resetForceSync,
} from "../helpers/editorSyncSignal";

beforeEach(() => { _resetForceSync(); });

describe("editor force-sync signal", () => {
  it("does NOT bump on a routine full_state (no undo requested)", () => {
    const before = getForceSyncToken();
    commitForceSync();
    expect(getForceSyncToken()).toBe(before);
  });

  it("bumps once the requested sync is committed", () => {
    const before = getForceSyncToken();
    requestForceSync();
    expect(getForceSyncToken()).toBe(before);   // not yet — state hasn't arrived
    commitForceSync();
    expect(getForceSyncToken()).toBe(before + 1);
  });

  it("bumps only ONCE per request", () => {
    requestForceSync();
    commitForceSync();
    const after = getForceSyncToken();
    commitForceSync();                          // a later unrelated full_state
    expect(getForceSyncToken()).toBe(after);
  });

  it("notifies subscribers so mounted editors re-render", () => {
    const fn = vi.fn();
    subscribeForceSync(fn);
    requestForceSync();
    commitForceSync();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("a throwing subscriber does not block the others", () => {
    const ok = vi.fn();
    subscribeForceSync(() => { throw new Error("boom"); });
    subscribeForceSync(ok);
    requestForceSync();
    expect(() => commitForceSync()).not.toThrow();
    expect(ok).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe detaches", () => {
    const fn = vi.fn();
    const off = subscribeForceSync(fn);
    off();
    requestForceSync();
    commitForceSync();
    expect(fn).not.toHaveBeenCalled();
  });
});
