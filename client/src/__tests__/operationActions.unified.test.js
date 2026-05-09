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
    const $vars = { $allOccurrences: items, $allItems: items };
    const updates = executeActionItem("FIND", {
      predicate: { operator: "AND", rules: [{ left: "$item.label", comparator: "IS", right: "Schedule" }] },
      itemIdVar: "$schedId",
    }, $vars, makeContext());
    expect(updates).toEqual([]);
    expect($vars.$schedId).toBe("i1");
  });

  it("stores the full item when itemVar is set", () => {
    const $vars = { $allOccurrences: items, $allItems: items };
    executeActionItem("FIND", {
      predicate: { operator: "AND", rules: [{ left: "$item.label", comparator: "IS", right: "Schedule" }] },
      itemVar: "$page",
    }, $vars, makeContext());
    expect($vars.$page.id).toBe("i1");
  });

  it("returns null when no match", () => {
    const $vars = { $allOccurrences: items, $allItems: items };
    executeActionItem("FIND", {
      predicate: { operator: "AND", rules: [{ left: "$item.label", comparator: "IS", right: "Nope" }] },
      itemIdVar: "$x",
    }, $vars, makeContext());
    expect($vars.$x).toBe(null);
  });

  it("filters by date inside the predicate (SAME_DAY rule)", () => {
    const $vars = { $allOccurrences: items, $allItems: items, $today: "2026-04-27" };
    executeActionItem("FIND", {
      predicate: { operator: "AND", rules: [
        { left: "label", comparator: "IS", right: "Due" },
        { left: "fields.f_date.value", comparator: "SAME_DAY", right: "$today" },
      ]},
      itemIdVar: "$dueId",
    }, $vars, makeContext());
    expect($vars.$dueId).toBe("i2");
  });

  it("returns array when multiple is true", () => {
    const $vars = { $allOccurrences: items, $allItems: items };
    executeActionItem("FIND", {
      predicate: { operator: "AND", rules: [{ left: "$item.label", comparator: "IS", right: "Due" }] },
      multiple: true,
      itemIdVar: "$dueIds",
    }, $vars, makeContext());
    expect($vars.$dueIds.sort()).toEqual(["i2", "i3"]);
  });

  it("skips template items (meta.isTemplate)", () => {
    const $vars = { $allOccurrences: items, $allItems: items };
    executeActionItem("FIND", {
      predicate: { operator: "AND", rules: [{ left: "$item.label", comparator: "IS", right: "trash" }] },
      itemIdVar: "$x",
    }, $vars, makeContext());
    expect($vars.$x).toBe(null);
  });

  // Regression: seed dedup FIND scopes to schedule descendants.
  // The seed FIND must locate previously-created (template, slot, date) tuples
  // even when a stray occurrence with the same template lives outside the schedule.
  it("matches a seeded copy by templateId + timeslot + date + ancestor scope", () => {
    const enriched = [
      // The original Drink Water in the toolkit (no timeslot, no date) — must NOT match.
      {
        id: "occ_orig", label: "Drink Water", role: "instance",
        targetId: "mod_drinkwater", templateId: "mod_drinkwater",
        meta: {}, fields: {},
        _ancestors: ["cont_toolkit", "page_toolkit"],
      },
      // Yesterday's seeded copy under Schedule.
      {
        id: "occ_yest", label: "Drink Water", role: "instance",
        targetId: "mod_drinkwater", templateId: "mod_drinkwater",
        meta: {},
        fields: {
          f_date:     { value: "2026-05-04" },
          f_timeslot: { value: "6:00am" },
        },
        _ancestors: ["slot_6am", "page_sched"],
      },
      // Today's seeded copy under Schedule — what we want the FIND to return.
      {
        id: "occ_today", label: "Drink Water", role: "instance",
        targetId: "mod_drinkwater", templateId: "mod_drinkwater",
        meta: {},
        fields: {
          f_date:     { value: "2026-05-05" },
          f_timeslot: { value: "6:00am" },
        },
        _ancestors: ["slot_6am", "page_sched"],
      },
    ];
    const $vars = {
      $allOccurrences: enriched, $allItems: enriched,
      $srcTemplateId: "mod_drinkwater",
      $schedDate: "2026-05-05",
      $schedPageId: "page_sched",
    };
    executeActionItem("FIND", {
      predicate: { operator: "AND", rules: [
        { left: "templateId",            comparator: "IS",           right: "$srcTemplateId" },
        { left: "fields.f_timeslot.value", comparator: "IS",         right: "6:00am" },
        { left: "fields.f_date.value",   comparator: "SAME_DAY",     right: "$schedDate" },
        { left: "_ancestors",            comparator: "HAS_ANCESTOR", right: "$schedPageId" },
      ]},
      itemIdVar: "$existingId",
    }, $vars, makeContext());
    expect($vars.$existingId).toBe("occ_today");
  });

  // Regression: tolerate the legacy "$item." prefix on rule.left so DB rows
  // saved before the predicate was switched to bare record paths still match.
  it("accepts legacy $item. prefix on rule.left", () => {
    const enriched = [
      { id: "occ1", label: "x", templateId: "mod1", fields: { f_date: { value: "2026-05-05" } } },
    ];
    const $vars = { $allOccurrences: enriched, $allItems: enriched, $schedDate: "2026-05-05" };
    executeActionItem("FIND", {
      predicate: { operator: "AND", rules: [
        { left: "$item.fields.f_date.value", comparator: "SAME_DAY", right: "$schedDate" },
      ]},
      itemIdVar: "$id",
    }, $vars, makeContext());
    expect($vars.$id).toBe("occ1");
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

  it("stamps a date field via the fields map (cfg.fields[fieldId] = $expr)", () => {
    const $vars = { $allTemplates: [], $allItems: [], $today: "2026-04-27" };
    const fieldsById = { f_date: { id: "f_date", type: "date" } };
    const updates = executeActionItem("CREATE", {
      name: "Slot",
      fields: { f_date: "$today" },
    }, $vars, { state: {}, fieldsById, occurrencesById: {}, operationsById: {} });

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

  // Regression: cross-recursion dedup. When an op CREATEs an instance and
  // then RUN_OPERATIONs into a child op, the child's parentByChildId rebuild
  // must see the new linkage so HAS_ANCESTOR predicates match the just-
  // created row. Prior bug: CREATE published the new instance to
  // context.occurrencesById but never appended it to the parent's
  // occurrences[], so the recursive callee's _ancestors came back empty,
  // dedup FINDs missed the row, and seed-style ops created duplicates at
  // every recursion level (up to the depth-4 cap).
  it("appends new instance to parent.occurrences in the overlay", () => {
    const slotOcc = { id: "slot1", occurrences: [] };
    const pageOcc = { id: "page1", occurrences: ["slot1"] };
    const occurrencesById = { slot1: slotOcc, page1: pageOcc };
    const $vars = { $allTemplates: [], $allItems: [], $allOccurrences: [], $slotId: "slot1" };
    const updates = executeActionItem("CREATE", {
      name: "Drink Water", role: "instance", parent: "$slotId",
    }, $vars, { state: {}, fieldsById: {}, occurrencesById, operationsById: {} });

    const newId = updates[0].instance.id;
    // Parent slot in the overlay now lists the new child.
    expect(occurrencesById.slot1.occurrences).toContain(newId);
    // Original cached slot object is NOT mutated (we spread it).
    expect(slotOcc.occurrences).toEqual([]);
  });

  it("populates _ancestors on the new instance from the parent chain", () => {
    const slotOcc = { id: "slot1", occurrences: [], parentId: "page1" };
    const pageOcc = { id: "page1", occurrences: ["slot1"], parentId: null };
    const occurrencesById = { slot1: slotOcc, page1: pageOcc };
    const $vars = { $allTemplates: [], $allItems: [], $allOccurrences: [], $slotId: "slot1" };
    executeActionItem("CREATE", {
      name: "Drink Water", role: "instance", parent: "$slotId",
    }, $vars, { state: {}, fieldsById: {}, occurrencesById, operationsById: {} });

    const newRow = $vars.$allItems[0];
    // Ancestors walk via parentId fallback when _parentByChildId isn't passed.
    expect(newRow._ancestors).toEqual(["slot1", "page1"]);
  });

  it("uses _parentByChildId when present to compute _ancestors", () => {
    // Slots typically don't carry parentId — the parent is derived from
    // page.occurrences[]. Mirror that here: the executor builds
    // _parentByChildId from .occurrences[] arrays and passes it in context.
    const slotOcc = { id: "slot1", occurrences: [] };
    const pageOcc = { id: "page1", occurrences: ["slot1"] };
    const occurrencesById = { slot1: slotOcc, page1: pageOcc };
    const _parentByChildId = { slot1: "page1" };
    const $vars = { $allTemplates: [], $allItems: [], $allOccurrences: [], $slotId: "slot1" };
    executeActionItem("CREATE", {
      name: "Drink Water", role: "instance", parent: "$slotId",
    }, $vars, { state: {}, fieldsById: {}, occurrencesById, operationsById: {}, _parentByChildId });

    const newRow = $vars.$allItems[0];
    expect(newRow._ancestors).toEqual(["slot1", "page1"]);
    // _parentByChildId is updated so the next FIND that walks it sees the link.
    expect(_parentByChildId[newRow.id]).toBe("slot1");
  });

  it("dedups same-pipeline FIND with HAS_ANCESTOR after CREATE", () => {
    // The smoking-gun scenario: a seed-style pipeline creates an item, then
    // a follow-up FIND with HAS_ANCESTOR must find that item — otherwise the
    // dedup fails and the next loop iteration / recursive call re-creates it.
    const slotOcc = { id: "slot1", occurrences: [], parentId: "page1" };
    const pageOcc = { id: "page1", occurrences: ["slot1"], parentId: null };
    const occurrencesById = { slot1: slotOcc, page1: pageOcc };
    const $vars = {
      $allTemplates: [],
      $allItems: [],
      $allOccurrences: [],
      $slotId: "slot1",
      $pageId: "page1",
    };

    executeActionItem("CREATE", {
      name: "Drink Water", role: "instance", parent: "$slotId",
    }, $vars, { state: {}, fieldsById: {}, occurrencesById, operationsById: {} });

    executeActionItem("FIND", {
      predicate: { operator: "AND", rules: [
        { left: "_ancestors", comparator: "HAS_ANCESTOR", right: "$pageId" },
      ]},
      itemIdVar: "$found",
    }, $vars, { state: {}, fieldsById: {}, occurrencesById, operationsById: {} });

    expect($vars.$found).toBe($vars.$allItems[0].id);
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
