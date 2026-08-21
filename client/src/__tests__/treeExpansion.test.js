// The manifest sidebar's folder open/closed memory.
//
// Folders start CLOSED (user, 2026-08-20: "make every folder closed by default
// … all the folders currently are expanded to start"), and what you open is
// remembered per BROWSER — not written back to the grid. `Folder.isExpanded` is
// a seed-time initial value that nothing has ever written back, so persisting
// there would mean a socket write per folder click on live data for a preference
// that is per-device anyway.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { isFolderOpen, setFolderOpen, STORE_KEY } from "../helpers/treeExpansion";

beforeEach(() => localStorage.clear());

describe("folder expansion memory", () => {
  it("starts CLOSED — the whole point of the change", () => {
    expect(isFolderOpen("anything")).toBe(false);
  });

  it("remembers a folder you opened", () => {
    setFolderOpen("f1", true);
    expect(isFolderOpen("f1")).toBe(true);
    // ...and a sibling is unaffected, so this is a per-folder memory and not a
    // global "everything is open now" flag.
    expect(isFolderOpen("f2")).toBe(false);
  });

  it("forgets one you closed again", () => {
    setFolderOpen("f1", true);
    setFolderOpen("f1", false);
    expect(isFolderOpen("f1")).toBe(false);
  });

  it("survives a reload — the state is in storage, not in memory", () => {
    setFolderOpen("f1", true);
    const raw = localStorage.getItem(STORE_KEY);
    expect(raw).toBeTruthy();
    // Simulate a fresh module load reading the same storage.
    expect(JSON.parse(raw)).toContain("f1");
  });

  it("treats a CORRUPT store as empty rather than throwing", () => {
    // A tree that throws on mount takes the whole panel down; falling back to
    // "everything closed" is the same as a first visit.
    localStorage.setItem(STORE_KEY, "{not json");
    expect(() => isFolderOpen("f1")).not.toThrow();
    expect(isFolderOpen("f1")).toBe(false);
    // and it must RECOVER — a corrupt value cannot make the feature dead
    // for the rest of the session.
    setFolderOpen("f1", true);
    expect(isFolderOpen("f1")).toBe(true);
  });

  it("tolerates a store that parses AND ITERATES but is the wrong shape", () => {
    // The shape that actually needs guarding is a STRING. An object throws in
    // the Set constructor and the try/catch already covers it — a test using one
    // passes with or without the Array check, i.e. proves nothing. A string is
    // iterable, so `new Set("f1")` silently becomes {"f","1"} and a folder whose
    // id is "f" reads as OPEN. A/B'd: removing the Array.isArray check fails
    // this and nothing else.
    localStorage.setItem(STORE_KEY, '"f1"');
    expect(isFolderOpen("f")).toBe(false);
    expect(isFolderOpen("f1")).toBe(false);
  });

  it("survives storage being unavailable entirely", () => {
    // Private-mode Safari throws on setItem once the quota is zero. The sidebar
    // must still render and toggle; it just cannot remember.
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => setFolderOpen("f1", true)).not.toThrow();
    spy.mockRestore();
  });

  it("ignores an empty id rather than storing one", () => {
    setFolderOpen("", true);
    setFolderOpen(null, true);
    expect(isFolderOpen("")).toBe(false);
    expect(isFolderOpen(null)).toBe(false);
  });
});
