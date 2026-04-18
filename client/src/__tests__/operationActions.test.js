// __tests__/operationActions.test.js
// Tests for resolveExpr template interpolation, FIND_MODULE, FIND_OCCURRENCE, CREATE_MODULE
import { describe, it, expect } from "vitest";
import { resolveExpr, evalRule, evalGroup, executeActionItem } from "../helpers/operationActions";

// ============================================================
// resolveExpr — template string interpolation
// ============================================================
describe("resolveExpr — template interpolation", () => {
  it("resolves ${$varName} inside a string", () => {
    const $vars = { $today: "2026-03-22" };
    expect(resolveExpr("daypage ${$today}", $vars)).toBe("daypage 2026-03-22");
  });

  it("resolves multiple interpolations in one string", () => {
    const $vars = { $year: "2026", $month: "March" };
    expect(resolveExpr("${$month} ${$year} report", $vars)).toBe("March 2026 report");
  });

  it("resolves nested dot notation inside interpolation", () => {
    const $vars = { $grid: { name: "MyGrid" } };
    expect(resolveExpr("grid: ${$grid.name}", $vars)).toBe("grid: MyGrid");
  });

  it("replaces missing vars with empty string", () => {
    const $vars = {};
    expect(resolveExpr("page ${$missing}", $vars)).toBe("page ");
  });

  it("does not interfere with plain $var resolution", () => {
    const $vars = { $today: "2026-03-22" };
    expect(resolveExpr("$today", $vars)).toBe("2026-03-22");
  });

  it("does not interfere with literal: prefix", () => {
    expect(resolveExpr("literal:hello", {})).toBe("hello");
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

// ============================================================
// FIND_MODULE action
// ============================================================
describe("FIND_MODULE action", () => {
  const makeContext = (modules = {}, occurrences = {}) => ({
    state: {},
    fieldsById: {},
    occurrencesById: occurrences,
    operationsById: {},
  });

  it("finds a module by name and sets $vars", () => {
    const $vars = {
      $allModules: {
        m1: { id: "m1", name: "daypage 2026-03-22", label: "daypage 2026-03-22" },
        m2: { id: "m2", name: "other", label: "other" },
      },
    };
    const updates = executeActionItem("FIND_MODULE", {
      nameExpr: "literal:daypage 2026-03-22",
      resultVar: "$foundModule",
      resultIdVar: "$foundModuleId",
    }, $vars, makeContext());

    expect(updates).toEqual([]);
    expect($vars.$foundModule).toEqual({ id: "m1", name: "daypage 2026-03-22", label: "daypage 2026-03-22" });
    expect($vars.$foundModuleId).toBe("m1");
  });

  it("finds by label when name doesn't match", () => {
    const $vars = {
      $allModules: {
        m1: { id: "m1", name: "internal", label: "Day Page March" },
      },
    };
    executeActionItem("FIND_MODULE", {
      nameExpr: "literal:Day Page March",
      resultVar: "$foundModule",
      resultIdVar: "$foundModuleId",
    }, $vars, makeContext());

    expect($vars.$foundModuleId).toBe("m1");
  });

  it("returns null when no match", () => {
    const $vars = {
      $allModules: {
        m1: { id: "m1", name: "something else", label: "something else" },
      },
    };
    executeActionItem("FIND_MODULE", {
      nameExpr: "literal:nonexistent",
    }, $vars, makeContext());

    expect($vars.$foundModule).toBe(null);
    expect($vars.$foundModuleId).toBe(null);
  });

  it("skips trashed modules", () => {
    const $vars = {
      $allModules: {
        m1: { id: "m1", name: "daypage", label: "daypage", trashed: true },
      },
    };
    executeActionItem("FIND_MODULE", {
      nameExpr: "literal:daypage",
    }, $vars, makeContext());

    expect($vars.$foundModule).toBe(null);
  });

  it("uses interpolated nameExpr", () => {
    const $vars = {
      $today: "2026-03-22",
      $allModules: {
        m1: { id: "m1", name: "daypage 2026-03-22", label: "daypage 2026-03-22" },
      },
    };
    executeActionItem("FIND_MODULE", {
      nameExpr: "daypage ${$today}",
    }, $vars, makeContext());

    expect($vars.$foundModuleId).toBe("m1");
  });
});

// ============================================================
// FIND_OCCURRENCE action
// ============================================================
describe("FIND_OCCURRENCE action", () => {
  const makeContext = (occurrences = {}) => ({
    state: {},
    fieldsById: {},
    occurrencesById: occurrences,
    operationsById: {},
  });

  it("finds an occurrence by targetId", () => {
    const occs = {
      o1: { id: "o1", targetId: "m1" },
      o2: { id: "o2", targetId: "m2" },
    };
    const $vars = { $allOccurrences: occs };
    executeActionItem("FIND_OCCURRENCE", {
      targetIdExpr: "literal:m1",
      resultVar: "$foundOcc",
      resultIdVar: "$foundOccId",
    }, $vars, makeContext(occs));

    expect($vars.$foundOcc).toEqual({ id: "o1", targetId: "m1" });
    expect($vars.$foundOccId).toBe("o1");
  });

  it("returns null when no match", () => {
    const $vars = { $allOccurrences: {} };
    executeActionItem("FIND_OCCURRENCE", {
      targetIdExpr: "literal:nonexistent",
    }, $vars, makeContext());

    expect($vars.$foundOccurrence).toBe(null);
    expect($vars.$foundOccurrenceId).toBe(null);
  });

  it("skips deleted occurrences", () => {
    const occs = {
      o1: { id: "o1", targetId: "m1", deleted: true },
    };
    const $vars = { $allOccurrences: occs };
    executeActionItem("FIND_OCCURRENCE", {
      targetIdExpr: "literal:m1",
    }, $vars, makeContext(occs));

    expect($vars.$foundOccurrence).toBe(null);
  });
});

// ============================================================
// CREATE_MODULE action
// ============================================================
describe("CREATE_MODULE action", () => {
  const makeContext = () => ({
    state: {},
    fieldsById: {},
    occurrencesById: {},
    operationsById: {},
  });

  it("returns a CREATE_MODULE effect with generated IDs", () => {
    const $vars = {};
    const updates = executeActionItem("CREATE_MODULE", {
      nameExpr: "literal:My New Page",
      role: "container",
      kind: "doc",
      parentId: "folder-123",
    }, $vars, makeContext());

    expect(updates).toHaveLength(1);
    expect(updates[0]._effect).toBe("CREATE_MODULE");
    expect(updates[0].name).toBe("My New Page");
    expect(updates[0].role).toBe("container");
    expect(updates[0].kind).toBe("doc");
    expect(updates[0].parentId).toBe("folder-123");
    expect(updates[0].moduleId).toBeTruthy();
    expect(updates[0].occurrenceId).toBeTruthy();
  });

  it("sets $lastCreatedModuleId and $lastCreatedOccurrenceId", () => {
    const $vars = {};
    const updates = executeActionItem("CREATE_MODULE", {
      nameExpr: "literal:Test Page",
    }, $vars, makeContext());

    expect($vars.$lastCreatedModuleId).toBe(updates[0].moduleId);
    expect($vars.$lastCreatedOccurrenceId).toBe(updates[0].occurrenceId);
  });

  it("resolves parentIdExpr from $vars", () => {
    const $vars = { $myFolder: "folder-abc" };
    const updates = executeActionItem("CREATE_MODULE", {
      nameExpr: "literal:Test",
      parentIdExpr: "$myFolder",
    }, $vars, makeContext());

    expect(updates[0].parentId).toBe("folder-abc");
  });

  it("resolves name with interpolation", () => {
    const $vars = { $activeDate: "2026-03-22" };
    const updates = executeActionItem("CREATE_MODULE", {
      nameExpr: "daypage ${$activeDate}",
      role: "container",
      kind: "doc",
    }, $vars, makeContext());

    expect(updates[0].name).toBe("daypage 2026-03-22");
  });

  it("defaults role to container and kind to doc", () => {
    const $vars = {};
    const updates = executeActionItem("CREATE_MODULE", {
      nameExpr: "literal:Test",
    }, $vars, makeContext());

    expect(updates[0].role).toBe("container");
    expect(updates[0].kind).toBe("doc");
  });

  it("returns empty when name resolves to null", () => {
    const $vars = {};
    const updates = executeActionItem("CREATE_MODULE", {
      nameExpr: "$nonexistent",
    }, $vars, makeContext());

    expect(updates).toHaveLength(0);
  });
});

// ============================================================
// Integration: full pipeline flow simulation
// ============================================================
describe("Day page pipeline flow (integration)", () => {
  const makeContext = (modules = {}, occurrences = {}) => ({
    state: {},
    fieldsById: {},
    occurrencesById: occurrences,
    operationsById: {},
  });

  it("creates a new page when none exists", () => {
    const $vars = {
      $activeDate: "2026-03-22",
      $allModules: {},
      $allOccurrences: {},
    };

    // Step 1: INIT_VAR $pageName ($ prefix so resolveExpr can find it)
    executeActionItem("INIT_VAR", { name: "$pageName", expr: "daypage ${$activeDate}" }, $vars, makeContext());
    expect($vars.$pageName).toBe("daypage 2026-03-22");

    // Step 2: FIND_MODULE
    executeActionItem("FIND_MODULE", { nameExpr: "$pageName", resultVar: "$existingModule" }, $vars, makeContext());
    expect($vars.$existingModule).toBe(null);

    // Step 3: Condition check
    const isEmpty = evalRule({ left: "$existingModule", comparator: "IS_EMPTY" }, $vars);
    expect(isEmpty).toBe(true);

    // Step 4: CREATE_MODULE (then branch)
    const updates = executeActionItem("CREATE_MODULE", {
      nameExpr: "$pageName",
      role: "container",
      kind: "doc",
      parentId: "folder-123",
    }, $vars, makeContext());
    expect(updates[0]._effect).toBe("CREATE_MODULE");
    expect(updates[0].name).toBe("daypage 2026-03-22");
    expect($vars.$lastCreatedOccurrenceId).toBeTruthy();
  });

  it("finds existing page and its occurrence", () => {
    const $vars = {
      $activeDate: "2026-03-22",
      $allModules: {
        m1: { id: "m1", name: "daypage 2026-03-22", label: "daypage 2026-03-22" },
      },
      $allOccurrences: {
        o1: { id: "o1", targetId: "m1" },
      },
    };

    // Step 1: INIT_VAR $pageName ($ prefix so resolveExpr can find it)
    executeActionItem("INIT_VAR", { name: "$pageName", expr: "daypage ${$activeDate}" }, $vars, makeContext());

    // Step 2: FIND_MODULE
    executeActionItem("FIND_MODULE", { nameExpr: "$pageName", resultVar: "$existingModule", resultIdVar: "$existingModuleId" }, $vars, makeContext());
    expect($vars.$existingModule).toBeTruthy();
    expect($vars.$existingModuleId).toBe("m1");

    // Step 3: Condition — module exists, so IS_EMPTY is false
    const isEmpty = evalRule({ left: "$existingModule", comparator: "IS_EMPTY" }, $vars);
    expect(isEmpty).toBe(false);

    // Step 4: FIND_OCCURRENCE (else branch)
    executeActionItem("FIND_OCCURRENCE", {
      targetIdExpr: "$existingModuleId",
      resultIdVar: "$lastCreatedOccurrenceId",
    }, $vars, makeContext($vars.$allOccurrences));
    expect($vars.$lastCreatedOccurrenceId).toBe("o1");

    // Step 5: UPDATE_VIEW would use $lastCreatedOccurrenceId
    const viewUpdates = executeActionItem("UPDATE_VIEW", {
      viewId: "view-123",
      activeOccurrenceId: "$lastCreatedOccurrenceId",
    }, $vars, makeContext());
    expect(viewUpdates[0]._effect).toBe("UPDATE_VIEW");
    expect(viewUpdates[0].patch.activeOccurrenceId).toBe("o1");
  });
});

// ============================================================
// resolveExpr — multi-level path resolution ($item.fields.water.value)
// ============================================================
describe("resolveExpr — multi-level path resolution", () => {
  it("resolves $item.fields.water.value through nested objects", () => {
    const $vars = {
      $item: {
        id: "o1",
        fields: { water: { value: 32, flow: "in" } },
      },
    };
    expect(resolveExpr("$item.fields.water.value", $vars)).toBe(32);
    expect(resolveExpr("$item.fields.water.flow", $vars)).toBe("in");
  });

  it("returns null when an intermediate path segment is missing", () => {
    const $vars = { $item: { id: "o1", fields: {} } };
    expect(resolveExpr("$item.fields.water.value", $vars)).toBe(null);
  });

  it("returns null when the root variable is missing", () => {
    expect(resolveExpr("$item.fields.water.value", {})).toBe(null);
  });

  it("walks arbitrary depth past the legacy 2-segment limit", () => {
    const $vars = { $a: { b: { c: { d: { e: "deep" } } } } };
    expect(resolveExpr("$a.b.c.d.e", $vars)).toBe("deep");
  });

  it("preserves _ancestors array when resolving $item._ancestors", () => {
    const $vars = { $item: { _ancestors: ["page1", "panel1", "grid1"] } };
    const got = resolveExpr("$item._ancestors", $vars);
    expect(got).toEqual(["page1", "panel1", "grid1"]);
  });

  it("returns flat back-compat field accessor alongside nested", () => {
    // gatherLoopItems exposes both $item.water (flat) AND $item.fields.water.value.
    const $vars = {
      $item: {
        water: 32,
        fields: { water: { value: 32, flow: "in" } },
      },
    };
    expect(resolveExpr("$item.water", $vars)).toBe(32);
    expect(resolveExpr("$item.fields.water.value", $vars)).toBe(32);
  });
});

// ============================================================
// evalRule — HAS_ANCESTOR / ARRAY_INCLUDES comparator
// ============================================================
describe("evalRule — HAS_ANCESTOR comparator", () => {
  it("returns true when the array contains the right value", () => {
    const $vars = { $item: { _ancestors: ["page-april-17", "schedule-panel", "grid1"] } };
    const rule = { left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: "page-april-17" };
    expect(evalRule(rule, $vars)).toBe(true);
  });

  it("returns false when the array does not contain the right value", () => {
    const $vars = { $item: { _ancestors: ["page-april-17", "schedule-panel"] } };
    const rule = { left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: "page-april-18" };
    expect(evalRule(rule, $vars)).toBe(false);
  });

  it("returns false on an empty ancestor array", () => {
    const $vars = { $item: { _ancestors: [] } };
    const rule = { left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: "anything" };
    expect(evalRule(rule, $vars)).toBe(false);
  });

  it("treats a non-array left value as empty (no match)", () => {
    const $vars = { $item: { _ancestors: "not-an-array" } };
    const rule = { left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: "x" };
    expect(evalRule(rule, $vars)).toBe(false);
  });

  it("ARRAY_INCLUDES alias behaves identically", () => {
    const $vars = { $item: { tags: ["work", "urgent"] } };
    expect(evalRule({ left: "$item.tags", comparator: "ARRAY_INCLUDES", right: "urgent" }, $vars)).toBe(true);
    expect(evalRule({ left: "$item.tags", comparator: "ARRAY_INCLUDES", right: "fun" }, $vars)).toBe(false);
  });

  it("resolves the right side as an expression (not a literal string)", () => {
    const $vars = {
      $foundOccurrenceId: "page-april-17",
      $item: { _ancestors: ["page-april-17", "schedule-panel"] },
    };
    const rule = { left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: "$foundOccurrenceId" };
    expect(evalRule(rule, $vars)).toBe(true);
  });

  it("coerces IDs to strings before comparison", () => {
    const $vars = { $item: { _ancestors: [123, 456] } };
    expect(evalRule({ left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: "123" }, $vars)).toBe(true);
    expect(evalRule({ left: "$item._ancestors", comparator: "HAS_ANCESTOR", right: 123 }, $vars)).toBe(true);
  });
});

// ============================================================
// evalRule — DATE_EQUALS / SAME_DAY comparator
// ============================================================
describe("evalRule — DATE_EQUALS comparator", () => {
  it("matches identical YYYY-MM-DD dates", () => {
    const rule = { left: "literal:2026-04-17", comparator: "DATE_EQUALS", right: "2026-04-17" };
    expect(evalRule(rule, {})).toBe(true);
  });

  it("matches an ISO timestamp against a YYYY-MM-DD filter", () => {
    const rule = { left: "literal:2026-04-17T17:00:00.000Z", comparator: "DATE_EQUALS", right: "2026-04-17" };
    expect(evalRule(rule, {})).toBe(true);
  });

  it("returns false when the days differ", () => {
    const rule = { left: "literal:2026-04-17", comparator: "DATE_EQUALS", right: "2026-04-18" };
    expect(evalRule(rule, {})).toBe(false);
  });

  it("treats null right as wildcard (matches anything, including null left)", () => {
    // $filterDate is null when no filter is active → must not exclude any occurrence.
    expect(evalRule({ left: "literal:2026-04-17", comparator: "DATE_EQUALS", right: null }, {})).toBe(true);
    expect(evalRule({ left: null, comparator: "DATE_EQUALS", right: null }, {})).toBe(true);
  });

  it("treats empty-string right as wildcard", () => {
    expect(evalRule({ left: "literal:2026-04-17", comparator: "DATE_EQUALS", right: "" }, {})).toBe(true);
  });

  it("returns false when left is null and right is a concrete date", () => {
    // Occurrence has no date — must not match a concrete filter.
    expect(evalRule({ left: null, comparator: "DATE_EQUALS", right: "2026-04-17" }, {})).toBe(false);
  });

  it("returns false on unparseable date strings", () => {
    expect(evalRule({ left: "literal:not-a-date", comparator: "DATE_EQUALS", right: "2026-04-17" }, {})).toBe(false);
  });

  it("SAME_DAY alias behaves identically", () => {
    expect(evalRule({ left: "literal:2026-04-17T08:00:00.000Z", comparator: "SAME_DAY", right: "2026-04-17" }, {})).toBe(true);
    expect(evalRule({ left: "literal:2026-04-17", comparator: "SAME_DAY", right: "2026-04-18" }, {})).toBe(false);
  });

  it("resolves $filterDate to a concrete date and matches accordingly", () => {
    const $vars = { $filterDate: "2026-04-17", $item: { fields: { date: { value: "2026-04-17T12:00:00.000Z" } } } };
    const rule = { left: "$item.fields.date.value", comparator: "DATE_EQUALS", right: "$filterDate" };
    expect(evalRule(rule, $vars)).toBe(true);
  });
});

// ============================================================
// SET_FILTER action — emits SET_FILTER effect
// ============================================================
describe("SET_FILTER action", () => {
  const makeContext = () => ({ state: {}, fieldsById: {}, occurrencesById: {}, operationsById: {} });

  it("emits a SET_FILTER effect with literal value", () => {
    const $vars = {};
    const updates = executeActionItem("SET_FILTER", {
      fieldId: "date",
      valueExpr: "literal:2026-04-17",
    }, $vars, makeContext());

    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({ _effect: "SET_FILTER", fieldId: "date", value: "2026-04-17" });
  });

  it("resolves valueExpr from $vars", () => {
    const $vars = { $today: "2026-04-17" };
    const updates = executeActionItem("SET_FILTER", {
      fieldId: "date",
      valueExpr: "$today",
    }, $vars, makeContext());

    expect(updates[0].value).toBe("2026-04-17");
  });

  it("coerces non-string values to strings", () => {
    const $vars = { $count: 5 };
    const updates = executeActionItem("SET_FILTER", {
      fieldId: "priority",
      valueExpr: "$count",
    }, $vars, makeContext());

    expect(updates[0].value).toBe("5");
    expect(typeof updates[0].value).toBe("string");
  });

  it("falls back to cfg.value when valueExpr is missing", () => {
    const $vars = {};
    const updates = executeActionItem("SET_FILTER", {
      fieldId: "date",
      value: "2026-04-18",
    }, $vars, makeContext());

    expect(updates[0].value).toBe("2026-04-18");
  });

  it("returns empty when fieldId is missing", () => {
    const updates = executeActionItem("SET_FILTER", { valueExpr: "literal:x" }, {}, makeContext());
    expect(updates).toHaveLength(0);
  });

  it("returns empty when value resolves to null", () => {
    const updates = executeActionItem("SET_FILTER", {
      fieldId: "date",
      valueExpr: "$nonexistent",
    }, {}, makeContext());
    expect(updates).toHaveLength(0);
  });
});
