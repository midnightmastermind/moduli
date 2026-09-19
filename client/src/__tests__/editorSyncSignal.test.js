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

// ── 2026-09-19: an OPERATION's write to one editor ─────────────────────────
import {
  markOperationWrite, hasOperationWrite, clearOperationWrite,
  subscribeOperationWrite, getOperationWriteToken,
} from "../helpers/editorSyncSignal";

describe("an operation's write to one editor", () => {
  it("marks only the occurrence it names", () => {
    markOperationWrite("col");
    expect(hasOperationWrite("col")).toBe(true);
    expect(hasOperationWrite("other")).toBe(false);
  });

  // It must OUTLIVE a render that still holds the old content — a one-shot
  // consumed there would drop the bypass before the new content arrives.
  it("persists across reads until cleared", () => {
    markOperationWrite("col");
    expect(hasOperationWrite("col")).toBe(true);
    expect(hasOperationWrite("col")).toBe(true);
    clearOperationWrite("col");
    expect(hasOperationWrite("col")).toBe(false);
  });

  // …but never indefinitely: a mark nothing consumes must not leave that
  // editor permanently open to echoes.
  it("expires", () => {
    markOperationWrite("col", 1000);
    expect(hasOperationWrite("col", 3999)).toBe(true);
    expect(hasOperationWrite("col", 4001)).toBe(false);
  });

  it("notifies subscribers and bumps its token", () => {
    const fn = vi.fn();
    subscribeOperationWrite(fn);
    const before = getOperationWriteToken();
    markOperationWrite("col");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getOperationWriteToken()).toBe(before + 1);
  });

  // It is a DIFFERENT lever from undo's force: it must not bump that token,
  // which syncs EVERY editor and overrides the typed-recently guard.
  it("does not trigger the grid-wide undo force", () => {
    const before = getForceSyncToken();
    markOperationWrite("col");
    expect(getForceSyncToken()).toBe(before);
  });
});

// ── THE WIRING, which no test can mount ────────────────────────────────────
import { readFileSync } from "fs";
import { resolve } from "path";

describe("Editor and the store honour an operation's write", () => {
  const editor = readFileSync(resolve(__dirname, "../ui/Editor.jsx"), "utf-8");
  const store = readFileSync(resolve(__dirname, "../state/bindSocketToStore.js"), "utf-8");
  const syncBody = editor.slice(editor.indexOf("const opWrote = hasOperationWrite("),
    editor.indexOf("}, [editor, content, forceSyncToken, opWriteToken]);"));

  it("lifts the focus and just-clicked guards for an op write", () => {
    expect(syncBody).toContain("if (hasFocus && !opWrote) return;");
    expect(syncBody).toContain("if (recentMousedownRef.current && !opWrote) return;");
  });

  // THE LOAD-BEARING HALF: unsaved typing is never overwritten by an op.
  it("never lifts the typed-recently guard", () => {
    expect(syncBody).toContain("if (locallyModifiedRef.current) return;");
    expect(syncBody).not.toMatch(/locallyModifiedRef\.current\s*&&\s*!opWrote/);
  });

  it("spends the mark once the content has landed", () => {
    expect(syncBody).toContain("if (opWrote) clearOperationWrite(occurrence?.id);");
  });

  it("the textmap effect marks the write AFTER dispatching it", () => {
    const at = store.indexOf('case "UPDATE_ITEM_TEXTMAP"');
    const body = store.slice(at, store.indexOf('case "UPDATE_ITEM_LABEL"', at));
    expect(body.indexOf("markOperationWrite(effect.itemId)"))
      .toBeGreaterThan(body.indexOf("updateOccurrence("));
  });
});
