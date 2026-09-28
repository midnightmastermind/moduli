// A loop can iterate a local var or a path, not just a built-in collection.
//
// `COLLECTION_PICKER_CONFIG` offered exactly nine grid-wide collections.
// Measured across every grid on 2026-09-27: of 308 loops, 76 iterate something
// else — a parent's `occurrences` child list, an array field's `.value`, or a
// local var built earlier in the pipeline (`$covered`) — across 27 operations,
// which are the schedule and day-page builders. None could be authored.
import { describe, it, expect } from "vitest";
import { COLLECTION_PICKER_CONFIG, CATEGORIES } from "../ui/categoryRegistry";
import { itemsForLevel } from "../ui/DrilldownPicker.jsx";

const cfg = COLLECTION_PICKER_CONFIG;
const ctx = {
  localVars: ["$covered", "$slotLabels"],
  fields: [{ id: "f1", name: "Date", type: "date" }],
  sources: [], modulesById: {}, occurrencesById: {},
};
// Level 0 is always the CATEGORY list; the entries live one level in.
const level1 = (c = ctx) => itemsForLevel(["collections"], c, cfg.categories).items.map((i) => i.value);

describe("the loop / find collection picker", () => {
  it("still offers the nine built-in collections in one click", () => {
    // Unchanged for every existing author: the collections category leads, and
    // its entries commit without drilling.
    const items = cfg.categories[0].resolveItems(ctx);
    const BUILTINS = [
      "$allOccurrences", "$allItems", "$allContainers", "$allPages", "$allPanels",
      "$allInstances", "$allTemplates", "$allFields", "$allOperations",
    ];
    // They still LEAD the list and still commit without drilling.
    expect(items.slice(0, 9).map((i) => i.value)).toEqual(BUILTINS);
    expect(items.slice(0, 9).every((i) => i.hasChildren === false)).toBe(true);
  });

  it("STAYS one category, so the chain to a built-in is unchanged", () => {
    expect(cfg.categories).toHaveLength(1);
    expect(level1()).toContain("$allInstances");
  });

  it("lists the pipeline's local vars beside the collections", () => {
    const vals = level1();
    expect(vals).toContain("$covered");
    expect(vals).toContain("$slotLabels");
  });

  it("makes a local var DRILLABLE — the chevron commits it, a body click goes deeper", () => {
    // `LOOP $covered` needs the chevron; `LOOP $dayCol.occurrences` needs the
    // drill. Both come free from the machinery already there.
    const v = itemsForLevel(["collections"], ctx, cfg.categories).items.find((i) => i.value === "$covered");
    expect(v.hasChildren).toBe(true);
    const sub = itemsForLevel(["collections", "$covered"], ctx, cfg.categories).items.map((i) => i.value);
    expect(sub).toContain("occurrences");
    expect(sub).toContain("fields");
  });

  it("offers nothing extra when the pipeline has declared no vars", () => {
    // 10 built-in collections: the nine grid-wide ones plus $activePeriodDates
    // (2026-09-28 — the day-column builders loop it; builtinVarCatalog.test.js).
    expect(level1({ ...ctx, localVars: [] })).toHaveLength(10);
  });
});
