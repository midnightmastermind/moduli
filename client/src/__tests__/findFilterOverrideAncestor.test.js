import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { findFilterOverrideAncestor } from "../helpers/dropHandlers.js";

// MD1 — drag-between-day-cols re-stamps date. The helper walks
// document.elementsFromPoint(x, y) outward from the drop point and returns
// the nearest ancestor occurrence with a non-empty `filterOverride`. The
// caller passes that to computePageFilterFields so the stamped date comes
// from the day-col's pinned date, not from the page's multi-day shape.

const realElementsFromPoint = document.elementsFromPoint;

function makeEl(occId) {
  const el = document.createElement("div");
  el.dataset.occurrenceId = occId;
  return el;
}

describe("findFilterOverrideAncestor", () => {
  beforeEach(() => {
    document.elementsFromPoint = () => [];
  });
  afterEach(() => {
    document.elementsFromPoint = realElementsFromPoint;
  });

  it("returns the first ancestor whose occurrence has a non-empty filterOverride", () => {
    const slot = makeEl("slot1");
    const dayCol = makeEl("dayCol1");
    const page = makeEl("page1");
    document.elementsFromPoint = () => [slot, dayCol, page];

    const occurrencesById = {
      slot1: { id: "slot1" /* no override */ },
      dayCol1: { id: "dayCol1", filterOverride: { dateFid: "2026-05-24" } },
      page1: { id: "page1", filterOverride: { dateFid: { kind: "multi", dates: ["2026-05-23", "2026-05-24"] } } },
    };

    const found = findFilterOverrideAncestor({
      pointer: { x: 100, y: 100 },
      occurrencesById,
      excludeOccId: "slot1",
    });
    expect(found?.id).toBe("dayCol1");
  });

  it("skips the excluded occurrence id (slot) even if it has an override", () => {
    const slot = makeEl("slot1");
    const dayCol = makeEl("dayCol1");
    document.elementsFromPoint = () => [slot, dayCol];

    const occurrencesById = {
      slot1: { id: "slot1", filterOverride: { dateFid: "ignored" } },
      dayCol1: { id: "dayCol1", filterOverride: { dateFid: "2026-05-24" } },
    };

    const found = findFilterOverrideAncestor({
      pointer: { x: 100, y: 100 },
      occurrencesById,
      excludeOccId: "slot1",
    });
    expect(found?.id).toBe("dayCol1");
  });

  it("ignores empty filterOverride ({} = 'clear cascade')", () => {
    const slot = makeEl("slot1");
    const inner = makeEl("inner");
    const dayCol = makeEl("dayCol1");
    document.elementsFromPoint = () => [slot, inner, dayCol];

    const occurrencesById = {
      slot1: { id: "slot1" },
      inner: { id: "inner", filterOverride: {} },
      dayCol1: { id: "dayCol1", filterOverride: { dateFid: "2026-05-24" } },
    };

    const found = findFilterOverrideAncestor({
      pointer: { x: 100, y: 100 },
      occurrencesById,
      excludeOccId: "slot1",
    });
    expect(found?.id).toBe("dayCol1");
  });

  it("returns null when no ancestor has a filterOverride", () => {
    const slot = makeEl("slot1");
    const page = makeEl("page1");
    document.elementsFromPoint = () => [slot, page];

    const occurrencesById = {
      slot1: { id: "slot1" },
      page1: { id: "page1" },
    };

    const found = findFilterOverrideAncestor({
      pointer: { x: 100, y: 100 },
      occurrencesById,
      excludeOccId: "slot1",
    });
    expect(found).toBe(null);
  });

  it("returns null when pointer coords are missing", () => {
    const found = findFilterOverrideAncestor({
      pointer: null,
      occurrencesById: {},
      excludeOccId: null,
    });
    expect(found).toBe(null);
  });

  it("supports data-occ-id (legacy attribute) alongside data-occurrence-id", () => {
    const el = document.createElement("div");
    el.setAttribute("data-occ-id", "legacyDayCol");
    document.elementsFromPoint = () => [el];

    const occurrencesById = {
      legacyDayCol: { id: "legacyDayCol", filterOverride: { dateFid: "2026-05-24" } },
    };

    const found = findFilterOverrideAncestor({
      pointer: { x: 100, y: 100 },
      occurrencesById,
      excludeOccId: null,
    });
    expect(found?.id).toBe("legacyDayCol");
  });
});
