// THE SIDEBAR DRAWS THE SAME FOLDER TWICE. A pinned folder page renders its real
// subtree inside `Pinned`, and the full manifest below renders that same folder
// again. Keyed by folder id alone, those two rows shared ONE open state — so
// expanding a folder in Root expanded it inside Pinned too, and Pinned filled up
// with a copy of the manifest as you browsed.
//
// User, 2026-08-22: *"the entire root folder is being opened in the pinned"*.
import { describe, it, expect, beforeEach } from "vitest";
import { isFolderOpen, setFolderOpen, folderKey, ROOT_SCOPE, STORE_KEY } from "../helpers/treeExpansion";

beforeEach(() => localStorage.removeItem(STORE_KEY));

describe("folder open state is scoped by section", () => {
  it("opening a folder in Root does NOT open the same folder in Pinned", () => {
    setFolderOpen("f1", true);                       // the Root tree
    expect(isFolderOpen("f1")).toBe(true);
    expect(isFolderOpen("f1", "pinned")).toBe(false); // …and Pinned stays shut
  });

  it("and the reverse — Pinned does not reach into Root", () => {
    setFolderOpen("f1", true, "pinned");
    expect(isFolderOpen("f1", "pinned")).toBe(true);
    expect(isFolderOpen("f1")).toBe(false);
  });

  it("each scope closes independently", () => {
    setFolderOpen("f1", true);
    setFolderOpen("f1", true, "pinned");
    setFolderOpen("f1", false, "pinned");
    expect(isFolderOpen("f1")).toBe(true);
    expect(isFolderOpen("f1", "pinned")).toBe(false);
  });

  // BACK-COMPAT, and it is the reason root is not prefixed too. Prefixing both
  // would read more evenly and would make every existing browser forget which
  // folders it had open — a silent reset of the one thing this file remembers.
  it("the ROOT scope still writes the BARE folder id", () => {
    setFolderOpen("f1", true);
    expect(JSON.parse(localStorage.getItem(STORE_KEY))).toEqual(["f1"]);
    expect(folderKey("f1")).toBe("f1");
    expect(folderKey("f1", ROOT_SCOPE)).toBe("f1");
  });

  it("a key written by the OLD unscoped build still reads as open in Root", () => {
    localStorage.setItem(STORE_KEY, JSON.stringify(["legacy"]));
    expect(isFolderOpen("legacy")).toBe(true);
    expect(isFolderOpen("legacy", "pinned")).toBe(false);
  });

  it("a missing folder id is closed and writes nothing, in every scope", () => {
    setFolderOpen(null, true, "pinned");
    expect(isFolderOpen(null, "pinned")).toBe(false);
    expect(localStorage.getItem(STORE_KEY)).toBe(null);
    expect(folderKey(null, "pinned")).toBe(null);
  });
});
