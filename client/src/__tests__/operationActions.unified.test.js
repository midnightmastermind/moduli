// __tests__/operationActions.unified.test.js
// Replaces operationActions.test.js. Covers the unified four-verb engine
// (FIND, CREATE, UPDATE, DELETE) plus the still-relevant primitives
// (resolveExpr, evalRule, evalGroup, SET_FILTER).
import { describe, it, expect } from "vitest";
import { resolveExpr, evalRule, evalGroup, executeActionItem } from "../helpers/operationActions";

const makeContext = (extra = {}) => ({
  state: {},
  fieldsById: {},
  occurrencesById: {},
  operationsById: {},
  ...extra,
});

// ============================================================
// resolveExpr
// ============================================================
describe("resolveExpr — template interpolation", () => {
  it("resolves ${$varName} inside a string", () => {
    expect(resolveExpr("daypage ${$today}", { $today: "2026-03-22" })).toBe("daypage 2026-03-22");
  });

  it("resolves nested dot notation inside interpolation", () => {
    expect(resolveExpr("grid: ${$grid.name}", { $grid: { name: "MyGrid" } })).toBe("grid: MyGrid");
  });

  it("replaces missing vars with empty string", () => {
    expect(resolveExpr("page ${$missing}", {})).toBe("page ");
  });

  it("returns null for null/undefined/empty", () => {
    expect(resolveExpr(null, {})).toBe(null);
    expect(resolveExpr(undefined, {})).toBe(null);
    expect(resolveExpr("", {})).toBe(null);
  });

  it("returns non-string values as-is", () => {
    expect(resolveExpr(42, {})).toBe(42);
    expect(resolveExpr(true, {})).toBe(true);
  });
});

describe("resolveExpr — multi-level path resolution", () => {
  it("walks arbitrary depth on $vars[$item]", () => {
    const $vars = { $item: { fields: { water: { value: 16 } } } };
    expect(resolveExpr("$item.fields.water.value", $vars)).toBe(16);
  });

  it("returns null when an intermediate segment is missing", () => {
    expect(resolveExpr("$item.fields.water.value", { $item: { fields: {} } })).toBe(null);
  });

  it("preserves _ancestors array", () => {
    expect(resolveExpr("$item._ancestors", { $item: { _ancestors: ["a", "b"] } })).toEqual(["a", "b"]);
  });
});

// ============================================================
// evalRule — operators relied on by FIND predicates
// ============================================================
describe("evalRule — HAS_ANCESTOR comparator", () => {
  it("returns true when array contains the right value", () => {
    expect(evalRule({ left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: "p1" },
      { $item: { _ancestors: ["c1", "p1", "g1"] } })).toBe(true);
  });
  it("returns false when array does not contain", () => {
    expect(evalRule({ left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: "x" },
      { $item: { _ancestors: ["a", "b"] } })).toBe(false);
  });
  it("ARRAY_INCLUDES alias behaves identically", () => {
    expect(evalRule({ left: "$item._ancestors", comparator: "ARRAY_INCLUDES", right: "p1" },
      { $item: { _ancestors: ["p1"] } })).toBe(true);
  });
  it("resolves the right side as an expression", () => {
    expect(evalRule({ left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: "$pageId" },
      { $item: { _ancestors: ["page"] }, $pageId: "page" })).toBe(true);
  });
});

describe("evalRule — DATE_EQUALS / SAME_DAY", () => {
  it("matches identical YYYY-MM-DD dates", () => {
    expect(evalRule({ left: "2026-04-27", comparator: "SAME_DAY", right: "2026-04-27" }, {})).toBe(true);
  });
  it("returns false when days differ", () => {
    expect(evalRule({ left: "2026-04-27", comparator: "SAME_DAY", right: "2026-04-28" }, {})).toBe(false);
  });
});

// ============================================================
// FIND verb
// ============================================================
describe("FIND action", () => {
  const items = [
    { id: "i1", label: "Schedule", role: "page", meta: {}, fields: {} },
    { id: "i2", label: "Due",      role: "container", meta: { scheduleDueContainer: true }, fields: { f_date: { value: "2026-04-27" } } },
    { id: "i3", label: "Due",      role: "container", meta: { scheduleDueContainer: true }, fields: { f_date: { value: "2026-04-28" } } },
    { id: "i4", label: "trash",    role: "instance", meta: { isTemplate: true }, fields: {} },
  ];

  it("finds a single item by predicate and stores id", () => {
    const $vars = { $allItems: items };
    const updates = executeActionItem("FIND", {
      predicate: { operator: "AND", rules: [{ left: "$item.label", comparator: "IS", right: "Schedule" }] },
      itemIdVar: "$schedId",
    }, $vars, makeContext());
    expect(updates).toEqual([]);
    expect($vars.$schedId).toBe("i1");
  });

  it("stores the full item when itemVar is set", () => {
    const $vars = { $allItems: items };
    executeActionItem("FIND", {
      predicate: { operator: "AND", rules: [{ left: "$item.label", comparator: "IS", right: "Schedule" }] },
      itemVar: "$page",
    }, $vars, makeContext());
    expect($vars.$page.id).toBe("i1");
  });

  it("returns null when no match", () => {
    const $vars = { $allItems: items };
    executeActionItem("FIND", {
      predicate: { operator: "AND", rules: [{ left: "$item.label", comparator: "IS", right: "Nope" }] },
      itemIdVar: "$x",
    }, $vars, makeContext());
    expect($vars.$x).toBe(null);
  });

  it("filters by date scope", () => {
    const $vars = { $allItems: items, $today: "2026-04-27" };
    executeActionItem("FIND", {
      predicate: { operator: "AND", rules: [{ left: "$item.label", comparator: "IS", right: "Due" }] },
      scope: { dateFieldId: "f_date", dateExpr: "$today" },
      itemIdVar: "$dueId",
    }, $vars, makeContext());
    expect($vars.$dueId).toBe("i2");
  });

  it("returns array when multiple is true", () => {
    const $vars = { $allItems: items };
    executeActionItem("FIND", {
      predicate: { operator: "AND", rules: [{ left: "$item.label", comparator: "IS", right: "Due" }] },
      multiple: true,
      itemIdVar: "$dueIds",
    }, $vars, makeContext());
    expect($vars.$dueIds.sort()).toEqual(["i2", "i3"]);
  });

  it("skips template items (meta.isTemplate)", () => {
    const $vars = { $allItems: items };
    executeActionItem("FIND", {
      predicate: { operator: "AND", rules: [{ left: "$item.label", comparator: "IS", right: "trash" }] },
      itemIdVar: "$x",
    }, $vars, makeContext());
    expect($vars.$x).toBe(null);
  });
});

// ============================================================
// CREATE verb
// ============================================================
describe("CREATE action", () => {
  it("mints a new template when none exists with that label", () => {
    const $vars = { $allTemplates: [], $allItems: [] };
    const updates = executeActionItem("CREATE", {
      name: "Due", role: "container", kind: "list",
      meta: { scheduleDueContainer: true },
      itemIdVar: "$newId",
    }, $vars, makeContext());

    expect(updates).toHaveLength(1);
    expect(updates[0]._effect).toBe("CREATE_ITEM");
    expect(updates[0].template).toMatchObject({ label: "Due", role: "container", kind: "list" });
    expect(updates[0].instance.templateId).toBe(updates[0].template.id);
    expect($vars.$newId).toBe(updates[0].instance.id);
    // Optimistic publish
    expect($vars.$allTemplates).toHaveLength(1);
    expect($vars.$allItems).toHaveLength(1);
  });

  it("reuses an existing template when one matches by label", () => {
    const existing = { id: "tpl_existing", label: "Due", role: "container", kind: "list" };
    const $vars = { $allTemplates: [existing], $allItems: [] };
    const updates = executeActionItem("CREATE", {
      name: "Due", role: "container", kind: "list",
      itemIdVar: "$newId",
    }, $vars, makeContext());

    expect(updates).toHaveLength(1);
    expect(updates[0].template).toBe(null); // no new template minted
    expect(updates[0].instance.templateId).toBe("tpl_existing");
  });

  it("stamps a date field via cfg.date.fieldId/value", () => {
    const $vars = { $allTemplates: [], $allItems: [], $today: "2026-04-27" };
    const updates = executeActionItem("CREATE", {
      name: "Slot",
      date: { fieldId: "f_date", value: "$today" },
    }, $vars, makeContext());

    expect(updates[0].instance.fields.f_date).toEqual({ value: "2026-04-27", flow: "in" });
  });

  it("applies cfg.fields map of fieldId → expr", () => {
    const $vars = { $allTemplates: [], $allItems: [], $label: "7:00am" };
    const updates = executeActionItem("CREATE", {
      name: "Slot",
      fields: { f_slot: "$label", f_lit: "literal:Due" },
    }, $vars, makeContext());

    expect(updates[0].instance.fields.f_slot).toEqual({ value: "7:00am", flow: "in" });
    expect(updates[0].instance.fields.f_lit).toEqual({ value: "Due", flow: "in" });
  });

  it("resolves cfg.parent expression to instance.parentId", () => {
    const $vars = { $allTemplates: [], $allItems: [], $schedPageId: "page1" };
    const updates = executeActionItem("CREATE", {
      name: "Slot",
      parent: "$schedPageId",
    }, $vars, makeContext());

    expect(updates[0].instance.parentId).toBe("page1");
  });

  it("emits no effect when name resolves to null", () => {
    const $vars = { $allTemplates: [], $allItems: [] };
    const updates = executeActionItem("CREATE", { name: null }, $vars, makeContext());
    expect(updates).toEqual([]);
  });
});

// ============================================================
// UPDATE verb
// ============================================================
describe("UPDATE action", () => {
  it("routes $item.fields.<id>.value to UPDATE_ITEM_FIELD", () => {
    const $vars = { $item: { id: "occ1" } };
    const updates = executeActionItem("UPDATE", {
      path: "$item.fields.f_water.value",
      value: "literal:16",
    }, $vars, makeContext());

    expect(updates).toEqual([{
      _effect: "UPDATE_ITEM_FIELD",
      itemId: "occ1",
      fieldId: "f_water",
      value: 16,
      subKind: "value",
    }]);
  });

  it("routes $item.parentId to UPDATE_ITEM_PARENT", () => {
    const $vars = { $item: { id: "todo1" }, $dueId: "due1" };
    const updates = executeActionItem("UPDATE", {
      path: "$item.parentId",
      value: "$dueId",
    }, $vars, makeContext());

    expect(updates[0]._effect).toBe("UPDATE_ITEM_PARENT");
    expect(updates[0].itemId).toBe("todo1");
    expect(updates[0].toParentId).toBe("due1");
  });

  it("routes $item.meta.<key> to UPDATE_ITEM_META", () => {
    const $vars = { $item: { id: "occ1" } };
    const updates = executeActionItem("UPDATE", {
      path: "$item.meta.starred",
      value: "literal:true",
    }, $vars, makeContext());

    expect(updates[0]._effect).toBe("UPDATE_ITEM_META");
    expect(updates[0].metaPatch).toEqual({ starred: true });
  });

  it("interpolates ${$var} inside path", () => {
    const $vars = { $goalId: "goal1" };
    const updates = executeActionItem("UPDATE", {
      path: "$display.f_total.${$goalId}",
      value: "literal:42",
    }, $vars, makeContext());

    expect(updates[0]._effect).toBe("UPDATE_DISPLAY_VALUE");
    expect(updates[0].fieldId).toBe("f_total");
    expect(updates[0].itemId).toBe("goal1");
    expect(updates[0].value).toBe(42);
  });

  it("single-segment $<var> writes to varWrites (no effect)", () => {
    const $vars = { $existing: "before" };
    const updates = executeActionItem("UPDATE", {
      path: "$existing",
      value: "literal:after",
    }, $vars, makeContext());

    expect(updates).toEqual([]);
    expect($vars.$existing).toBe("after");
  });

  it("emits nothing when path is empty", () => {
    const updates = executeActionItem("UPDATE", { path: "", value: 1 }, {}, makeContext());
    expect(updates).toEqual([]);
  });
});

// ============================================================
// DELETE verb
// ============================================================
describe("DELETE action", () => {
  it("emits DELETE_ITEM with resolved itemIdExpr", () => {
    const $vars = { $todoId: "todo1" };
    const updates = executeActionItem("DELETE", { itemIdExpr: "$todoId" }, $vars, makeContext());
    expect(updates).toEqual([{ _effect: "DELETE_ITEM", itemId: "todo1" }]);
  });

  it("emits nothing when itemIdExpr resolves to null", () => {
    const updates = executeActionItem("DELETE", { itemIdExpr: "$nope" }, {}, makeContext());
    expect(updates).toEqual([]);
  });

  it("accepts a literal id", () => {
    const updates = executeActionItem("DELETE", { itemIdExpr: "literal:abc" }, {}, makeContext());
    expect(updates).toEqual([{ _effect: "DELETE_ITEM", itemId: "abc" }]);
  });
});

// ============================================================
// SET_FILTER (kept primitive)
// ============================================================
describe("SET_FILTER action", () => {
  it("emits a SET_FILTER effect with literal value", () => {
    const updates = executeActionItem("SET_FILTER", {
      fieldId: "f_date", valueExpr: "literal:2026-04-27",
    }, {}, makeContext());
    expect(updates[0]).toMatchObject({ fieldId: "f_date", value: "2026-04-27" });
  });
});
