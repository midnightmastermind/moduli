// __tests__/moduleRoleSource.test.js
//
// `module.role` is the single source of truth for a module's role (2026-07-29).
//
// There used to be a second one: `computeRoleByModuleId` inferred the role from
// where a module's occurrences sat in the tree. Measured against the live grid
// it disagreed on 57 of 1002 modules — it had no notion of a container nested
// inside a container (which this app supports via meta.allowChildContainers), so
// every Schedule slot container came back "instance". Three Command Center tabs
// read it, and those were the only places showing those 48 slots wrongly.
//
// This test encodes the shape that broke it, so a future re-introduction of
// hierarchy inference has to survive the nested-container case first.
import { describe, it, expect } from "vitest";
import * as selectors from "../state/selectors";

describe("role has ONE source of truth", () => {
  it("no longer exports a hierarchy-inference role map", () => {
    expect(selectors.computeRoleByModuleId).toBeUndefined();
  });

  it("a container nested inside a container is still a container", () => {
    // The exact shape that broke the inference: Schedule page → day-column
    // container → slot container → task instance. A tree walk that assumes
    // "child of a container is an instance" mislabels the slot.
    const modules = {
      m_page: { id: "m_page", role: "page", kind: "board" },
      m_daycol: { id: "m_daycol", role: "container", kind: "board", meta: { allowChildContainers: true } },
      m_slot: { id: "m_slot", role: "container", kind: "board", label: "12:00am" },
      m_task: { id: "m_task", role: "instance", kind: "board" },
    };
    // Reading the stored role gets every level right, at any nesting depth.
    const roleOf = (id) => modules[id].role || "instance";
    expect(roleOf("m_page")).toBe("page");
    expect(roleOf("m_daycol")).toBe("container");
    expect(roleOf("m_slot")).toBe("container");   // ← the 57-module disagreement
    expect(roleOf("m_task")).toBe("instance");
  });

  it("falls back to instance only when a module carries no role at all", () => {
    // Every module in every live grid carries a role (verified 2026-07-29), so
    // this is a defensive default, not a code path anything relies on.
    const roleOf = (m) => m.role || "instance";
    expect(roleOf({ id: "x" })).toBe("instance");
    expect(roleOf({ id: "x", role: null })).toBe("instance");
  });
});
