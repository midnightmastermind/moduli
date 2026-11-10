// client/src/__tests__/allItemsCacheCreate.test.js
//
// A CREATE no longer throws the sweep's read model away. Measured on poms grid
// 2026-11-10 (writes blocked): a date step rebuilt the ~22k-row model 1-3 times,
// each ~0.2-0.35s, and every rebuild came after `People: Birthdays` or
// `Schedule: Place Dated Work` created a row. A create adds rows and appends
// them to their parent's list; nothing else's ancestry or filter moves. So the
// new rows are enriched and appended, the parent re-enriched in place.
//
// The risk is a STALE READ: a later op in the same sweep not seeing the new row.
// These tests assert what the next op SEES, and that it saw it without a rebuild.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runMatchingOperations, appendCreatesToCache } from "../helpers/operationExecutor";

const PAGE = "page", BOX = "box", OTHER = "other";
const step = (id, config) => ({ id, type: "action", config });

// writer creates a row under BOX; reader counts instances under PAGE into OTHER.
function ops(createExtra = {}) {
  return [
    { id: "w", name: "writer", enabled: true, triggers: [{ type: "onLoad", priority: 1 }],
      pipeline: { steps: [step("c", { type: "CREATE", role: "instance", name: "literal:New row", parent: BOX, itemIdVar: "$newId", ...createExtra })] } },
    { id: "r", name: "reader", enabled: true, triggers: [{ type: "onLoad", priority: 2 }],
      pipeline: { steps: [
        step("i", { type: "INIT_VAR", name: "$n", expr: "0" }),
        { id: "l", type: "loop", overExpr: "$allInstances", as: "$it", body: [
          { id: "if", type: "if", condition: { operator: "AND", rules: [{ id: "r1", left: "$it._ancestors", comparator: "HAS_ANCESTOR", right: PAGE }] },
            then: [step("a", { type: "ADD_TO_VAR", name: "$n", expr: "1" })], else: [] },
        ] },
        step("o", { type: "INIT_VAR", name: "$o", expr: "$allItemsById.other" }),
        step("u", { type: "UPDATE", path: "$o.fields.f1.value", value: "$n" }),
      ] } },
  ];
}

function world() {
  const occurrencesById = {
    [PAGE]: { id: PAGE, moduleId: "mP", occurrences: [BOX], fields: {} },
    [BOX]: { id: BOX, moduleId: "mB", parentId: PAGE, occurrences: ["old"], fields: {} },
    old: { id: "old", moduleId: "mI", parentId: BOX, occurrences: [], fields: {} },
    [OTHER]: { id: OTHER, moduleId: "mI", occurrences: [], fields: { f1: { value: 0 } } },
  };
  const modulesById = {
    mP: { id: "mP", role: "page", label: "Page" },
    mB: { id: "mB", role: "container", label: "Box" },
    mI: { id: "mI", role: "instance", label: "Row", fieldBindings: [{ fieldId: "f1" }] },
  };
  const fieldsById = { f1: { id: "f1", name: "Count", type: "number" } };
  return { state: { grid: { _id: "g" }, gridId: "g", modules: Object.values(modulesById) }, occurrencesById, modulesById, fieldsById };
}

function run(o) {
  const ctx = world();
  ctx.operationsById = Object.fromEntries(o.map(x => [x.id, x]));
  const out = runMatchingOperations(o, null, null, ctx);
  const count = out.filter(e => e._effect === "UPDATE_ITEM_FIELD" && e.itemId === OTHER).pop()?.value;
  return { out, count: Number(count) };
}

beforeEach(() => { globalThis.__readModelDiag = true; globalThis.__readModelBuilds = []; });
afterEach(() => { delete globalThis.__readModelDiag; delete globalThis.__readModelBuilds; });

describe("a create keeps the read model", () => {
  it("a later op counts the new row under its page", () => {
    const { out, count } = run(ops());
    expect(out.some(e => e._effect === "CREATE_ITEM"), "writer created nothing — fixture shape wrong").toBe(true);
    expect(count).toBe(2); // old + the new row
  });

  it("and the model was built once, not again after the create", () => {
    run(ops());
    expect(globalThis.__readModelBuilds).toEqual(["writer"]);
  });
});

describe("appendCreatesToCache refuses what it cannot prove", () => {
  const base = () => {
    const item = { id: "a", occurrences: [] };
    return { _allItemsCache: [item], _allItemsIndex: new Map([["a", item]]), _allItemsEnrich: (o) => ({ ...o, enriched: true }) };
  };
  it("appends a new row and re-enriches its parent", () => {
    const c = base(); const before = c._allItemsCache;
    const live = { a: { id: "a", occurrences: ["n"] }, n: { id: "n", parentId: "a", occurrences: [] } };
    expect(appendCreatesToCache(c, live, [{ _effect: "CREATE_ITEM", instance: { id: "n" } }])).toBe(true);
    expect(c._allItemsCache).not.toBe(before);            // a new array, so per-list indexes rebuild
    expect(c._allItemsCache.map(i => i.id)).toEqual(["a", "n"]);
    expect(c._allItemsIndex.get("a").occurrences).toEqual(["n"]);
  });
  it("a create listing a row that already existed (it would move) rebuilds", () => {
    const c = base();
    const live = { a: { id: "a" }, n: { id: "n", occurrences: ["a"] } };
    expect(appendCreatesToCache(c, live, [{ _effect: "CREATE_ITEM", instance: { id: "n" } }])).toBe(false);
  });
  it("a delete or a move beside the create rebuilds", () => {
    const c = base();
    const live = { a: { id: "a" }, n: { id: "n", occurrences: [] } };
    expect(appendCreatesToCache(c, live, [{ _effect: "CREATE_ITEM", instance: { id: "n" } }, { _effect: "DELETE_ITEM", itemId: "a" }])).toBe(false);
    expect(appendCreatesToCache(c, live, [{ _effect: "UPDATE_ITEM_PARENT", itemId: "a", toParentId: "x" }])).toBe(false);
  });
  it("a create of an id already cached rebuilds", () => {
    const c = base();
    expect(appendCreatesToCache(c, { a: { id: "a" } }, [{ _effect: "CREATE_ITEM", instance: { id: "a" } }])).toBe(false);
  });
});
