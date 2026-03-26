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
