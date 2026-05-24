import { describe, it, expect } from "vitest";
import { ACTION_TREE, findActionPath, findActionLeaf } from "../ui/actionTree";

describe("ACTION_TREE structure", () => {
  it("has more than 2 drilldown levels (categories > sub-categories > leaves)", () => {
    // Variables → Arithmetic → += add must exist
    const variables = ACTION_TREE.find(n => n.value === "variables");
    expect(variables).toBeTruthy();
    const arithmetic = variables.children.find(c => c.value === "arithmetic");
    expect(arithmetic).toBeTruthy();
    const addLeaf = arithmetic.children.find(c => c.value === "ADD_TO_VAR");
    expect(addLeaf).toBeTruthy();
    expect(addLeaf.children).toBeUndefined();
  });

  it("contains every previously-listed action under exactly one category", () => {
    // Pull every leaf out of the tree and assert no duplicates.
    const leaves = [];
    function walk(nodes) {
      for (const n of nodes) {
        if (n.children) walk(n.children);
        else leaves.push(n.value);
      }
    }
    walk(ACTION_TREE);
    const seen = new Set();
    for (const v of leaves) {
      expect(seen.has(v)).toBe(false);
      seen.add(v);
    }
    // Spot-check a few key action types are present
    for (const expected of [
      "INIT_VAR", "ADD_TO_VAR", "PUSH_TO_VAR", "PUSH_TO_ARRAY",
      "FIND",
      "CREATE", "COPY_LINK", "APPLY_TEMPLATE",
      "UPDATE", "SET_FIELD_VALUE", "INCREMENT_FIELD",
      "DELETE", "DELETE_MODULE",
      "MOVE_OCCURRENCE",
      "SHOW_VALUE", "NOTIFY", "DISPLAY_LOCAL_FIELDS",
      "RUN_OPERATION", "CYCLE_FIELD_VALUE",
      "CALL_API", "GET_USER_INPUT",
      // Value-manipulator actions shipped in #31
      "SPLIT_STRING", "JOIN_ARRAY", "SORT_VAR", "REPLACE_IN_VAR",
      "REMOVE_FROM_VAR", "MERGE_ARRAY", "TYPE_OF", "ARRAY_LENGTH",
    ]) {
      expect(seen.has(expected)).toBe(true);
    }
  });

  it("DOES NOT contain stale _MULTIPLE entries (merged into base actions per #30)", () => {
    // Per the merged-multiple refactor (2026-05-23), CREATE_MULTIPLE /
    // MOVE_MULTIPLE / REMOVE_MULTIPLE / DELETE_MULTIPLE should NOT be
    // separate tree leaves — they're toggles on the base CREATE / MOVE /
    // etc. actions. This test guards against accidental re-introduction.
    const leaves = [];
    function walk(nodes) {
      for (const n of nodes) {
        if (n.children) walk(n.children);
        else leaves.push(n.value);
      }
    }
    walk(ACTION_TREE);
    for (const stale of ["CREATE_MULTIPLE", "MOVE_MULTIPLE", "REMOVE_MULTIPLE", "DELETE_MULTIPLE"]) {
      expect(leaves).not.toContain(stale);
    }
  });
});

describe("findActionPath", () => {
  it("returns the full chain to a leaf", () => {
    const path = findActionPath("ADD_TO_VAR");
    expect(path).toBeTruthy();
    expect(path.map(p => p.value)).toEqual(["variables", "arithmetic", "ADD_TO_VAR"]);
  });

  it("returns null for an unknown value", () => {
    expect(findActionPath("NOT_A_THING")).toBeNull();
  });

  it("returns null for null/empty input", () => {
    expect(findActionPath("")).toBeNull();
    expect(findActionPath(null)).toBeNull();
    expect(findActionPath(undefined)).toBeNull();
  });
});

describe("findActionLeaf", () => {
  it("returns the leaf node for a known action", () => {
    const leaf = findActionLeaf("FIND");
    expect(leaf).toBeTruthy();
    expect(leaf.value).toBe("FIND");
    expect(leaf.title).toBe("Find");
  });

  it("does not return a category (only leaves)", () => {
    expect(findActionLeaf("variables")).toBeNull(); // category, not a leaf
    expect(findActionLeaf("arithmetic")).toBeNull();
  });

  it("returns null for unknown / empty", () => {
    expect(findActionLeaf("BOGUS")).toBeNull();
    expect(findActionLeaf("")).toBeNull();
  });
});
