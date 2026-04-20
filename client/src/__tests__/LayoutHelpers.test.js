/**
 * LayoutHelpers.test.js
 *
 * Tests occurrence filtering and container/panel lookup helpers.
 *
 * These are critical for the drag/drop system — wrong occurrence resolution
 * = wrong items rendering in wrong containers.
 */

import { describe, test, expect, vi } from "vitest";
import {
  buildLookup,
  getItemById,
  getItemsByIds,
  getPanelContainers,
  getContainerItems,
  getContainerItemsWithOccurrences,
  findOccurrenceIdByTarget,
  getTargetIndexInOccurrences,
  removeId,
  ensureId,
} from "../helpers/LayoutHelpers";

// ─── Mock CommitHelpers (LayoutHelpers imports it for panel copy/split) ────────
vi.mock("../helpers/CommitHelpers", () => ({
  createPanel: vi.fn(),
  updatePanel: vi.fn(),
  createOccurrence: vi.fn(),
  updateOccurrence: vi.fn(),
  deleteOccurrence: vi.fn(),
  updateGrid: vi.fn(),
}));

vi.mock("../uid", () => ({ uid: () => "test-uid-" + Math.random().toString(36).slice(2) }));

// ─── buildLookup ──────────────────────────────────────────────────────────────
describe("buildLookup", () => {
  test("builds id → item map", () => {
    const items = [{ id: "a", label: "A" }, { id: "b", label: "B" }];
    const lookup = buildLookup(items);
    expect(lookup["a"].label).toBe("A");
    expect(lookup["b"].label).toBe("B");
  });

  test("skips items without id", () => {
    const items = [{ label: "No ID" }, { id: "x" }];
    const lookup = buildLookup(items);
    expect(Object.keys(lookup)).toEqual(["x"]);
  });

  test("empty array → empty object", () => {
    expect(buildLookup([])).toEqual({});
  });
});

// ─── getItemById ──────────────────────────────────────────────────────────────
describe("getItemById", () => {
  const lookup = { "p1": { id: "p1", label: "Panel 1" } };

  test("returns item when found", () => {
    expect(getItemById("p1", lookup).label).toBe("Panel 1");
  });

  test("returns null when not found", () => {
    expect(getItemById("missing", lookup)).toBeNull();
  });

  test("returns null with no id", () => {
    expect(getItemById(null, lookup)).toBeNull();
  });

  test("returns null with no lookup", () => {
    expect(getItemById("p1", null)).toBeNull();
  });
});

// ─── getItemsByIds ────────────────────────────────────────────────────────────
describe("getItemsByIds", () => {
  const lookup = { "a": { id: "a" }, "b": { id: "b" } };

  test("returns items for all found ids", () => {
    expect(getItemsByIds(["a", "b"], lookup)).toHaveLength(2);
  });

  test("filters out missing ids", () => {
    expect(getItemsByIds(["a", "missing"], lookup)).toHaveLength(1);
  });

  test("empty ids → empty array", () => {
    expect(getItemsByIds([], lookup)).toEqual([]);
  });
});

// ─── getPanelContainers ───────────────────────────────────────────────────────
describe("getPanelContainers", () => {
  const containers = {
    "c1": { id: "c1", label: "Morning" },
    "c2": { id: "c2", label: "Evening" },
  };
  const occurrences = {
    "occ-c1": { id: "occ-c1", targetType: "module", targetId: "c1" },
    "occ-c2": { id: "occ-c2", targetType: "module", targetId: "c2" },
  };

  test("returns containers for panel occurrences", () => {
    const panel = { id: "p1" };
    const panelOcc = { id: "panel-occ", targetId: "p1", occurrences: ["occ-c1", "occ-c2"] };
    const result = getPanelContainers(panel, occurrences, containers, panelOcc);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe("Morning");
    expect(result[1].label).toBe("Evening");
  });

  test("skips missing occurrences", () => {
    const panel = { id: "p1" };
    const panelOcc = { id: "panel-occ", targetId: "p1", occurrences: ["occ-c1", "missing-occ"] };
    const result = getPanelContainers(panel, occurrences, containers, panelOcc);
    expect(result).toHaveLength(1);
  });

  test("empty panel occurrences → empty array", () => {
    const panel = { id: "p1" };
    const panelOcc = { id: "panel-occ", targetId: "p1", occurrences: [] };
    const result = getPanelContainers(panel, occurrences, containers, panelOcc);
    expect(result).toHaveLength(0);
  });

  test("panel with no occurrences field → empty array", () => {
    const panel = { id: "p1" };
    const result = getPanelContainers(panel, occurrences, containers, null);
    expect(result).toHaveLength(0);
  });
});

// ─── getContainerItems ────────────────────────────────────────────────────────
describe("getContainerItems", () => {
  const TODAY = "2026-02-22";
  const YESTERDAY = "2026-02-21";

  const instances = {
    "i1": { id: "i1", label: "Exercise" },
    "i2": { id: "i2", label: "Meditate" },
  };
  const occurrences = {
    "occ-i1": { id: "occ-i1", targetId: "i1", iteration: { mode: "persistent" } },
    "occ-i2": { id: "occ-i2", targetId: "i2", iteration: { mode: "specific", timeValue: TODAY } },
    "occ-i2-yesterday": { id: "occ-i2-yesterday", targetId: "i2", iteration: { mode: "specific", timeValue: YESTERDAY } },
  };

  test("returns all instances when no iteration filter", () => {
    const container = { id: "c1" };
    const containerOcc = { id: "c1-occ", targetId: "c1", occurrences: ["occ-i1", "occ-i2"] };
    const result = getContainerItems(container, occurrences, instances, null, containerOcc);
    expect(result).toHaveLength(2);
  });

  test("returns all occurrences (filter visibility handled at render level)", () => {
    const container = { id: "c1" };
    const containerOcc = { id: "c1-occ", targetId: "c1", occurrences: ["occ-i1", "occ-i2-yesterday"] };
    const result = getContainerItems(container, occurrences, instances, TODAY, containerOcc);
    expect(result).toHaveLength(2); // no filtering here — isOccurrenceVisible handles it
  });

  test("currentFilterValue param accepted without affecting output", () => {
    const container = { id: "c1" };
    const containerOcc = { id: "c1-occ", targetId: "c1", occurrences: ["occ-i1", "occ-i2"] };
    const result = getContainerItems(container, occurrences, instances, TODAY, containerOcc);
    expect(result).toHaveLength(2);
  });

  test("empty container → empty array", () => {
    const container = { id: "c1" };
    const containerOcc = { id: "c1-occ", targetId: "c1", occurrences: [] };
    const result = getContainerItems(container, occurrences, instances, TODAY, containerOcc);
    expect(result).toHaveLength(0);
  });
});

// ─── getContainerItemsWithOccurrences ─────────────────────────────────────────
describe("getContainerItemsWithOccurrences", () => {
  const instances = { "i1": { id: "i1", label: "Task" } };
  const occurrences = {
    "occ1": { id: "occ1", targetId: "i1", fields: { f1: { value: 5, flow: "in" } } },
  };

  test("returns { instance, occurrence } pairs", () => {
    const container = { id: "c1" };
    const containerOcc = { id: "c1-occ", targetId: "c1", occurrences: ["occ1"] };
    const result = getContainerItemsWithOccurrences(container, occurrences, instances, null, containerOcc);
    expect(result).toHaveLength(1);
    expect(result[0].instance.label).toBe("Task");
    expect(result[0].occurrence.fields.f1.value).toBe(5);
  });

  test("skips when instance not found", () => {
    const container = { id: "c1" };
    const containerOcc = { id: "c1-occ", targetId: "c1", occurrences: ["occ1"] };
    const result = getContainerItemsWithOccurrences(container, occurrences, {}, null, containerOcc);
    expect(result).toHaveLength(0);
  });
});

// ─── findOccurrenceIdByTarget ─────────────────────────────────────────────────
describe("findOccurrenceIdByTarget", () => {
  const occurrences = {
    "occ1": { id: "occ1", targetId: "i1" },
    "occ2": { id: "occ2", targetId: "i2" },
  };
  const parentOccurrences = ["occ1", "occ2"];

  test("finds occurrence id for target", () => {
    expect(findOccurrenceIdByTarget("i1", parentOccurrences, occurrences)).toBe("occ1");
    expect(findOccurrenceIdByTarget("i2", parentOccurrences, occurrences)).toBe("occ2");
  });

  test("returns null when target not found", () => {
    expect(findOccurrenceIdByTarget("missing", parentOccurrences, occurrences)).toBeNull();
  });

  test("returns null with empty parent occurrences", () => {
    expect(findOccurrenceIdByTarget("i1", [], occurrences)).toBeNull();
  });
});

// ─── getTargetIndexInOccurrences ──────────────────────────────────────────────
describe("getTargetIndexInOccurrences", () => {
  const occurrences = {
    "occ1": { id: "occ1", targetId: "i1" },
    "occ2": { id: "occ2", targetId: "i2" },
    "occ3": { id: "occ3", targetId: "i3" },
  };
  const parentOccurrences = ["occ1", "occ2", "occ3"];

  test("returns correct index", () => {
    expect(getTargetIndexInOccurrences("i1", parentOccurrences, occurrences)).toBe(0);
    expect(getTargetIndexInOccurrences("i2", parentOccurrences, occurrences)).toBe(1);
    expect(getTargetIndexInOccurrences("i3", parentOccurrences, occurrences)).toBe(2);
  });

  test("returns -1 when not found", () => {
    expect(getTargetIndexInOccurrences("missing", parentOccurrences, occurrences)).toBe(-1);
  });
});

// ─── removeId / ensureId ──────────────────────────────────────────────────────
describe("removeId", () => {
  test("removes id from list", () => {
    expect(removeId(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  test("no-op if id not in list", () => {
    expect(removeId(["a", "b"], "z")).toEqual(["a", "b"]);
  });

  test("empty list → empty list", () => {
    expect(removeId([], "a")).toEqual([]);
  });
});

describe("ensureId", () => {
  test("adds id if not present", () => {
    const result = ensureId(["a", "b"], "c");
    expect(result).toContain("c");
  });

  test("does not duplicate if id already present", () => {
    const result = ensureId(["a", "b"], "a");
    const count = result.filter(x => x === "a").length;
    expect(count).toBe(1);
  });
});
