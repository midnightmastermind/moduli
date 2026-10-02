// The fast undo path must release the force-sync it requests, or an open editor
// keeps showing what was undone (2026-10-02 — only full_state committed it).
import { describe, test, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
const src = fs.readFileSync(path.join(__dirname, "../state/bindSocketToStore.js"), "utf8");
describe("onUndoApplied", () => {
  test("requests AND commits the force-sync", () => {
    const body = src.slice(src.indexOf("const onUndoApplied"), src.indexOf('socket.on("undo_applied"'));
    expect(body).toMatch(/requestForceSync\(\)/);
    expect(body).toMatch(/commitForceSync\(\)/);
    expect(body.indexOf("commitForceSync()")).toBeGreaterThan(body.indexOf("socketDispatch(make(doc))"));
  });
});

describe("a doc drop is one undo step", () => {
  const ed = fs.readFileSync(path.join(__dirname, "../ui/Editor.jsx"), "utf8");
  test("the drop runs inside an action", () => {
    expect(ed).toMatch(/const handleDocDrop = \(args\) => withAction\("Dropped block", \(\) => handleDocDropImpl\(args\)\)/);
  });
  test("a debounced save carries the action open when it was scheduled", () => {
    expect(ed).toMatch(/const cap = captureAction\(\);\s*if \(cap\?\.id\) \{ retainAction\(cap\); pendingSaveActionRef\.current = cap; \}/);
    expect(ed).toMatch(/runInAction\(cap, \(\) => CommitHelpers\.updateOccurrence\(/);
    expect(ed).toMatch(/if \(cap\) releaseAction\(cap\);/);
  });
});
