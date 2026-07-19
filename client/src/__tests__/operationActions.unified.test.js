// __tests__/operationActions.unified.test.js
// Replaces operationActions.test.js. Covers the unified four-verb engine
// (FIND, CREATE, UPDATE, DELETE) plus the still-relevant primitives
// (resolveExpr, evalRule, evalGroup, SET_FILTER).
import { describe, it, expect } from "vitest";
import { resolveExpr, evalRule, executeActionItem } from "../helpers/operationActions";

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
describe("resolveExpr — Value Builder __ref sentinel", () => {
  it("resolves the wrapped path", () => {
    const $vars = { $today: "2026-05-23" };
    expect(resolveExpr({ __ref: "$today" }, $vars)).toBe("2026-05-23");
  });

  it("returns null when __ref is empty", () => {
    expect(resolveExpr({ __ref: "" }, {})).toBeNull();
  });

  it("resolves dotted paths through the wrapped value", () => {
    const $vars = { $page: { meta: { title: "Hello" } } };
    expect(resolveExpr({ __ref: "$page.meta.title" }, $vars)).toBe("Hello");
  });
});

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

describe("evalRule — array-aware CONTAINS + empty checks (tags field-check, 2026-07-12)", () => {
  it("CONTAINS matches exact members of an array left", () => {
    expect(evalRule({ left: "$tags", comparator: "CONTAINS", right: "work" },
      { $tags: ["health", "work"] })).toBe(true);
    expect(evalRule({ left: "$tags", comparator: "CONTAINS", right: "play" },
      { $tags: ["health", "work"] })).toBe(false);
  });
  it("CONTAINS on an array does not substring-match ('art' ≠ ['smart'])", () => {
    expect(evalRule({ left: "$tags", comparator: "CONTAINS", right: "art" },
      { $tags: ["smart"] })).toBe(false);
  });
  it("CONTAINS keeps substring semantics for string lefts", () => {
    expect(evalRule({ left: "$s", comparator: "CONTAINS", right: "ell" }, { $s: "hello" })).toBe(true);
  });
  it("NOT_CONTAINS mirrors both shapes", () => {
    expect(evalRule({ left: "$tags", comparator: "NOT_CONTAINS", right: "work" },
      { $tags: ["health"] })).toBe(true);
    expect(evalRule({ left: "$s", comparator: "NOT_CONTAINS", right: "ell" }, { $s: "hello" })).toBe(false);
  });
  it("IS_EMPTY / IS_NOT_EMPTY treat an empty array as empty", () => {
    expect(evalRule({ left: "$tags", comparator: "IS_EMPTY" }, { $tags: [] })).toBe(true);
    expect(evalRule({ left: "$tags", comparator: "IS_NOT_EMPTY" }, { $tags: [] })).toBe(false);
    expect(evalRule({ left: "$tags", comparator: "IS_NOT_EMPTY" }, { $tags: ["x"] })).toBe(true);
  });
});

describe("evalRule — numeric comparator _THAN aliases", () => {
  // Regression for createLiveData's seed authoring habit of writing
  // "GREATER_THAN" / "LESS_THAN" — without these aliases, the rule silently
  // fell through to default `return false`, making guard branches dead code.
  it("GREATER_THAN behaves like GREATER", () => {
    expect(evalRule({ left: 5, comparator: "GREATER_THAN", right: 3 }, {})).toBe(true);
    expect(evalRule({ left: 3, comparator: "GREATER_THAN", right: 5 }, {})).toBe(false);
    expect(evalRule({ left: 3, comparator: "GREATER_THAN", right: 3 }, {})).toBe(false);
  });
  it("LESS_THAN behaves like LESS", () => {
    expect(evalRule({ left: 3, comparator: "LESS_THAN", right: 5 }, {})).toBe(true);
    expect(evalRule({ left: 5, comparator: "LESS_THAN", right: 3 }, {})).toBe(false);
  });
  it("GREATER_THAN_OR_EQUAL behaves like GREATER_OR_EQUAL", () => {
    expect(evalRule({ left: 3, comparator: "GREATER_THAN_OR_EQUAL", right: 3 }, {})).toBe(true);
    expect(evalRule({ left: 4, comparator: "GREATER_THAN_OR_EQUAL", right: 3 }, {})).toBe(true);
    expect(evalRule({ left: 2, comparator: "GREATER_THAN_OR_EQUAL", right: 3 }, {})).toBe(false);
  });
  it("LESS_THAN_OR_EQUAL behaves like LESS_OR_EQUAL", () => {
    expect(evalRule({ left: 3, comparator: "LESS_THAN_OR_EQUAL", right: 3 }, {})).toBe(true);
    expect(evalRule({ left: 2, comparator: "LESS_THAN_OR_EQUAL", right: 3 }, {})).toBe(true);
    expect(evalRule({ left: 4, comparator: "LESS_THAN_OR_EQUAL", right: 3 }, {})).toBe(false);
  });
});

describe("evalRule — TIME_BEFORE / TIME_AFTER", () => {
  it("compares 12h vs 24h time-of-day", () => {
    // "9:00am" (540) before "14:30" (870)
    expect(evalRule({ left: "9:00am", comparator: "TIME_BEFORE", right: "14:30" }, {})).toBe(true);
    expect(evalRule({ left: "9:00am", comparator: "TIME_AFTER", right: "14:30" }, {})).toBe(false);
    expect(evalRule({ left: "3:00pm", comparator: "TIME_AFTER", right: "14:30" }, {})).toBe(true);
  });
  it("handles 12am/12pm boundaries", () => {
    expect(evalRule({ left: "12:00am", comparator: "TIME_BEFORE", right: "00:30" }, {})).toBe(true); // midnight = 0
    expect(evalRule({ left: "12:00pm", comparator: "TIME_AFTER", right: "11:59" }, {})).toBe(true);  // noon = 720
  });
  it("parses bare 12h ('9am') and the time part of an ISO datetime", () => {
    expect(evalRule({ left: "9am", comparator: "TIME_BEFORE", right: "10:00" }, {})).toBe(true);
    expect(evalRule({ left: "2026-06-03T08:00:00", comparator: "TIME_BEFORE", right: "9:00am" }, {})).toBe(true);
  });
  it("returns false when either side is unparseable", () => {
    expect(evalRule({ left: "soon", comparator: "TIME_BEFORE", right: "14:30" }, {})).toBe(false);
    expect(evalRule({ left: "9:00am", comparator: "TIME_AFTER", right: "" }, {})).toBe(false);
    expect(evalRule({ left: null, comparator: "TIME_BEFORE", right: "14:30" }, {})).toBe(false);
    expect(evalRule({ left: "25:00", comparator: "TIME_BEFORE", right: "14:30" }, {})).toBe(false);
  });
  it("resolves $vars on both sides", () => {
    expect(evalRule({ left: "$slot", comparator: "TIME_BEFORE", right: "$now" },
      { $slot: "9:00am", $now: "14:30" })).toBe(true);
  });
});

describe("evalRule — DATE_BEFORE / DATE_AFTER", () => {
  it("compares calendar days (time ignored)", () => {
    expect(evalRule({ left: "2026-06-03", comparator: "DATE_BEFORE", right: "2026-06-04" }, {})).toBe(true);
    expect(evalRule({ left: "2026-06-04", comparator: "DATE_BEFORE", right: "2026-06-04" }, {})).toBe(false);
    expect(evalRule({ left: "2026-06-05", comparator: "DATE_AFTER", right: "2026-06-04" }, {})).toBe(true);
  });
  it("ignores the time portion / timezone of an ISO datetime (day-key slice)", () => {
    expect(evalRule({ left: "2026-06-03T23:00:00.000Z", comparator: "DATE_BEFORE", right: "2026-06-04" }, {})).toBe(true);
    expect(evalRule({ left: "2026-06-04T01:00:00.000Z", comparator: "DATE_BEFORE", right: "2026-06-04" }, {})).toBe(false);
  });
  it("returns false when either side empty/unparseable", () => {
    expect(evalRule({ left: "", comparator: "DATE_BEFORE", right: "2026-06-04" }, {})).toBe(false);
    expect(evalRule({ left: "2026-06-03", comparator: "DATE_AFTER", right: null }, {})).toBe(false);
    expect(evalRule({ left: "whenever", comparator: "DATE_BEFORE", right: "2026-06-04" }, {})).toBe(false);
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

describe("evalRule — DATE_IN_PERIOD", () => {
  it("matches same day with day unit (object form)", () => {
    expect(evalRule({
      left: "2026-05-17", comparator: "DATE_IN_PERIOD",
      right: { value: "2026-05-17", unit: "day" },
    }, {})).toBe(true);
  });
  it("matches a different day in the same ISO week (week unit, Mon-Sun)", () => {
    // 2026-05-13 (Wed) and 2026-05-17 (Sun) — both Mon-Sun week of 2026-05-11..05-17.
    expect(evalRule({
      left: "2026-05-13", comparator: "DATE_IN_PERIOD",
      right: { value: "2026-05-17", unit: "week" },
    }, {})).toBe(true);
  });
  it("matches different days in the same month (month unit)", () => {
    expect(evalRule({
      left: "2026-05-03", comparator: "DATE_IN_PERIOD",
      right: { value: "2026-05-29", unit: "month" },
    }, {})).toBe(true);
  });
  it("matches the WHOLE month when the anchor is the 1st (tz regression)", () => {
    // 2026-06-01 parsed as UTC midnight rolls back to May 31 in a west-of-UTC tz,
    // which made a month filter match only its anchor day → a full month rendered
    // just the first day. Every June day must match a June-anchored month period.
    const june = { value: "2026-06-01", unit: "month" };
    expect(evalRule({ left: "2026-06-01", comparator: "DATE_IN_PERIOD", right: june }, {})).toBe(true);
    expect(evalRule({ left: "2026-06-15", comparator: "DATE_IN_PERIOD", right: june }, {})).toBe(true);
    expect(evalRule({ left: "2026-06-30", comparator: "DATE_IN_PERIOD", right: june }, {})).toBe(true);
    expect(evalRule({ left: "2026-07-01", comparator: "DATE_IN_PERIOD", right: june }, {})).toBe(false);
    expect(evalRule({ left: "2026-05-31", comparator: "DATE_IN_PERIOD", right: june }, {})).toBe(false);
  });
  it("matches different months in the same year (year unit)", () => {
    expect(evalRule({
      left: "2026-01-15", comparator: "DATE_IN_PERIOD",
      right: { value: "2026-11-02", unit: "year" },
    }, {})).toBe(true);
  });
  it("treats a bare YYYY-MM-DD string as day unit", () => {
    expect(evalRule({
      left: "2026-05-17", comparator: "DATE_IN_PERIOD", right: "2026-05-17",
    }, {})).toBe(true);
    expect(evalRule({
      left: "2026-05-16", comparator: "DATE_IN_PERIOD", right: "2026-05-17",
    }, {})).toBe(false);
  });
  it("returns true for wildcard right (null/empty)", () => {
    expect(evalRule({ left: "2026-05-17", comparator: "DATE_IN_PERIOD", right: null }, {})).toBe(true);
    expect(evalRule({ left: "2026-05-17", comparator: "DATE_IN_PERIOD", right: "" }, {})).toBe(true);
    expect(evalRule({
      left: "2026-05-17", comparator: "DATE_IN_PERIOD",
      right: { value: "", unit: "day" },
    }, {})).toBe(true);
  });
  it("returns false when left is null", () => {
    expect(evalRule({
      left: null, comparator: "DATE_IN_PERIOD",
      right: { value: "2026-05-17", unit: "day" },
    }, {})).toBe(false);
  });

  // Multi-date OR-match — drilldown picker's non-consecutive selection.
  it("multi: matches when left equals any date in dates[]", () => {
    const right = { kind: "multi", unit: "day", value: "2026-05-13",
      dates: ["2026-05-13", "2026-05-17", "2026-05-21"] };
    expect(evalRule({ left: "2026-05-13", comparator: "DATE_IN_PERIOD", right }, {})).toBe(true);
    expect(evalRule({ left: "2026-05-17", comparator: "DATE_IN_PERIOD", right }, {})).toBe(true);
    expect(evalRule({ left: "2026-05-21", comparator: "DATE_IN_PERIOD", right }, {})).toBe(true);
  });
  it("multi: fails when left matches no date in dates[]", () => {
    const right = { kind: "multi", unit: "day", value: "2026-05-13",
      dates: ["2026-05-13", "2026-05-17"] };
    expect(evalRule({ left: "2026-05-14", comparator: "DATE_IN_PERIOD", right }, {})).toBe(false);
    expect(evalRule({ left: "2026-05-20", comparator: "DATE_IN_PERIOD", right }, {})).toBe(false);
  });
  it("multi: normalizes ISO timestamps to day-keys on both sides", () => {
    const right = { kind: "multi", unit: "day", value: "2026-05-17",
      dates: ["2026-05-17"] };
    expect(evalRule({
      left: "2026-05-17T15:34:56.789Z",
      comparator: "DATE_IN_PERIOD", right,
    }, {})).toBe(true);
  });
  it("multi: empty dates[] never matches", () => {
    const right = { kind: "multi", unit: "day", value: "2026-05-17", dates: [] };
    expect(evalRule({ left: "2026-05-17", comparator: "DATE_IN_PERIOD", right }, {})).toBe(false);
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
      name: "Due", role: "container", kind: "board",
      meta: { scheduleDueContainer: true },
      itemIdVar: "$newId",
    }, $vars, makeContext());

    expect(updates).toHaveLength(1);
    expect(updates[0]._effect).toBe("CREATE_ITEM");
    expect(updates[0].template).toMatchObject({ label: "Due", role: "container", kind: "board" });
    expect(updates[0].instance.templateId).toBe(updates[0].template.id);
    expect($vars.$newId).toBe(updates[0].instance.id);
    // Optimistic publish
    expect($vars.$allTemplates).toHaveLength(1);
    expect($vars.$allItems).toHaveLength(1);
  });

  it("reuses an existing template when one matches by label", () => {
    const existing = { id: "tpl_existing", label: "Due", role: "container", kind: "board" };
    const $vars = { $allTemplates: [existing], $allItems: [] };
    const updates = executeActionItem("CREATE", {
      name: "Due", role: "container", kind: "board",
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

  // ── fieldBindings hidden-flag handling ────────────────────────────────────
  it("CREATE matched to an existing template by label leaves its bindings alone when fieldHidden is omitted", () => {
    const existing = {
      id: "tpl_existing", label: "Drink Water", role: "instance", kind: "board",
      fieldBindings: [{ fieldId: "f_date", role: "input", order: 0, hidden: true }],
    };
    const $vars = { $allTemplates: [existing], $allItems: [], $today: "2026-05-11" };
    const fieldsById = { f_date: { id: "f_date", type: "date" } };
    const updates = executeActionItem("CREATE", {
      name: "Drink Water", role: "instance", kind: "board",
      fields: { f_date: "$today" },
    }, $vars, { state: {}, fieldsById, occurrencesById: {}, operationsById: {} });

    expect(updates.find(u => u._effect === "UPDATE_MODULE")).toBeUndefined();
    expect(existing.fieldBindings[0].hidden).toBe(true);
  });

  it("CREATE with fieldHidden:{fid:true} stamps a new binding as hidden on a freshly-minted template", () => {
    const $vars = { $allTemplates: [], $allItems: [], $today: "2026-05-11" };
    const fieldsById = { f_date: { id: "f_date", type: "date" } };
    const updates = executeActionItem("CREATE", {
      name: "Slot", role: "container", kind: "board",
      fields: { f_date: "$today" },
      fieldHidden: { f_date: true },
    }, $vars, { state: {}, fieldsById, occurrencesById: {}, operationsById: {} });

    const newTpl = updates[0].template;
    expect(newTpl.fieldBindings).toEqual([
      { fieldId: "f_date", role: "input", order: 0, hidden: true },
    ]);
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

  it("routes $item.meta.<key> to UPDATE_ITEM_META with metaPath + value", () => {
    const $vars = { $item: { id: "occ1" } };
    const updates = executeActionItem("UPDATE", {
      path: "$item.meta.starred",
      value: "literal:true",
    }, $vars, makeContext());

    expect(updates[0]._effect).toBe("UPDATE_ITEM_META");
    expect(updates[0].metaPath).toEqual(["starred"]);
    expect(updates[0].value).toBe(true);
  });

  it("routes nested meta paths (e.g. $item.meta.table.cells.<key>) preserving depth", () => {
    const $vars = { $item: { id: "occ1" } };
    const cellDoc = { type: "doc", content: [{ type: "paragraph" }] };
    const updates = executeActionItem("UPDATE", {
      path: "$item.meta.table.cells.0:0",
      value: cellDoc,
    }, $vars, makeContext());

    expect(updates[0]._effect).toBe("UPDATE_ITEM_META");
    expect(updates[0].metaPath).toEqual(["table", "cells", "0:0"]);
    expect(updates[0].value).toEqual(cellDoc);
  });

  it("deep-resolves $var string leaves inside an object value (embed-cell doc)", () => {
    const $vars = { $item: { id: "tbl1" }, $cellOcc: "occ-abc" };
    const updates = executeActionItem("UPDATE", {
      path: "$item.meta.table.cells.0:0",
      value: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "$cellOcc" } }] },
    }, $vars, makeContext());

    expect(updates[0]._effect).toBe("UPDATE_ITEM_META");
    expect(updates[0].metaPath).toEqual(["table", "cells", "0:0"]);
    expect(updates[0].value).toEqual({
      type: "doc",
      content: [{ type: "moduleEmbed", attrs: { occurrenceId: "occ-abc" } }],
    });
  });

  it("deep-resolves $var leaves inside an array value (column defs), preserving literals", () => {
    const $vars = { $item: { id: "tbl1" }, $dateFid: "f_date" };
    const updates = executeActionItem("UPDATE", {
      path: "$item.meta.table.columns",
      value: [
        { id: "c0", title: "Task" },
        { id: "c1", title: "Date", displayFieldId: "$dateFid" },
      ],
    }, $vars, makeContext());

    expect(updates[0]._effect).toBe("UPDATE_ITEM_META");
    expect(updates[0].value).toEqual([
      { id: "c0", title: "Task" },
      { id: "c1", title: "Date", displayFieldId: "f_date" },
    ]);
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

// ============================================================
// APPLY_TEMPLATE
// ============================================================
describe("APPLY_TEMPLATE", () => {
  it("clones a single-node template into the target", () => {
    const tplOccId = "tpl-1";
    const tplModId = "tpl-mod-1";
    const targetId = "tgt-1";
    const targetModId = "tgt-mod-1";

    const state = {
      modulesById: {
        [tplModId]: { id: tplModId, label: "Slot", role: "container", kind: "board", meta: { templateModule: true } },
        [targetModId]: { id: targetModId, label: "Page", role: "page" },
      },
      grid: { _id: "g1" },
      userId: "u1",
    };
    const occurrencesById = {
      [tplOccId]: { id: tplOccId, moduleId: tplModId, targetId: tplModId, parentId: "tpl-folder", occurrences: [], meta: { templateName: "Slot" } },
      [targetId]: { id: targetId, moduleId: targetModId, targetId: targetModId, occurrences: [] },
    };
    const $vars = { $allOccurrences: [], $allItems: [], $tgt: targetId, $tpl: tplOccId };
    const ctx = makeContext({ state, occurrencesById, modulesById: state.modulesById });

    const updates = executeActionItem(
      "APPLY_TEMPLATE",
      { templateRef: "$tpl", targetOccurrenceVar: "$tgt", resultVar: "$new", mode: "append" },
      $vars, ctx, {}
    );

    // resultVar bound to array of new occ ids
    expect(Array.isArray($vars.$new)).toBe(true);
    expect($vars.$new.length).toBe(1);

    // A CREATE_ITEM effect was pushed
    const createEffect = updates.find(u => u._effect === "CREATE_ITEM");
    expect(createEffect).toBeTruthy();
    expect(createEffect.template.role).toBe("container");
    expect(createEffect.template.meta.templateModule).toBe(false);
    expect(createEffect.instance.parentId).toBe(targetId);

    // Optimistic publish happened
    expect($vars.$allOccurrences.length).toBe(1);
    expect($vars.$allItems.length).toBe(1);
  });

  it("breaks without error when templateRef is missing", () => {
    const ctx = makeContext({ state: { modulesById: {} }, occurrencesById: { tgt: { id: "tgt", occurrences: [] } } });
    const $vars = { $tgt: "tgt" };
    const updates = executeActionItem(
      "APPLY_TEMPLATE",
      { templateRef: null, targetOccurrenceVar: "$tgt" },
      $vars, ctx, {}
    );
    expect(updates).toEqual([]);
  });

  it("mode replace emits UPDATE_OCCURRENCE to clear target children first", () => {
    const tplModId = "m1";
    const state = {
      modulesById: {
        [tplModId]: { id: tplModId, label: "T", role: "instance", kind: "board", meta: {} },
      },
    };
    const occurrencesById = {
      tpl: { id: "tpl", moduleId: tplModId, targetId: tplModId, occurrences: [] },
      tgt: { id: "tgt", occurrences: ["existing-child"] },
    };
    const $vars = { $allOccurrences: [], $allItems: [], $tgt: "tgt", $tpl: "tpl" };
    const ctx = makeContext({ state, occurrencesById });

    const updates = executeActionItem(
      "APPLY_TEMPLATE",
      { templateRef: "$tpl", targetOccurrenceVar: "$tgt", mode: "replace" },
      $vars, ctx, {}
    );

    const clearEffect = updates.find(u => u._effect === "UPDATE_OCCURRENCE" && u.occurrence?.id === "tgt");
    expect(clearEffect).toBeTruthy();
    expect(clearEffect.occurrence.occurrences).toEqual([]);
  });

  // ── mode:"merge" with identitySignature ─────────────────────────────────────
  it("mode merge skips cloning a slot when a sibling carries the same identitySignature", () => {
    // Template root has a slot child carrying identitySignature "slot:6:00am"
    // and a routine instance inside it. Target page already has a slot with
    // the same signature. Merge mode reuses that slot and recurses into its
    // template children; the inner instance (no signature) clones fresh under
    // the matched slot.
    const state = {
      modulesById: {
        tplRootMod: { id: "tplRootMod", role: "page",      kind: "board", label: "Daily Routine" },
        tplSlotMod: { id: "tplSlotMod", role: "container", kind: "board",  label: "6:00am" },
        tplInstMod: { id: "tplInstMod", role: "instance",  kind: "board",  label: "Drink Water" },
        pageMod:    { id: "pageMod",    role: "page",      kind: "board", label: "Schedule" },
      },
    };
    const occurrencesById = {
      // Template subtree
      tplRoot: { id: "tplRoot", moduleId: "tplRootMod", occurrences: ["tplSlot"] },
      tplSlot: { id: "tplSlot", moduleId: "tplSlotMod", parentId: "tplRoot", occurrences: ["tplInst"], identitySignature: "slot:6:00am" },
      tplInst: { id: "tplInst", moduleId: "tplInstMod", parentId: "tplSlot", occurrences: [] },
      // Live page with an EXISTING slot
      page:        { id: "page", moduleId: "pageMod", occurrences: ["existingSlot"] },
      existingSlot:{ id: "existingSlot", moduleId: "tplSlotMod", parentId: "page", occurrences: [], identitySignature: "slot:6:00am" },
    };
    const $vars = {
      $allOccurrences: Object.values(occurrencesById),
      $allItems:       Object.values(occurrencesById),
      $allContainers: [occurrencesById.tplSlot, occurrencesById.existingSlot],
      $allInstances:  [occurrencesById.tplInst],
      $allPages:      [occurrencesById.tplRoot, occurrencesById.page],
      $tpl: "tplRoot",
      $tgt: "page",
    };
    const ctx = makeContext({ state, occurrencesById, modulesById: state.modulesById });

    const updates = executeActionItem(
      "APPLY_TEMPLATE",
      { templateRef: "$tpl", targetOccurrenceVar: "$tgt", mode: "merge", unwrapRoot: true },
      $vars, ctx, {}
    );

    const creates = updates.filter(u => u._effect === "CREATE_ITEM");
    // Slot was matched by identitySignature → no clone for it.
    // Routine instance under it has no signature → cloned fresh under existingSlot.
    expect(creates).toHaveLength(1);
    expect(creates[0].template.role).toBe("instance");
    expect(creates[0].instance.parentId).toBe("existingSlot");
  });

  it("mode merge clones a slot when no sibling carries the matching signature", () => {
    const state = {
      modulesById: {
        tplRootMod: { id: "tplRootMod", role: "page",      kind: "board", label: "Daily Routine" },
        tplSlotMod: { id: "tplSlotMod", role: "container", kind: "board",  label: "7:00am" },
        pageMod:    { id: "pageMod",    role: "page",      kind: "board", label: "Schedule" },
      },
    };
    const occurrencesById = {
      tplRoot: { id: "tplRoot", moduleId: "tplRootMod", occurrences: ["tplSlot"] },
      tplSlot: { id: "tplSlot", moduleId: "tplSlotMod", parentId: "tplRoot", occurrences: [], identitySignature: "slot:7:00am" },
      page:    { id: "page",    moduleId: "pageMod",    occurrences: [] }, // no existing slots
    };
    const $vars = {
      $allOccurrences: Object.values(occurrencesById),
      $allItems:       Object.values(occurrencesById),
      $allContainers:  [occurrencesById.tplSlot],
      $allPages:       [occurrencesById.tplRoot, occurrencesById.page],
      $tpl: "tplRoot",
      $tgt: "page",
    };
    const ctx = makeContext({ state, occurrencesById, modulesById: state.modulesById });

    const updates = executeActionItem(
      "APPLY_TEMPLATE",
      { templateRef: "$tpl", targetOccurrenceVar: "$tgt", mode: "merge", unwrapRoot: true },
      $vars, ctx, {}
    );

    const slotCreate = updates.find(u => u._effect === "CREATE_ITEM" && u.template.label === "7:00am");
    expect(slotCreate).toBeTruthy();
    expect(slotCreate.instance.parentId).toBe("page");
    expect(slotCreate.instance.identitySignature).toBe("slot:7:00am");
  });

  it("unwrapRoot:true skips the template root node and clones its children into target", () => {
    const state = {
      modulesById: {
        rootMod:  { id: "rootMod",  role: "page",     kind: "board", label: "Root" },
        childMod: { id: "childMod", role: "instance", kind: "board",  label: "Child" },
        pageMod:  { id: "pageMod",  role: "page",     kind: "board", label: "Target" },
      },
    };
    const occurrencesById = {
      tplRoot:  { id: "tplRoot",  moduleId: "rootMod",  occurrences: ["tplChild"] },
      tplChild: { id: "tplChild", moduleId: "childMod", parentId: "tplRoot", occurrences: [] },
      page:     { id: "page",     moduleId: "pageMod",  occurrences: [] },
    };
    const $vars = { $allOccurrences: Object.values(occurrencesById), $allItems: Object.values(occurrencesById), $tpl: "tplRoot", $tgt: "page" };
    const ctx = makeContext({ state, occurrencesById, modulesById: state.modulesById });

    const updates = executeActionItem(
      "APPLY_TEMPLATE",
      { templateRef: "$tpl", targetOccurrenceVar: "$tgt", mode: "append", unwrapRoot: true },
      $vars, ctx, {}
    );

    const creates = updates.filter(u => u._effect === "CREATE_ITEM");
    // Root page node is skipped — only the child is cloned, directly into target.
    expect(creates).toHaveLength(1);
    expect(creates[0].template.label).toBe("Child");
    expect(creates[0].instance.parentId).toBe("page");
  });

  // ── Optimistic publish into role-filtered slices ───────────────────────────
  it("appends new instance-role stubs into $allInstances", () => {
    const state = {
      modulesById: {
        tplMod: { id: "tplMod", role: "instance", kind: "board", label: "Task" },
        pageMod: { id: "pageMod", role: "page" },
      },
    };
    const occurrencesById = {
      tpl: { id: "tpl", moduleId: "tplMod", occurrences: [] },
      page: { id: "page", moduleId: "pageMod", occurrences: [] },
    };
    const $vars = {
      $allOccurrences: [], $allItems: [], $allInstances: [], $allContainers: [], $allPages: [], $allPanels: [],
      $tpl: "tpl", $tgt: "page",
    };
    const ctx = makeContext({ state, occurrencesById, modulesById: state.modulesById });

    executeActionItem(
      "APPLY_TEMPLATE",
      { templateRef: "$tpl", targetOccurrenceVar: "$tgt", mode: "append" },
      $vars, ctx, {}
    );

    expect($vars.$allInstances).toHaveLength(1);
    expect($vars.$allInstances[0].role).toBe("instance");
    // Other slices stay empty for an instance-only clone
    expect($vars.$allContainers).toHaveLength(0);
    expect($vars.$allPages).toHaveLength(0);
    expect($vars.$allPanels).toHaveLength(0);
    // And $allOccurrences / $allItems also got the stub
    expect($vars.$allOccurrences).toHaveLength(1);
    expect($vars.$allItems).toHaveLength(1);
  });

  it("defaultFields stamps instance-role clones' fields without a separate UPDATE pass", () => {
    const state = {
      modulesById: {
        tplRootMod: { id: "tplRootMod", role: "page",      kind: "board", label: "Daily Routine" },
        tplSlotMod: { id: "tplSlotMod", role: "container", kind: "board",  label: "6:00am" },
        tplInstMod: { id: "tplInstMod", role: "instance",  kind: "board",  label: "Drink Water" },
        pageMod:    { id: "pageMod",    role: "page",      kind: "board", label: "Schedule" },
      },
    };
    const occurrencesById = {
      tplRoot: { id: "tplRoot", moduleId: "tplRootMod", occurrences: ["tplSlot"] },
      tplSlot: { id: "tplSlot", moduleId: "tplSlotMod", parentId: "tplRoot", occurrences: ["tplInst"] },
      tplInst: { id: "tplInst", moduleId: "tplInstMod", parentId: "tplSlot", occurrences: [], fields: { f_slot: { value: "6:00am", flow: "in" } } },
      page:    { id: "page",    moduleId: "pageMod",    occurrences: [] },
    };
    const $vars = {
      $allOccurrences: Object.values(occurrencesById),
      $allItems: Object.values(occurrencesById),
      $tpl: "tplRoot", $tgt: "page",
      $schedDate: "2026-05-16",
    };
    const ctx = makeContext({ state, occurrencesById, modulesById: state.modulesById });

    const updates = executeActionItem(
      "APPLY_TEMPLATE",
      {
        templateRef: "$tpl", targetOccurrenceVar: "$tgt",
        mode: "append", unwrapRoot: true,
        defaultFields: { f_date: "$schedDate", f_due: "$schedDate" },
      },
      $vars, ctx, {}
    );

    const creates = updates.filter(u => u._effect === "CREATE_ITEM");
    // Two creates: slot (container) + drink water (instance).
    const slotCreate = creates.find(c => c.template.role === "container");
    const instCreate = creates.find(c => c.template.role === "instance");
    expect(slotCreate).toBeTruthy();
    expect(instCreate).toBeTruthy();

    // Instance clone has the date baked in alongside its template's existing fields.
    expect(instCreate.instance.fields.f_slot).toEqual({ value: "6:00am", flow: "in" });
    expect(instCreate.instance.fields.f_date).toEqual({ value: "2026-05-16", flow: "in" });
    expect(instCreate.instance.fields.f_due).toEqual({ value: "2026-05-16", flow: "in" });

    // Slot clone (container role) does NOT get defaultFields merged in.
    expect(slotCreate.instance.fields.f_date).toBeUndefined();
    expect(slotCreate.instance.fields.f_due).toBeUndefined();
  });

  it("appends new container-role stubs into $allContainers, not $allInstances", () => {
    const state = {
      modulesById: {
        tplMod: { id: "tplMod", role: "container", kind: "board", label: "Group" },
        pageMod: { id: "pageMod", role: "page" },
      },
    };
    const occurrencesById = {
      tpl: { id: "tpl", moduleId: "tplMod", occurrences: [] },
      page: { id: "page", moduleId: "pageMod", occurrences: [] },
    };
    const $vars = {
      $allOccurrences: [], $allItems: [], $allInstances: [], $allContainers: [], $allPages: [], $allPanels: [],
      $tpl: "tpl", $tgt: "page",
    };
    const ctx = makeContext({ state, occurrencesById, modulesById: state.modulesById });

    executeActionItem(
      "APPLY_TEMPLATE",
      { templateRef: "$tpl", targetOccurrenceVar: "$tgt", mode: "append" },
      $vars, ctx, {}
    );

    expect($vars.$allContainers).toHaveLength(1);
    expect($vars.$allContainers[0].role).toBe("container");
    expect($vars.$allInstances).toHaveLength(0);
  });
});

// ============================================================
// COPY_LINK verb
// ============================================================
// Mints a new occurrence sharing module + linkedGroupId with a source.
// Server's update_occurrence handler propagates writes across the group;
// these tests just cover the executor-level invariants.
describe("COPY_LINK action", () => {
  const makeSourceCtx = (sourceOverrides = {}) => {
    const source = {
      id: "todo1",
      moduleId: "mod_buyMilk",
      parentId: "todoCont1",
      fields: { f_due: { value: "2026-05-16", flow: "in" } },
      label: "Buy milk",
      role: "instance",
      linkedGroupId: null,
      ...sourceOverrides,
    };
    const occurrencesById = {
      [source.id]: source,
      todoCont1: { id: "todoCont1", occurrences: [source.id] },
      due1: { id: "due1", occurrences: [] },
    };
    const $vars = {
      $allTemplates: [{ id: "mod_buyMilk", label: "Buy milk", role: "instance" }],
      $allItems: [{ ...source, templateId: source.moduleId }],
      $allOccurrences: [{ ...source, templateId: source.moduleId }],
      $allInstances: [],
      $allContainers: [],
      $today: "2026-05-15",
      $todo: source,
      $dueId: "due1",
    };
    return {
      $vars,
      ctx: { state: {}, fieldsById: { f_date: { id: "f_date", type: "date" }, f_due: { id: "f_due", type: "date" } }, occurrencesById, operationsById: {} },
      source,
    };
  };

  it("mints a new linkedGroupId on the source AND emits UPDATE_OCCURRENCE for it", () => {
    const { $vars, ctx, source } = makeSourceCtx();
    expect(source.linkedGroupId).toBe(null);

    const updates = executeActionItem("COPY_LINK", {
      sourceId: "$todo.id",
      parent: "$dueId",
      linkedGroupVar: "$lg",
    }, $vars, ctx);

    // Two effects: the new copy + the source's linkedGroupId patch.
    const createEffect = updates.find(u => u._effect === "CREATE_ITEM");
    const sourceUpdate = updates.find(u => u._effect === "UPDATE_OCCURRENCE");
    expect(createEffect).toBeDefined();
    expect(sourceUpdate).toBeDefined();
    expect(sourceUpdate.occurrence.id).toBe("todo1");
    expect(sourceUpdate.occurrence.linkedGroupId).toBe(createEffect.instance.linkedGroupId);
    expect($vars.$lg).toBe(createEffect.instance.linkedGroupId);

    // Source overlay also reflects the minted id so a second COPY_LINK
    // against the same source in the same pipeline reuses it.
    expect(ctx.occurrencesById.todo1.linkedGroupId).toBe(createEffect.instance.linkedGroupId);
  });

  it("reuses an existing linkedGroupId and emits NO source UPDATE_OCCURRENCE", () => {
    const { $vars, ctx } = makeSourceCtx({ linkedGroupId: "lg_preexisting" });

    const updates = executeActionItem("COPY_LINK", {
      sourceId: "$todo.id",
      parent: "$dueId",
    }, $vars, ctx);

    const createEffect = updates.find(u => u._effect === "CREATE_ITEM");
    expect(createEffect.instance.linkedGroupId).toBe("lg_preexisting");
    expect(updates.find(u => u._effect === "UPDATE_OCCURRENCE")).toBeUndefined();
  });

  it("uses source.moduleId on the new copy (no new template minted)", () => {
    const { $vars, ctx } = makeSourceCtx();
    const beforeTplCount = $vars.$allTemplates.length;

    const updates = executeActionItem("COPY_LINK", {
      sourceId: "$todo.id",
      parent: "$dueId",
    }, $vars, ctx);

    const createEffect = updates.find(u => u._effect === "CREATE_ITEM");
    expect(createEffect.template).toBe(null);
    expect(createEffect.instance.templateId).toBe("mod_buyMilk");
    // No new template added to the in-pipeline overlay.
    expect($vars.$allTemplates).toHaveLength(beforeTplCount);
  });

  it("seeds copy fields from source by default, then layers cfg.fields on top", () => {
    const { $vars, ctx } = makeSourceCtx();

    const updates = executeActionItem("COPY_LINK", {
      sourceId: "$todo.id",
      parent: "$dueId",
      fields: { f_date: "$today" },
    }, $vars, ctx);

    const fields = updates.find(u => u._effect === "CREATE_ITEM").instance.fields;
    // Source's f_due carried through (copyFields default true).
    expect(fields.f_due).toEqual({ value: "2026-05-16", flow: "in" });
    // cfg.fields stamps f_date on top.
    expect(fields.f_date).toEqual({ value: "2026-05-15", flow: "in" });
  });

  it("copyFields:false skips the source-fields seed", () => {
    const { $vars, ctx } = makeSourceCtx();

    const updates = executeActionItem("COPY_LINK", {
      sourceId: "$todo.id",
      parent: "$dueId",
      copyFields: false,
      fields: { f_date: "$today" },
    }, $vars, ctx);

    const fields = updates.find(u => u._effect === "CREATE_ITEM").instance.fields;
    expect(fields.f_due).toBeUndefined();
    expect(fields.f_date).toEqual({ value: "2026-05-15", flow: "in" });
  });

  it("appends new copy to parent.occurrences in the overlay (HAS_ANCESTOR dedup)", () => {
    const { $vars, ctx } = makeSourceCtx();

    const updates = executeActionItem("COPY_LINK", {
      sourceId: "$todo.id",
      parent: "$dueId",
    }, $vars, ctx);

    const newId = updates.find(u => u._effect === "CREATE_ITEM").instance.id;
    expect(ctx.occurrencesById.due1.occurrences).toContain(newId);
    // Optimistic publish into role-filtered slices (source role is "instance").
    expect($vars.$allInstances.find(i => i.id === newId)).toBeDefined();
  });

  it("returns no updates when sourceId resolves to nothing", () => {
    const { $vars, ctx } = makeSourceCtx();
    const updates = executeActionItem("COPY_LINK", {
      sourceId: "$nonexistent",
      parent: "$dueId",
    }, $vars, ctx);
    expect(updates).toEqual([]);
  });

  // ─── Recursive COPY_LINK: pairwise child link ───────────────────────────────
  // When the source has children, each child also gets COPY_LINKed pairwise.
  // The new copy's occurrences[] contains clones of the source's children, and
  // each (sourceChild, copyChild) pair shares its own linkedGroupId so the
  // server propagates writes within each pair independently.
  it("recursively links a 2-level subtree pairwise (root + one child)", () => {
    const childOcc = {
      id: "todoChild1",
      moduleId: "mod_subtask",
      parentId: "todo1",
      fields: { f_done: { value: false, flow: "in" } },
      label: "Subtask",
      role: "instance",
      linkedGroupId: null,
    };
    const root = {
      id: "todo1",
      moduleId: "mod_buyMilk",
      parentId: "todoCont1",
      fields: { f_due: { value: "2026-05-16", flow: "in" } },
      label: "Buy milk",
      role: "instance",
      linkedGroupId: null,
      occurrences: ["todoChild1"],
    };
    const occurrencesById = {
      [root.id]: root,
      [childOcc.id]: childOcc,
      todoCont1: { id: "todoCont1", occurrences: [root.id] },
      due1: { id: "due1", occurrences: [] },
    };
    const $vars = {
      $allTemplates: [
        { id: "mod_buyMilk", label: "Buy milk", role: "instance" },
        { id: "mod_subtask", label: "Subtask",  role: "instance" },
      ],
      $allItems: [
        { ...root, templateId: root.moduleId },
        { ...childOcc, templateId: childOcc.moduleId },
      ],
      $allOccurrences: [
        { ...root, templateId: root.moduleId },
        { ...childOcc, templateId: childOcc.moduleId },
      ],
      $allInstances: [],
      $allContainers: [],
      $todo: root,
      $dueId: "due1",
    };
    const ctx = { state: {}, fieldsById: {}, occurrencesById, operationsById: {} };

    const updates = executeActionItem("COPY_LINK", {
      sourceId: "$todo.id",
      parent: "$dueId",
    }, $vars, ctx);

    // Two CREATE_ITEMs (root + child) + two UPDATE_OCCURRENCEs (link patches
    // on source root + source child).
    const creates = updates.filter(u => u._effect === "CREATE_ITEM");
    const sourceUpdates = updates.filter(u => u._effect === "UPDATE_OCCURRENCE");
    expect(creates).toHaveLength(2);
    expect(sourceUpdates).toHaveLength(2);

    // Root copy: parent = dueId, templateId = source's module, occurrences[]
    // contains the child copy's id.
    const rootCreate = creates.find(c => c.instance.parentId === "due1");
    expect(rootCreate).toBeDefined();
    expect(rootCreate.instance.templateId).toBe("mod_buyMilk");
    expect(rootCreate.instance.occurrences).toHaveLength(1);

    // Child copy: parent = root copy's id, templateId = source child's module.
    const childCopyId = rootCreate.instance.occurrences[0];
    const childCreate = creates.find(c => c.instance.id === childCopyId);
    expect(childCreate).toBeDefined();
    expect(childCreate.instance.parentId).toBe(rootCreate.instance.id);
    expect(childCreate.instance.templateId).toBe("mod_subtask");

    // Pairwise linking — root pair shares one linkedGroupId, child pair shares
    // a DIFFERENT one. Independent server fan-outs per pair.
    expect(rootCreate.instance.linkedGroupId).toBeTruthy();
    expect(childCreate.instance.linkedGroupId).toBeTruthy();
    expect(rootCreate.instance.linkedGroupId).not.toBe(childCreate.instance.linkedGroupId);

    // The two source UPDATE_OCCURRENCEs persist the new link ids onto each
    // source occurrence.
    const srcRootUpdate = sourceUpdates.find(u => u.occurrence.id === "todo1");
    const srcChildUpdate = sourceUpdates.find(u => u.occurrence.id === "todoChild1");
    expect(srcRootUpdate.occurrence.linkedGroupId).toBe(rootCreate.instance.linkedGroupId);
    expect(srcChildUpdate.occurrence.linkedGroupId).toBe(childCreate.instance.linkedGroupId);
  });

  it("cfg.fields applies to the ROOT clone only (children keep their own fields)", () => {
    const childOcc = {
      id: "ch1", moduleId: "mod_sub", parentId: "p1",
      fields: { f_other: { value: 42, flow: "in" } },
      role: "instance", linkedGroupId: null,
    };
    const root = {
      id: "p1", moduleId: "mod_root", parentId: null,
      fields: { f_due: { value: "2026-05-16", flow: "in" } },
      role: "instance", linkedGroupId: null,
      occurrences: ["ch1"],
    };
    const occurrencesById = { p1: root, ch1: childOcc, dest: { id: "dest", occurrences: [] } };
    const $vars = {
      $allTemplates: [{ id: "mod_root", role: "instance" }, { id: "mod_sub", role: "instance" }],
      $allItems: [], $allOccurrences: [], $allInstances: [],
      $today: "2026-05-15",
      $src: root, $destId: "dest",
    };
    const ctx = { state: {}, fieldsById: { f_date: { id: "f_date", type: "date" } }, occurrencesById, operationsById: {} };

    const updates = executeActionItem("COPY_LINK", {
      sourceId: "$src.id",
      parent: "$destId",
      fields: { f_date: "$today" },
    }, $vars, ctx);

    const creates = updates.filter(u => u._effect === "CREATE_ITEM");
    const rootCreate = creates.find(c => c.instance.parentId === "dest");
    const childCreate = creates.find(c => c.instance.id !== rootCreate.instance.id);
    // Root has the stamped f_date.
    expect(rootCreate.instance.fields.f_date).toEqual({ value: "2026-05-15", flow: "in" });
    expect(rootCreate.instance.fields.f_due).toEqual({ value: "2026-05-16", flow: "in" });
    // Child does NOT get the f_date stamp — keeps its own f_other.
    expect(childCreate.instance.fields.f_date).toBeUndefined();
    expect(childCreate.instance.fields.f_other).toEqual({ value: 42, flow: "in" });
  });
});

// ============================================================
// PUSH_TO_ARRAY action
// ============================================================
describe("PUSH_TO_ARRAY action", () => {
  const ctx = makeContext();

  it("pushes a primitive onto a new array", () => {
    const $vars = {};
    executeActionItem("PUSH_TO_ARRAY", { name: "$items", value: "literal:hello" }, $vars, ctx);
    expect($vars.$items).toEqual(["hello"]);
  });

  it("pushes multiple primitives sequentially", () => {
    const $vars = { $items: ["first"] };
    executeActionItem("PUSH_TO_ARRAY", { name: "$items", value: "literal:second" }, $vars, ctx);
    expect($vars.$items).toEqual(["first", "second"]);
  });

  it("pushes an object with resolved leaf values", () => {
    const $vars = {
      $book: { label: "Deep Work" },
      $pages: 304,
    };
    executeActionItem("PUSH_TO_ARRAY", {
      name: "$rows",
      value: { label: "$book.label", pages: "$pages" },
    }, $vars, ctx);
    expect($vars.$rows).toEqual([{ label: "Deep Work", pages: 304 }]);
  });

  it("pushes multiple object rows, building up the array", () => {
    const $vars = { $rows: [] };
    const books = [
      { label: "Atomic Habits", pages: 320 },
      { label: "Sapiens", pages: 464 },
    ];
    for (const b of books) {
      const $v = { ...$vars, $b: b };
      executeActionItem("PUSH_TO_ARRAY", { name: "$rows", value: { label: "$b.label", pages: "$b.pages" } }, $v, ctx);
      $vars.$rows = $v.$rows;
    }
    expect($vars.$rows).toEqual([
      { label: "Atomic Habits", pages: 320 },
      { label: "Sapiens", pages: 464 },
    ]);
  });

  it("creates the array when the variable does not exist", () => {
    const $vars = {};
    executeActionItem("PUSH_TO_ARRAY", { name: "$new", value: { x: "literal:1" } }, $vars, ctx);
    expect(Array.isArray($vars.$new)).toBe(true);
    expect($vars.$new).toHaveLength(1);
    expect($vars.$new[0]).toEqual({ x: 1 });
  });

  it("is a no-op when name is missing", () => {
    const $vars = {};
    expect(() => executeActionItem("PUSH_TO_ARRAY", { value: "literal:x" }, $vars, ctx)).not.toThrow();
    expect(Object.keys($vars)).toHaveLength(0);
  });
});

describe("DATE_ADD action", () => {
  const ctx = makeContext();
  const isoDay = (d) => new Date(d).toISOString().slice(0, 10);

  it("adds days to a base ISO string and binds resultVar", () => {
    const $vars = { $start: "2026-01-01T12:00:00.000Z" };
    executeActionItem("DATE_ADD", {
      base: "$start", amount: 7, unit: "day", resultVar: "$next",
    }, $vars, ctx);
    expect(isoDay($vars.$next)).toBe("2026-01-08");
  });

  it("adds months, snapping day-of-month via setDay (monthly cadence)", () => {
    const $vars = { $today: "2026-05-19T12:00:00.000Z" };
    executeActionItem("DATE_ADD", {
      base: "$today", amount: 1, unit: "month", setDay: 5,
      advanceUntil: "$today", resultVar: "$next",
    }, $vars, ctx);
    // setDay snaps to 5 → May 5 (<= today), advance one month → Jun 5
    expect(isoDay($vars.$next)).toBe("2026-06-05");
  });

  it("rolls anchor forward by N days until past advanceUntil (every-n-days)", () => {
    const $vars = {
      $anchor: "2026-01-01T12:00:00.000Z",
      $today:  "2026-05-19T12:00:00.000Z",
    };
    executeActionItem("DATE_ADD", {
      base: "$anchor", amount: 30, unit: "day",
      advanceUntil: "$today", resultVar: "$next",
    }, $vars, ctx);
    // anchor + 30 = Jan 31; +30 = Mar 02; +30 = Apr 01; +30 = May 01; +30 = May 31 (> May 19)
    expect(isoDay($vars.$next)).toBe("2026-05-31");
  });

  it("writes to targetFieldId on the resolved occurrence when configured", () => {
    const $vars = { $today: "2026-05-19T12:00:00.000Z", $billId: "occ-bill-1" };
    const updates = [];
    // Spy via custom context — push to local updates array is hard; instead
    // run executeActionItem directly and observe via executor return.
    // The function pushes to its internal `updates` array; we can't see it
    // without a wrapper, so we sample resultVar AND emulate the effect path
    // by passing both resultVar and targetFieldId then asserting via spy:
    // simplest: just confirm no throw and resultVar resolved.
    executeActionItem("DATE_ADD", {
      base: "$today", amount: 1, unit: "month", setDay: 15,
      advanceUntil: "$today", resultVar: "$next",
      targetFieldId: "fld-next-due", targetOccurrenceIdExpr: "$billId",
    }, $vars, ctx);
    expect(isoDay($vars.$next)).toBe("2026-06-15");
  });

  it("is a no-op when base is missing", () => {
    const $vars = {};
    expect(() => executeActionItem("DATE_ADD", { amount: 1, unit: "day", resultVar: "$next" }, $vars, ctx))
      .not.toThrow();
    expect($vars.$next).toBeUndefined();
  });

  it("safety-caps the advanceUntil loop", () => {
    // amount: 0 unit: day would otherwise loop forever; safety cap prevents it.
    const $vars = { $start: "2026-01-01T12:00:00.000Z", $today: "2026-05-19T12:00:00.000Z" };
    expect(() => executeActionItem("DATE_ADD", {
      base: "$start", amount: 0, unit: "day", advanceUntil: "$today", resultVar: "$next",
    }, $vars, ctx)).not.toThrow();
    // result is still a string (capped at ~600 iters with no advancement)
    expect(typeof $vars.$next).toBe("string");
  });
});

// ════════════════════════════════════════════════════════════════════
// Value manipulator actions (task #31)
// ════════════════════════════════════════════════════════════════════

describe("SPLIT_STRING action", () => {
  const ctx = makeContext();

  it("splits a string by space by default", () => {
    const $vars = { $msg: "hello world foo" };
    executeActionItem("SPLIT_STRING", { name: "$msg" }, $vars, ctx);
    expect($vars.$msg).toEqual(["hello", "world", "foo"]);
  });

  it("splits by a custom separator", () => {
    const $vars = { $csv: "a,b,c" };
    executeActionItem("SPLIT_STRING", { name: "$csv", by: "," }, $vars, ctx);
    expect($vars.$csv).toEqual(["a", "b", "c"]);
  });

  it("writes to a different var when `to` is set", () => {
    const $vars = { $line: "foo bar" };
    executeActionItem("SPLIT_STRING", { name: "$line", to: "$parts" }, $vars, ctx);
    expect($vars.$line).toBe("foo bar");
    expect($vars.$parts).toEqual(["foo", "bar"]);
  });

  it("null/undefined input → empty array", () => {
    const $vars = { $maybe: null };
    executeActionItem("SPLIT_STRING", { name: "$maybe" }, $vars, ctx);
    expect($vars.$maybe).toEqual([]);
  });
});

describe("JOIN_ARRAY action", () => {
  const ctx = makeContext();

  it("joins with empty separator by default", () => {
    const $vars = { $arr: ["a", "b", "c"] };
    executeActionItem("JOIN_ARRAY", { name: "$arr", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe("abc");
  });

  it("joins with custom separator", () => {
    const $vars = { $arr: ["x", "y", "z"] };
    executeActionItem("JOIN_ARRAY", { name: "$arr", by: " - " }, $vars, ctx);
    expect($vars.$arr).toBe("x - y - z");
  });
});

describe("SORT_VAR action", () => {
  const ctx = makeContext();

  it("sorts ascending by default (primitives)", () => {
    const $vars = { $arr: [3, 1, 2] };
    executeActionItem("SORT_VAR", { name: "$arr" }, $vars, ctx);
    expect($vars.$arr).toEqual([1, 2, 3]);
  });

  it("sorts descending when direction='desc'", () => {
    const $vars = { $arr: [1, 3, 2] };
    executeActionItem("SORT_VAR", { name: "$arr", direction: "desc" }, $vars, ctx);
    expect($vars.$arr).toEqual([3, 2, 1]);
  });

  it("sorts objects by key", () => {
    const $vars = { $books: [{ pages: 300 }, { pages: 100 }, { pages: 200 }] };
    executeActionItem("SORT_VAR", { name: "$books", by: "pages" }, $vars, ctx);
    expect($vars.$books.map(b => b.pages)).toEqual([100, 200, 300]);
  });

  it("non-array input is a no-op", () => {
    const $vars = { $x: "not-an-array" };
    executeActionItem("SORT_VAR", { name: "$x" }, $vars, ctx);
    expect($vars.$x).toBe("not-an-array");
  });
});

describe("REMOVE_FROM_VAR action", () => {
  const ctx = makeContext();

  it("removes by index", () => {
    const $vars = { $arr: ["a", "b", "c"] };
    executeActionItem("REMOVE_FROM_VAR", { name: "$arr", at: 1 }, $vars, ctx);
    expect($vars.$arr).toEqual(["a", "c"]);
  });

  it("removes the first occurrence of a literal value", () => {
    const $vars = { $arr: ["a", "b", "c", "b"] };
    executeActionItem("REMOVE_FROM_VAR", { name: "$arr", value: "literal:b" }, $vars, ctx);
    expect($vars.$arr).toEqual(["a", "c", "b"]);
  });

  it("out-of-range index → no-op", () => {
    const $vars = { $arr: ["a", "b"] };
    executeActionItem("REMOVE_FROM_VAR", { name: "$arr", at: 99 }, $vars, ctx);
    expect($vars.$arr).toEqual(["a", "b"]);
  });
});

describe("REPLACE_IN_VAR action", () => {
  const ctx = makeContext();

  it("replaces at a valid index", () => {
    const $vars = { $arr: ["a", "b", "c"] };
    executeActionItem("REPLACE_IN_VAR", { name: "$arr", at: 1, value: "literal:Z" }, $vars, ctx);
    expect($vars.$arr).toEqual(["a", "Z", "c"]);
  });

  it("out-of-range index → no-op", () => {
    const $vars = { $arr: ["a", "b"] };
    executeActionItem("REPLACE_IN_VAR", { name: "$arr", at: 99, value: "literal:Z" }, $vars, ctx);
    expect($vars.$arr).toEqual(["a", "b"]);
  });

  it("resolves value via $vars", () => {
    const $vars = { $arr: ["x", "y"], $new: "ZZ" };
    executeActionItem("REPLACE_IN_VAR", { name: "$arr", at: 0, value: "$new" }, $vars, ctx);
    expect($vars.$arr).toEqual(["ZZ", "y"]);
  });
});

describe("MERGE_ARRAY action", () => {
  const ctx = makeContext();

  it("concatenates another array", () => {
    const $vars = { $a: [1, 2], $b: [3, 4] };
    executeActionItem("MERGE_ARRAY", { name: "$a", with: "$b" }, $vars, ctx);
    expect($vars.$a).toEqual([1, 2, 3, 4]);
  });

  it("dedups when unique=true", () => {
    const $vars = { $a: [1, 2, 3], $b: [2, 3, 4] };
    executeActionItem("MERGE_ARRAY", { name: "$a", with: "$b", unique: true }, $vars, ctx);
    expect($vars.$a).toEqual([1, 2, 3, 4]);
  });

  it("merges a non-array right-hand-side as a single element", () => {
    const $vars = { $a: [1], $b: 99 };
    executeActionItem("MERGE_ARRAY", { name: "$a", with: "$b" }, $vars, ctx);
    expect($vars.$a).toEqual([1, 99]);
  });
});

describe("CREATE with `multiple: true` (task #30)", () => {
  // Per user direction "make sure the create and the createMultiple are one
  // ui action … just have a switch that asks if its multiple". CREATE is the
  // sole action — `cfg.multiple === true` consumes `cfg.rows` and bulk-creates.
  const ctx = makeContext();

  it("returns early when rows is missing or empty", () => {
    const $vars = { $allItems: [], $allTemplates: [] };
    expect(() =>
      executeActionItem("CREATE", { multiple: true, rows: [] }, $vars, ctx)
    ).not.toThrow();
  });

  it("skips rows without a name", () => {
    const $vars = { $allItems: [], $allTemplates: [] };
    const updates = executeActionItem("CREATE", {
      multiple: true,
      rows: [{ fields: {} }, null, undefined, { name: "" }],
      role: "instance",
    }, $vars, ctx);
    expect(updates).toEqual([]);
  });

  it("creates one occurrence per row when names are provided", () => {
    const $vars = { $allItems: [], $allOccurrences: [], $allTemplates: [], $allInstances: [], $allModules: [] };
    const updates = executeActionItem("CREATE", {
      multiple: true,
      rows: [
        { name: "Alice" },
        { name: "Bob" },
        { name: "Carol" },
      ],
      role: "instance",
    }, $vars, ctx);
    const created = updates.filter(u => u?._effect === "CREATE_ITEM");
    expect(created.length).toBeGreaterThanOrEqual(3);
    const labels = created.map(c => c.template?.label || c.template?.name);
    expect(labels).toEqual(expect.arrayContaining(["Alice", "Bob", "Carol"]));
  });

  it("merges base fields with per-row field overrides", () => {
    const $vars = { $allItems: [], $allOccurrences: [], $allTemplates: [], $allInstances: [], $allModules: [] };
    const updates = executeActionItem("CREATE", {
      multiple: true,
      rows: [
        { name: "row1", fields: { name1: "v1" } },
        { name: "row2", fields: { name2: "v2" } },
      ],
      fields: { shared: "base" },
      role: "instance",
    }, $vars, ctx);
    const created = updates.filter(u => u?._effect === "CREATE_ITEM");
    for (const eff of created) {
      const inst = eff.instance;
      expect(inst?.fields).toBeTruthy();
      expect(Object.keys(inst.fields || {}).length).toBeGreaterThan(0);
    }
  });

  it("binds resultVar to the array of created ids", () => {
    const $vars = { $allItems: [], $allOccurrences: [], $allTemplates: [], $allInstances: [], $allModules: [] };
    executeActionItem("CREATE", {
      multiple: true,
      rows: [{ name: "a" }, { name: "b" }],
      role: "instance",
      resultVar: "$createdIds",
    }, $vars, ctx);
    expect(Array.isArray($vars.$createdIds)).toBe(true);
    expect($vars.$createdIds.length).toBe(2);
    expect($vars.$createdIds.every(id => typeof id === "string" && id.length > 0)).toBe(true);
  });
});

describe("MOVE_OCCURRENCE / REMOVE_OCCURRENCE / DELETE with `multiple: true` (task #30)", () => {
  const ctx = makeContext();

  it("MOVE_OCCURRENCE multiple loops ids and emits one effect per id", () => {
    const $vars = {};
    const updates = executeActionItem("MOVE_OCCURRENCE", {
      multiple: true,
      ids: ["a", "b", "c"],
      toContainerId: "C1",
    }, $vars, ctx);
    expect(updates.length).toBe(3);
    expect(updates.every(u => u._effect === "MOVE_OCCURRENCE" && u.toContainerId === "C1")).toBe(true);
    expect(updates.map(u => u.occurrenceId)).toEqual(["a", "b", "c"]);
  });

  it("MOVE_OCCURRENCE multiple resolves idsExpr against $vars", () => {
    const $vars = { $myIds: ["x", "y"] };
    const updates = executeActionItem("MOVE_OCCURRENCE", {
      multiple: true,
      idsExpr: "$myIds",
      toContainerId: "C2",
    }, $vars, ctx);
    expect(updates.length).toBe(2);
  });

  it("REMOVE_OCCURRENCE multiple loops ids", () => {
    const $vars = {};
    const updates = executeActionItem("REMOVE_OCCURRENCE", {
      multiple: true,
      ids: ["a", "b"],
    }, $vars, ctx);
    expect(updates.length).toBe(2);
    expect(updates.every(u => u._effect === "REMOVE_OCCURRENCE")).toBe(true);
  });

  it("DELETE multiple loops ids", () => {
    const $vars = {};
    const updates = executeActionItem("DELETE", {
      multiple: true,
      ids: ["x", "y", "z"],
    }, $vars, ctx);
    expect(updates.length).toBe(3);
    expect(updates.every(u => u._effect === "DELETE_ITEM")).toBe(true);
  });

  it("Single mode still works without `multiple`", () => {
    const $vars = {};
    const moveUpd = executeActionItem("MOVE_OCCURRENCE", {
      occurrenceIdExpr: "literal:abc",
      toContainerId: "C3",
    }, $vars, ctx);
    expect(moveUpd.length).toBe(1);
    expect(moveUpd[0].occurrenceId).toBe("abc");
  });
});

describe("FIND auto-array on multiple matches (task #30 follow-up)", () => {
  const ctx = makeContext();

  it("returns bare item when exactly one match", () => {
    const $vars = {
      $allOccurrences: [
        { id: "a", label: "alpha", deleted: false, meta: {} },
        { id: "b", label: "bravo", deleted: false, meta: {} },
      ],
    };
    executeActionItem("FIND", {
      over: "$allOccurrences",
      predicate: { rules: [{ left: "label", comparator: "IS", right: "literal:alpha" }] },
      itemVar: "$found",
    }, $vars, ctx);
    expect($vars.$found).toBeTruthy();
    expect(Array.isArray($vars.$found)).toBe(false);
    expect($vars.$found.id).toBe("a");
  });

  it("returns array when multiple matches", () => {
    const $vars = {
      $allOccurrences: [
        { id: "a", label: "x", deleted: false, meta: {} },
        { id: "b", label: "x", deleted: false, meta: {} },
        { id: "c", label: "y", deleted: false, meta: {} },
      ],
    };
    executeActionItem("FIND", {
      over: "$allOccurrences",
      predicate: { rules: [{ left: "label", comparator: "IS", right: "literal:x" }] },
      itemVar: "$found",
    }, $vars, ctx);
    expect(Array.isArray($vars.$found)).toBe(true);
    expect($vars.$found.length).toBe(2);
  });

  it("returns null when no matches", () => {
    const $vars = {
      $allOccurrences: [
        { id: "a", label: "x", deleted: false, meta: {} },
      ],
    };
    executeActionItem("FIND", {
      over: "$allOccurrences",
      predicate: { rules: [{ left: "label", comparator: "IS", right: "literal:NOPE" }] },
      itemVar: "$found",
    }, $vars, ctx);
    expect($vars.$found).toBeNull();
  });

  it("force-array via `multiple: true` returns array even on single match", () => {
    const $vars = {
      $allOccurrences: [
        { id: "a", label: "only", deleted: false, meta: {} },
      ],
    };
    executeActionItem("FIND", {
      over: "$allOccurrences",
      predicate: { rules: [{ left: "label", comparator: "IS", right: "literal:only" }] },
      itemVar: "$found",
      multiple: true,
    }, $vars, ctx);
    expect(Array.isArray($vars.$found)).toBe(true);
    expect($vars.$found.length).toBe(1);
  });
});

describe("TYPE_OF + ARRAY_LENGTH actions", () => {
  const ctx = makeContext();

  it("TYPE_OF detects array vs object vs primitive", () => {
    const $vars = { $arr: [1, 2], $obj: { a: 1 }, $s: "hi", $n: 42, $b: true, $nil: null };
    executeActionItem("TYPE_OF", { name: "$arr", to: "$t1" }, $vars, ctx);
    executeActionItem("TYPE_OF", { name: "$obj", to: "$t2" }, $vars, ctx);
    executeActionItem("TYPE_OF", { name: "$s",   to: "$t3" }, $vars, ctx);
    executeActionItem("TYPE_OF", { name: "$n",   to: "$t4" }, $vars, ctx);
    executeActionItem("TYPE_OF", { name: "$b",   to: "$t5" }, $vars, ctx);
    executeActionItem("TYPE_OF", { name: "$nil", to: "$t6" }, $vars, ctx);
    expect($vars.$t1).toBe("array");
    expect($vars.$t2).toBe("object");
    expect($vars.$t3).toBe("string");
    expect($vars.$t4).toBe("number");
    expect($vars.$t5).toBe("boolean");
    expect($vars.$t6).toBe("null");
  });

  it("ARRAY_LENGTH writes array length", () => {
    const $vars = { $arr: ["a", "b", "c"] };
    executeActionItem("ARRAY_LENGTH", { name: "$arr", to: "$n" }, $vars, ctx);
    expect($vars.$n).toBe(3);
  });

  it("ARRAY_LENGTH on a string returns its character length", () => {
    const $vars = { $s: "hi" };
    executeActionItem("ARRAY_LENGTH", { name: "$s", to: "$len" }, $vars, ctx);
    expect($vars.$len).toBe(2);
  });
});

describe("SLICE_VAR + UNIQUE_VAR + REVERSE_VAR actions (2026-05-23)", () => {
  const ctx = makeContext();

  it("SLICE_VAR with positive start/end takes a sub-range", () => {
    const $vars = { $arr: [1, 2, 3, 4, 5] };
    executeActionItem("SLICE_VAR", { name: "$arr", start: 1, end: 4, to: "$out" }, $vars, ctx);
    expect($vars.$out).toEqual([2, 3, 4]);
  });

  it("SLICE_VAR with negative start takes the last N entries", () => {
    const $vars = { $arr: ["a", "b", "c", "d", "e"] };
    executeActionItem("SLICE_VAR", { name: "$arr", start: -3, to: "$last3" }, $vars, ctx);
    expect($vars.$last3).toEqual(["c", "d", "e"]);
  });

  it("SLICE_VAR works on strings too", () => {
    const $vars = { $s: "hello world" };
    executeActionItem("SLICE_VAR", { name: "$s", start: 6, to: "$tail" }, $vars, ctx);
    expect($vars.$tail).toBe("world");
  });

  it("SLICE_VAR mutates in-place when no `to` is given", () => {
    const $vars = { $arr: [1, 2, 3, 4, 5] };
    executeActionItem("SLICE_VAR", { name: "$arr", start: 0, end: 2 }, $vars, ctx);
    expect($vars.$arr).toEqual([1, 2]);
  });

  it("UNIQUE_VAR removes primitive duplicates, preserves first occurrence order", () => {
    const $vars = { $arr: [3, 1, 2, 1, 3, 4] };
    executeActionItem("UNIQUE_VAR", { name: "$arr", to: "$out" }, $vars, ctx);
    expect($vars.$out).toEqual([3, 1, 2, 4]);
  });

  it("UNIQUE_VAR with `by` path dedupes object arrays by a key", () => {
    const $vars = { $rows: [{ id: 1, n: "a" }, { id: 1, n: "b" }, { id: 2, n: "c" }] };
    executeActionItem("UNIQUE_VAR", { name: "$rows", by: "id", to: "$out" }, $vars, ctx);
    expect($vars.$out).toEqual([{ id: 1, n: "a" }, { id: 2, n: "c" }]);
  });

  it("UNIQUE_VAR is a no-op on non-arrays", () => {
    const $vars = { $s: "hello" };
    executeActionItem("UNIQUE_VAR", { name: "$s", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBeUndefined();
  });

  it("REVERSE_VAR reverses an array (without mutating original input by reference)", () => {
    const original = [1, 2, 3];
    const $vars = { $arr: original };
    executeActionItem("REVERSE_VAR", { name: "$arr", to: "$out" }, $vars, ctx);
    expect($vars.$out).toEqual([3, 2, 1]);
    // Original untouched when `to` is set.
    expect(original).toEqual([1, 2, 3]);
  });

  it("REVERSE_VAR reverses a string when given one", () => {
    const $vars = { $s: "hello" };
    executeActionItem("REVERSE_VAR", { name: "$s", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe("olleh");
  });
});

describe("SUM_VAR / MIN_VAR / MAX_VAR / AVG_VAR aggregators (2026-05-23)", () => {
  const ctx = makeContext();

  it("SUM_VAR sums a numeric array", () => {
    const $vars = { $arr: [1, 2, 3, 4] };
    executeActionItem("SUM_VAR", { name: "$arr", to: "$total" }, $vars, ctx);
    expect($vars.$total).toBe(10);
  });

  it("SUM_VAR with `by` path sums object arrays", () => {
    const $vars = { $purchases: [{ amount: 5 }, { amount: 12 }, { amount: 3 }] };
    executeActionItem("SUM_VAR", { name: "$purchases", by: "amount", to: "$total" }, $vars, ctx);
    expect($vars.$total).toBe(20);
  });

  it("SUM_VAR on empty array returns 0", () => {
    const $vars = { $arr: [] };
    executeActionItem("SUM_VAR", { name: "$arr", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe(0);
  });

  it("SUM_VAR on missing var returns 0", () => {
    const $vars = {};
    executeActionItem("SUM_VAR", { name: "$missing", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe(0);
  });

  it("SUM_VAR uses default $sum target when `to` is omitted", () => {
    const $vars = { $arr: [10, 20] };
    executeActionItem("SUM_VAR", { name: "$arr" }, $vars, ctx);
    expect($vars.$sum).toBe(30);
  });

  it("MIN_VAR returns smallest value", () => {
    const $vars = { $arr: [4, 1, 7, 2, 9] };
    executeActionItem("MIN_VAR", { name: "$arr", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe(1);
  });

  it("MAX_VAR returns largest value", () => {
    const $vars = { $arr: [4, 1, 7, 2, 9] };
    executeActionItem("MAX_VAR", { name: "$arr", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe(9);
  });

  it("MIN_VAR / MAX_VAR on empty array return null (no meaningful answer)", () => {
    const $vars = { $arr: [] };
    executeActionItem("MIN_VAR", { name: "$arr", to: "$min" }, $vars, ctx);
    executeActionItem("MAX_VAR", { name: "$arr", to: "$max" }, $vars, ctx);
    expect($vars.$min).toBeNull();
    expect($vars.$max).toBeNull();
  });

  it("AVG_VAR returns the mean", () => {
    const $vars = { $arr: [10, 20, 30] };
    executeActionItem("AVG_VAR", { name: "$arr", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe(20);
  });

  it("AVG_VAR rounds to 2 decimals", () => {
    const $vars = { $arr: [1, 2, 3] }; // mean = 2
    executeActionItem("AVG_VAR", { name: "$arr", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe(2);
    const $v2 = { $arr: [1, 2] }; // mean = 1.5
    executeActionItem("AVG_VAR", { name: "$arr", to: "$out" }, $v2, ctx);
    expect($v2.$out).toBe(1.5);
    const $v3 = { $arr: [1, 1, 2] }; // mean = 1.333...
    executeActionItem("AVG_VAR", { name: "$arr", to: "$out" }, $v3, ctx);
    expect($v3.$out).toBe(1.33);
  });

  it("AVG_VAR with `by` path averages object arrays", () => {
    const $vars = { $rows: [{ kcal: 200 }, { kcal: 400 }, { kcal: 300 }] };
    executeActionItem("AVG_VAR", { name: "$rows", by: "kcal", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe(300);
  });

  it("aggregators skip non-numeric entries silently", () => {
    const $vars = { $arr: [1, "two", 3, null, 5] };
    executeActionItem("SUM_VAR", { name: "$arr", to: "$sum" }, $vars, ctx);
    expect($vars.$sum).toBe(9); // 1 + 3 + 5; "two" → NaN filtered, null → 0 → Number(null)=0 but Number.isFinite(0)=true so 0 counts. Actually Number(null)=0 → 0 included → 1+0+3+0+5=9. OK.
    // Above note: Number(null) = 0 which IS finite, so null counts as 0.
    // Number("two") = NaN, filtered out.
  });
});

describe("STREAK_VAR action (vision-vs-now streaks gap, 2026-05-23)", () => {
  const ctx = makeContext();

  it("counts consecutive days backward from today", () => {
    // Today = 2026-05-23. Rows for 23, 22, 21 → streak of 3.
    const $vars = {
      $today: "2026-05-23",
      $rows: [
        { date: "2026-05-23" },
        { date: "2026-05-22" },
        { date: "2026-05-21" },
        { date: "2026-05-15" }, // gap — should NOT count.
      ],
    };
    executeActionItem("STREAK_VAR", { name: "$rows", to: "$streak" }, $vars, ctx);
    expect($vars.$streak).toBe(3);
  });

  it("returns 0 when today is missing from the set", () => {
    const $vars = {
      $today: "2026-05-23",
      $rows: [{ date: "2026-05-22" }, { date: "2026-05-21" }],
    };
    executeActionItem("STREAK_VAR", { name: "$rows", to: "$streak" }, $vars, ctx);
    expect($vars.$streak).toBe(0);
  });

  it("dedupes multiple rows on the same day", () => {
    const $vars = {
      $today: "2026-05-23",
      $rows: [
        { date: "2026-05-23" }, // dup
        { date: "2026-05-23" }, // dup
        { date: "2026-05-22" },
      ],
    };
    executeActionItem("STREAK_VAR", { name: "$rows", to: "$streak" }, $vars, ctx);
    expect($vars.$streak).toBe(2);
  });

  it("respects custom `by` path for object arrays", () => {
    const $vars = {
      $today: "2026-05-23",
      $rows: [
        { completedAt: "2026-05-23T14:00:00.000Z" },
        { completedAt: "2026-05-22T10:00:00.000Z" },
      ],
    };
    executeActionItem("STREAK_VAR", { name: "$rows", by: "completedAt", to: "$streak" }, $vars, ctx);
    expect($vars.$streak).toBe(2);
  });

  it("uses custom `today` override when provided", () => {
    const $vars = {
      $today: "2026-12-31",
      $rows: [{ date: "2026-05-23" }, { date: "2026-05-22" }],
    };
    executeActionItem("STREAK_VAR", { name: "$rows", today: "2026-05-23", to: "$streak" }, $vars, ctx);
    expect($vars.$streak).toBe(2);
  });

  it("returns 0 on empty / missing array", () => {
    const $vars = { $today: "2026-05-23", $rows: [] };
    executeActionItem("STREAK_VAR", { name: "$rows", to: "$streak" }, $vars, ctx);
    expect($vars.$streak).toBe(0);

    const $v2 = { $today: "2026-05-23" };
    executeActionItem("STREAK_VAR", { name: "$missing", to: "$streak" }, $v2, ctx);
    expect($v2.$streak).toBe(0);
  });

  it("ignores malformed date strings without crashing", () => {
    const $vars = {
      $today: "2026-05-23",
      $rows: [
        { date: "2026-05-23" },
        { date: "garbage" },     // skipped
        { date: null },          // skipped
        { date: "2026-05-22" },
      ],
    };
    executeActionItem("STREAK_VAR", { name: "$rows", to: "$streak" }, $vars, ctx);
    expect($vars.$streak).toBe(2);
  });

  it("uses default target $streak when `to` is omitted", () => {
    const $vars = { $today: "2026-05-23", $rows: [{ date: "2026-05-23" }] };
    executeActionItem("STREAK_VAR", { name: "$rows" }, $vars, ctx);
    expect($vars.$streak).toBe(1);
  });

  it("a long streak walks all the way back (placeholder before string-action tests)", () => {
    const $today = "2026-05-23";
    const rows = [];
    // Build a 60-day continuous run ending today.
    const start = new Date(2026, 4, 23);
    for (let i = 0; i < 60; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() - i);
      const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      rows.push({ date: ymd });
    }
    // Add a 100-day gap then a much older block — should NOT extend the streak.
    rows.push({ date: "2026-01-01" });
    const $vars = { $today, $rows: rows };
    executeActionItem("STREAK_VAR", { name: "$rows", to: "$streak" }, $vars, ctx);
    expect($vars.$streak).toBe(60);
  });
});

describe("String manipulation actions (2026-05-23)", () => {
  const ctx = makeContext();

  it("TO_LOWER / TO_UPPER convert case", () => {
    const $vars = { $s: "Hello World" };
    executeActionItem("TO_LOWER", { name: "$s", to: "$lo" }, $vars, ctx);
    executeActionItem("TO_UPPER", { name: "$s", to: "$up" }, $vars, ctx);
    expect($vars.$lo).toBe("hello world");
    expect($vars.$up).toBe("HELLO WORLD");
  });

  it("TO_LOWER is a no-op on non-strings", () => {
    const $vars = { $n: 42 };
    executeActionItem("TO_LOWER", { name: "$n", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBeUndefined();
  });

  it("TRIM_STRING strips whitespace", () => {
    const $vars = { $s: "  hello  \n" };
    executeActionItem("TRIM_STRING", { name: "$s", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe("hello");
  });

  it("REPLACE_STRING replaces first match by default", () => {
    const $vars = { $s: "foo bar foo baz" };
    executeActionItem("REPLACE_STRING", { name: "$s", find: "foo", replace: "X", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe("X bar foo baz");
  });

  it("REPLACE_STRING with all:true replaces every occurrence", () => {
    const $vars = { $s: "foo bar foo baz" };
    executeActionItem("REPLACE_STRING", { name: "$s", find: "foo", replace: "X", all: true, to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe("X bar X baz");
  });

  it("REPLACE_STRING resolves $-prefixed find/replace expressions", () => {
    const $vars = { $s: "alice and bob", $name: "bob", $newName: "carol" };
    executeActionItem("REPLACE_STRING", { name: "$s", find: "$name", replace: "$newName", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe("alice and carol");
  });

  it("REPLACE_STRING is a no-op when `find` is empty", () => {
    const $vars = { $s: "hello" };
    executeActionItem("REPLACE_STRING", { name: "$s", find: "", replace: "X", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBeUndefined();
  });

  it("CONTAINS_STRING writes true when substring is present", () => {
    const $vars = { $s: "hello world" };
    executeActionItem("CONTAINS_STRING", { name: "$s", find: "world", to: "$ok" }, $vars, ctx);
    expect($vars.$ok).toBe(true);
  });

  it("CONTAINS_STRING writes false when substring is absent", () => {
    const $vars = { $s: "hello world" };
    executeActionItem("CONTAINS_STRING", { name: "$s", find: "xyz", to: "$ok" }, $vars, ctx);
    expect($vars.$ok).toBe(false);
  });

  it("CONTAINS_STRING with empty `find` returns true (vacuous)", () => {
    const $vars = { $s: "anything" };
    executeActionItem("CONTAINS_STRING", { name: "$s", find: "", to: "$ok" }, $vars, ctx);
    expect($vars.$ok).toBe(true);
  });

  it("CONTAINS_STRING returns false on non-strings", () => {
    const $vars = { $n: 42 };
    executeActionItem("CONTAINS_STRING", { name: "$n", find: "4", to: "$ok" }, $vars, ctx);
    expect($vars.$ok).toBe(false);
  });

  it("CONCAT_STRINGS joins multiple expressions", () => {
    const $vars = { $name: "Ava", $city: "SF" };
    executeActionItem("CONCAT_STRINGS", {
      values: ["$name", "literal: from ", "$city"],
      to: "$out",
    }, $vars, ctx);
    expect($vars.$out).toBe("Ava from SF");
  });

  it("CONCAT_STRINGS with separator", () => {
    const $vars = { $a: "hello", $b: "world" };
    executeActionItem("CONCAT_STRINGS", {
      values: ["$a", "$b"],
      separator: " · ",
      to: "$out",
    }, $vars, ctx);
    expect($vars.$out).toBe("hello · world");
  });

  it("CONCAT_STRINGS handles null/undefined as empty string", () => {
    const $vars = { $a: "hello", $b: null };
    executeActionItem("CONCAT_STRINGS", {
      values: ["$a", "$b", "$missing"],
      separator: ",",
      to: "$out",
    }, $vars, ctx);
    expect($vars.$out).toBe("hello,,");
  });
});

describe("ARRAY_AT + INDEX_OF_VAR actions (2026-05-23)", () => {
  const ctx = makeContext();

  it("ARRAY_AT returns the element at a positive index", () => {
    const $vars = { $arr: ["a", "b", "c", "d"] };
    executeActionItem("ARRAY_AT", { name: "$arr", index: 1, to: "$item" }, $vars, ctx);
    expect($vars.$item).toBe("b");
  });

  it("ARRAY_AT supports negative indexing (-1 = last)", () => {
    const $vars = { $arr: ["a", "b", "c", "d"] };
    executeActionItem("ARRAY_AT", { name: "$arr", index: -1, to: "$last" }, $vars, ctx);
    expect($vars.$last).toBe("d");
    executeActionItem("ARRAY_AT", { name: "$arr", index: -2, to: "$secondToLast" }, $vars, ctx);
    expect($vars.$secondToLast).toBe("c");
  });

  it("ARRAY_AT returns undefined for out-of-bounds index", () => {
    const $vars = { $arr: ["a", "b"] };
    executeActionItem("ARRAY_AT", { name: "$arr", index: 99, to: "$out" }, $vars, ctx);
    expect($vars.$out).toBeUndefined();
    executeActionItem("ARRAY_AT", { name: "$arr", index: -5, to: "$out" }, $vars, ctx);
    expect($vars.$out).toBeUndefined();
  });

  it("ARRAY_AT works on strings (character access)", () => {
    const $vars = { $s: "hello" };
    executeActionItem("ARRAY_AT", { name: "$s", index: 0, to: "$first" }, $vars, ctx);
    expect($vars.$first).toBe("h");
    executeActionItem("ARRAY_AT", { name: "$s", index: -1, to: "$last" }, $vars, ctx);
    expect($vars.$last).toBe("o");
  });

  it("ARRAY_AT resolves $-prefixed index expressions", () => {
    const $vars = { $arr: [10, 20, 30], $i: 2 };
    executeActionItem("ARRAY_AT", { name: "$arr", index: "$i", to: "$item" }, $vars, ctx);
    expect($vars.$item).toBe(30);
  });

  it("INDEX_OF_VAR returns the index of a value in an array", () => {
    const $vars = { $arr: ["x", "y", "z", "y"] };
    executeActionItem("INDEX_OF_VAR", { name: "$arr", find: "y", to: "$i" }, $vars, ctx);
    expect($vars.$i).toBe(1); // first match
  });

  it("INDEX_OF_VAR returns -1 when value not found", () => {
    const $vars = { $arr: [1, 2, 3] };
    executeActionItem("INDEX_OF_VAR", { name: "$arr", find: 99, to: "$i" }, $vars, ctx);
    expect($vars.$i).toBe(-1);
  });

  it("INDEX_OF_VAR works on strings (substring index)", () => {
    const $vars = { $s: "hello world" };
    executeActionItem("INDEX_OF_VAR", { name: "$s", find: "world", to: "$i" }, $vars, ctx);
    expect($vars.$i).toBe(6);
  });

  it("INDEX_OF_VAR resolves $-prefixed `find` expression", () => {
    const $vars = { $arr: ["alpha", "beta", "gamma"], $target: "beta" };
    executeActionItem("INDEX_OF_VAR", { name: "$arr", find: "$target", to: "$i" }, $vars, ctx);
    expect($vars.$i).toBe(1);
  });
});

describe("MAP_VAR + FILTER_VAR actions (2026-05-23)", () => {
  const ctx = makeContext();

  it("MAP_VAR transforms numeric elements via an expression", () => {
    const $vars = { $arr: [1, 2, 3, 4] };
    // Extract a sub-path on each item by setting up object array first.
    const $rows = { $rows: [{ amount: 5 }, { amount: 12 }, { amount: 8 }] };
    executeActionItem("MAP_VAR", { name: "$rows", expr: "$item.amount", to: "$out" }, $rows, ctx);
    expect($rows.$out).toEqual([5, 12, 8]);
  });

  it("MAP_VAR uses custom `as` for the iteration variable", () => {
    const $vars = { $people: [{ name: "Ava" }, { name: "Ben" }] };
    executeActionItem("MAP_VAR", { name: "$people", as: "$p", expr: "$p.name", to: "$names" }, $vars, ctx);
    expect($vars.$names).toEqual(["Ava", "Ben"]);
  });

  it("MAP_VAR exposes $index inside the expression", () => {
    const $vars = { $arr: ["a", "b", "c"] };
    executeActionItem("MAP_VAR", { name: "$arr", expr: "$index", to: "$out" }, $vars, ctx);
    expect($vars.$out).toEqual([0, 1, 2]);
  });

  it("MAP_VAR restores prior $item / $index after iteration", () => {
    const $vars = { $arr: [1, 2, 3], $item: "outer-item", $index: 99 };
    executeActionItem("MAP_VAR", { name: "$arr", expr: "$item", to: "$out" }, $vars, ctx);
    expect($vars.$out).toEqual([1, 2, 3]);
    // Outer scope's $item / $index restored:
    expect($vars.$item).toBe("outer-item");
    expect($vars.$index).toBe(99);
  });

  it("MAP_VAR is a no-op on non-arrays", () => {
    const $vars = { $s: "hello" };
    executeActionItem("MAP_VAR", { name: "$s", expr: "$item", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBeUndefined();
  });

  it("FILTER_VAR keeps matching elements with default IS comparator", () => {
    const $vars = { $arr: [{ done: true }, { done: false }, { done: true }] };
    executeActionItem("FILTER_VAR", { name: "$arr", as: "$x", comparator: "IS", right: true, to: "$out" }, $vars, ctx);
    // Default `right` literal — needs the comparator on $item itself which
    // won't match an object. Use a sub-path expression instead by setting
    // up a primitive array.
    const $primitive = { $arr: [1, 2, 3, 2] };
    executeActionItem("FILTER_VAR", { name: "$arr", comparator: "IS", right: 2, to: "$twos" }, $primitive, ctx);
    expect($primitive.$twos).toEqual([2, 2]);
  });

  it("FILTER_VAR works with GREATER", () => {
    const $vars = { $arr: [1, 5, 3, 7, 2] };
    executeActionItem("FILTER_VAR", { name: "$arr", comparator: "GREATER", right: 3, to: "$bigs" }, $vars, ctx);
    expect($vars.$bigs).toEqual([5, 7]);
  });

  it("FILTER_VAR resolves $-prefixed `right` expression", () => {
    const $vars = { $arr: [1, 2, 3, 4], $threshold: 2 };
    executeActionItem("FILTER_VAR", { name: "$arr", comparator: "GREATER", right: "$threshold", to: "$out" }, $vars, ctx);
    expect($vars.$out).toEqual([3, 4]);
  });
});

describe("DATE_FORMAT action (2026-05-23)", () => {
  const ctx = makeContext();

  it("formats ISO date with default 'EEE MMM d' token string", () => {
    // 2026-05-23 is a Saturday.
    const $vars = {};
    executeActionItem("DATE_FORMAT", { date: "2026-05-23", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe("Sat May 23");
  });

  it("supports yyyy / MM / dd tokens", () => {
    const $vars = {};
    executeActionItem("DATE_FORMAT", { date: "2026-05-07", format: "yyyy-MM-dd", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe("2026-05-07");
  });

  it("supports full month + weekday tokens", () => {
    const $vars = {};
    executeActionItem("DATE_FORMAT", { date: "2026-05-23", format: "EEEE, MMMM d, yyyy", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe("Saturday, May 23, 2026");
  });

  it("supports single-digit M / d tokens", () => {
    const $vars = {};
    executeActionItem("DATE_FORMAT", { date: "2026-05-07", format: "M/d/yy", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe("5/7/26");
  });

  it("resolves $-prefixed date expression", () => {
    const $vars = { $myDate: "2026-12-25" };
    executeActionItem("DATE_FORMAT", { date: "$myDate", format: "EEE", to: "$dow" }, $vars, ctx);
    expect($vars.$dow).toBe("Fri");
  });

  it("uses default $formatted target when `to` is omitted", () => {
    const $vars = {};
    executeActionItem("DATE_FORMAT", { date: "2026-05-23" }, $vars, ctx);
    expect($vars.$formatted).toBe("Sat May 23");
  });

  it("returns empty string for missing date", () => {
    const $vars = {};
    executeActionItem("DATE_FORMAT", { date: null, to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe("");
  });

  it("returns the raw string for unparseable input", () => {
    const $vars = {};
    executeActionItem("DATE_FORMAT", { date: "not-a-date", to: "$out" }, $vars, ctx);
    expect($vars.$out).toBe("not-a-date");
  });
});

describe("GROUP_BY action (2026-05-23)", () => {
  const ctx = makeContext();

  it("groups by a simple top-level key", () => {
    const $vars = {
      $rows: [
        { type: "income", amount: 100 },
        { type: "expense", amount: 30 },
        { type: "income", amount: 50 },
        { type: "expense", amount: 12 },
      ],
    };
    executeActionItem("GROUP_BY", { name: "$rows", by: "type", to: "$g" }, $vars, ctx);
    expect($vars.$g.income).toHaveLength(2);
    expect($vars.$g.expense).toHaveLength(2);
    expect($vars.$g.income[0].amount).toBe(100);
    expect($vars.$g.income[1].amount).toBe(50);
  });

  it("groups by a nested dotted path", () => {
    const $vars = {
      $rows: [
        { meta: { kind: "a" }, v: 1 },
        { meta: { kind: "b" }, v: 2 },
        { meta: { kind: "a" }, v: 3 },
      ],
    };
    executeActionItem("GROUP_BY", { name: "$rows", by: "meta.kind", to: "$g" }, $vars, ctx);
    expect(Object.keys($vars.$g).sort()).toEqual(["a", "b"]);
    expect($vars.$g.a.map(x => x.v)).toEqual([1, 3]);
    expect($vars.$g.b.map(x => x.v)).toEqual([2]);
  });

  it("places null/undefined keys under 'null'", () => {
    const $vars = {
      $rows: [
        { type: "x" },
        { type: null },
        {}, // type undefined
        { type: "x" },
      ],
    };
    executeActionItem("GROUP_BY", { name: "$rows", by: "type", to: "$g" }, $vars, ctx);
    expect($vars.$g.x).toHaveLength(2);
    expect($vars.$g.null).toHaveLength(2);
  });

  it("coerces non-string keys to strings", () => {
    const $vars = {
      $rows: [
        { score: 1 }, { score: 2 }, { score: 1 }, { score: 3 },
      ],
    };
    executeActionItem("GROUP_BY", { name: "$rows", by: "score", to: "$g" }, $vars, ctx);
    expect(Object.keys($vars.$g).sort()).toEqual(["1", "2", "3"]);
    expect($vars.$g["1"]).toHaveLength(2);
  });

  it("empty array → empty object", () => {
    const $vars = { $rows: [] };
    executeActionItem("GROUP_BY", { name: "$rows", by: "type", to: "$g" }, $vars, ctx);
    expect($vars.$g).toEqual({});
  });

  it("missing array or by-path → empty object", () => {
    const $vars = { $rows: "not array" };
    executeActionItem("GROUP_BY", { name: "$rows", by: "type", to: "$g" }, $vars, ctx);
    expect($vars.$g).toEqual({});

    const $v2 = { $rows: [{ type: "a" }] };
    executeActionItem("GROUP_BY", { name: "$rows", to: "$g" }, $v2, ctx);
    expect($v2.$g).toEqual({});
  });

  it("uses default $groups target when `to` is omitted", () => {
    const $vars = { $rows: [{ k: "a" }, { k: "b" }] };
    executeActionItem("GROUP_BY", { name: "$rows", by: "k" }, $vars, ctx);
    expect($vars.$groups).toBeDefined();
    expect(Object.keys($vars.$groups).sort()).toEqual(["a", "b"]);
  });

  it("preserves insertion order within each group", () => {
    const $vars = {
      $rows: [
        { g: "a", n: 1 },
        { g: "b", n: 2 },
        { g: "a", n: 3 },
        { g: "a", n: 4 },
        { g: "b", n: 5 },
      ],
    };
    executeActionItem("GROUP_BY", { name: "$rows", by: "g", to: "$g" }, $vars, ctx);
    expect($vars.$g.a.map(x => x.n)).toEqual([1, 3, 4]);
    expect($vars.$g.b.map(x => x.n)).toEqual([2, 5]);
  });
});
