// utils/operationBuilders.js
// Operation factory helpers used by createDefaultUserData.js (frozen) and
// any future seeds. Emits the unified UPDATE verb for display writes —
// path = `$display.<targetFieldId>.<itemId>`. Callers MUST pass `itemId`
// (the occurrence id of the display item that should render the value).

import { nanoid } from "nanoid";

export function uid() {
  return nanoid(12);
}

// Build a display-write step that publishes a computed value onto a
// specific item's computedValues entry.
function makeDisplayUpdate({ targetFieldId, itemId, sourceExpr }) {
  return {
    id: uid(),
    type: "action",
    config: {
      type: "UPDATE",
      path: `$display.${targetFieldId}.${itemId}`,
      value: sourceExpr,
    },
  };
}

// ============================================================
// LOOP-BASED OPERATION HELPERS
// LOOP → IF → variable accumulation → UPDATE display path.
// All helpers fire on field changes, filter changes, and load.
// ============================================================

/** Sum a single field across occurrences (daily/weekly/all, optional flow filter) */
export function makeLoopSumOp({ name, targetFieldId, itemId, fieldId, timeFilter = "daily", flowFilter = "any", targetValue, targetPeriod = "daily", folderId = null, userId, gridId }) {
  return {
    id: uid(), userId, gridId, name, folderId,
    description: `Sum of ${name} values (${timeFilter}) — granular LOOP pipeline`,
    triggerType: "onChange",
    triggerTypes: ["onChange", "onFilterChange", "onLoad"],
    triggerConfig: { onChange: { allowedFields: [fieldId] }, ...(targetValue != null ? { display: { targetValue, targetPeriod } } : {}) },
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
        {
          id: uid(), type: "loop",
          over: "field_occurrences", fieldId, timeFilter, flowFilter, as: "$item",
          body: [{
            id: uid(), type: "if",
            condition: { operator: "AND", rules: [{ comparator: "IS_NOT_EMPTY", left: "$item.value" }] },
            then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$total", expr: "$item.value" } }],
            else: [],
          }],
        },
        makeDisplayUpdate({ targetFieldId, itemId, sourceExpr: "$total" }),
      ],
    },
  };
}

/** Count non-empty field occurrences */
export function makeLoopCountOp({ name, targetFieldId, itemId, fieldId, timeFilter = "daily", flowFilter = "any", folderId = null, userId, gridId }) {
  return {
    id: uid(), userId, gridId, name, folderId,
    description: `Count of non-empty ${name} occurrences (${timeFilter}) — granular LOOP pipeline`,
    triggerType: "onChange",
    triggerTypes: ["onChange", "onFilterChange", "onLoad"],
    triggerConfig: { onChange: { allowedFields: [fieldId] } },
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$count", value: 0 } },
        {
          id: uid(), type: "loop",
          over: "field_occurrences", fieldId, timeFilter, flowFilter, as: "$item",
          body: [{
            id: uid(), type: "if",
            condition: { operator: "AND", rules: [{ comparator: "IS_NOT_EMPTY", left: "$item.value" }] },
            then: [{ id: uid(), type: "action", config: { type: "INCREMENT_VAR", name: "$count", by: 1 } }],
            else: [],
          }],
        },
        makeDisplayUpdate({ targetFieldId, itemId, sourceExpr: "$count" }),
      ],
    },
  };
}

/**
 * Count occurrences where boolean field === true.
 * Pass `pageLabel` to scope the loop to descendants of a named page item.
 */
export function makeLoopCountTrueOp({ name, targetFieldId, itemId, fieldId, timeFilter = "daily", folderId = null, targetValue, targetPeriod = "daily", userId, gridId, pageLabel = null, includeAddDelete = false }) {
  const findStep = pageLabel ? [{
    id: uid(), type: "action", config: {
      type: "FIND",
      predicate: { operator: "AND", rules: [
        { id: uid(), left: "$item.label", comparator: "IS", right: pageLabel },
      ]},
      itemIdVar: "$scopePageId",
    },
  }] : [];

  const ancestorRule = pageLabel
    ? [{ comparator: "HAS_ANCESTOR", left: "$item._ancestors", right: "$scopePageId" }]
    : [];

  return {
    id: uid(), userId, gridId, name, folderId,
    description: `Count completed (true) ${name} occurrences (${timeFilter}) — granular LOOP pipeline`,
    triggerType: "onChange",
    triggerTypes: includeAddDelete
      ? ["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"]
      : ["onChange", "onFilterChange", "onLoad"],
    triggerConfig: { onChange: { allowedFields: [fieldId] }, ...(targetValue != null ? { display: { targetValue, targetPeriod } } : {}) },
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$count", value: 0 } },
        ...findStep,
        {
          id: uid(), type: "loop",
          over: "field_occurrences", fieldId, timeFilter, flowFilter: "any", as: "$item",
          body: [{
            id: uid(), type: "if",
            condition: {
              operator: "AND",
              rules: [
                { comparator: "IS", left: "$item.value", right: true },
                ...ancestorRule,
              ],
            },
            then: [{ id: uid(), type: "action", config: { type: "INCREMENT_VAR", name: "$count", by: 1 } }],
            else: [],
          }],
        },
        makeDisplayUpdate({ targetFieldId, itemId, sourceExpr: "$count" }),
      ],
    },
  };
}

/** Capture last recorded value (overwrites $latest each iteration — final = last in time order) */
export function makeLoopLastOp({ name, targetFieldId, itemId, fieldId, timeFilter = "daily", folderId = null, userId, gridId }) {
  return {
    id: uid(), userId, gridId, name, folderId,
    description: `Last recorded ${name} value (${timeFilter}) — granular LOOP pipeline`,
    triggerType: "onChange",
    triggerTypes: ["onChange", "onFilterChange", "onLoad"],
    triggerConfig: { onChange: { allowedFields: [fieldId] } },
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$latest", value: null } },
        {
          id: uid(), type: "loop",
          over: "field_occurrences", fieldId, timeFilter, flowFilter: "any", as: "$item",
          body: [{
            id: uid(), type: "if",
            condition: { operator: "AND", rules: [{ comparator: "IS_NOT_EMPTY", left: "$item.value" }] },
            then: [{ id: uid(), type: "action", config: { type: "SET_VAR", name: "$latest", expr: "$item.value" } }],
            else: [],
          }],
        },
        makeDisplayUpdate({ targetFieldId, itemId, sourceExpr: "$latest" }),
      ],
    },
  };
}

/** Sum across multiple source fields (e.g., set1Reps + set2Reps + set3Reps) — one LOOP per field */
export function makeLoopMultiSumOp({ name, targetFieldId, itemId, fieldIds, timeFilter = "daily", folderId = null, targetValue, targetPeriod = "daily", userId, gridId }) {
  return {
    id: uid(), userId, gridId, name, folderId,
    description: `Sum of ${fieldIds.length} source fields (${timeFilter}) — granular LOOP pipeline`,
    triggerType: "onChange",
    triggerTypes: ["onChange", "onFilterChange", "onLoad"],
    triggerConfig: { onChange: { allowedFields: fieldIds }, ...(targetValue != null ? { display: { targetValue, targetPeriod } } : {}) },
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
        ...fieldIds.map(fieldId => ({
          id: uid(), type: "loop",
          over: "field_occurrences", fieldId, timeFilter, flowFilter: "any", as: "$item",
          body: [{
            id: uid(), type: "if",
            condition: { operator: "AND", rules: [{ comparator: "IS_NOT_EMPTY", left: "$item.value" }] },
            then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$total", expr: "$item.value" } }],
            else: [],
          }],
        })),
        makeDisplayUpdate({ targetFieldId, itemId, sourceExpr: "$total" }),
      ],
    },
  };
}

/** Net balance = income (flow:in) minus spent (flow:out) — two loops, then subtract */
export function makeNetBalanceOp({ name, targetFieldId, itemId, incomeFieldId, spentFieldId, folderId = null, userId, gridId }) {
  return {
    id: uid(), userId, gridId, name, folderId,
    description: `Net balance = Σ income (flow:in) − Σ spent (flow:out), all time — granular LOOP pipeline`,
    triggerType: "onChange",
    triggerTypes: ["onChange", "onFilterChange", "onLoad"],
    triggerConfig: { onChange: { allowedFields: [incomeFieldId, spentFieldId] } },
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$income", value: 0 } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$spent", value: 0 } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$net", value: 0 } },
        {
          id: uid(), type: "loop",
          over: "field_occurrences", fieldId: incomeFieldId, timeFilter: "all", flowFilter: "in", as: "$item",
          body: [{
            id: uid(), type: "if",
            condition: { operator: "AND", rules: [{ comparator: "IS_NOT_EMPTY", left: "$item.value" }] },
            then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$income", expr: "$item.value" } }],
            else: [],
          }],
        },
        {
          id: uid(), type: "loop",
          over: "field_occurrences", fieldId: spentFieldId, timeFilter: "all", flowFilter: "out", as: "$item",
          body: [{
            id: uid(), type: "if",
            condition: { operator: "AND", rules: [{ comparator: "IS_NOT_EMPTY", left: "$item.value" }] },
            then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$spent", expr: "$item.value" } }],
            else: [],
          }],
        },
        // net = income - spent: copy income → $net, negate $spent, add to $net
        { id: uid(), type: "action", config: { type: "SET_VAR", name: "$net", expr: "$income" } },
        { id: uid(), type: "action", config: { type: "MULTIPLY_VAR", name: "$spent", expr: -1 } },
        { id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$net", expr: "$spent" } },
        makeDisplayUpdate({ targetFieldId, itemId, sourceExpr: "$net" }),
      ],
    },
  };
}

/** Completion rate as percentage: (done / total) × 100 — uses DIV_VAR */
export function makeCompletionRateOp({ name, targetFieldId, itemId, fieldId, timeFilter = "all", folderId = null, userId, gridId }) {
  return {
    id: uid(), userId, gridId, name, folderId,
    description: `Completion rate % (${timeFilter}) — counts done vs total, divides, shows % — granular LOOP pipeline`,
    triggerType: "onChange",
    triggerTypes: ["onChange", "onFilterChange", "onLoad"],
    triggerConfig: { onChange: { allowedFields: [fieldId] } },
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$done", value: 0 } },
        {
          id: uid(), type: "loop",
          over: "field_occurrences", fieldId, timeFilter, flowFilter: "any", as: "$item",
          body: [{
            id: uid(), type: "if",
            condition: { operator: "AND", rules: [{ comparator: "IS_NOT_EMPTY", left: "$item.value" }] },
            then: [
              { id: uid(), type: "action", config: { type: "INCREMENT_VAR", name: "$total", by: 1 } },
              {
                id: uid(), type: "if",
                condition: { operator: "AND", rules: [{ comparator: "IS", left: "$item.value", right: true }] },
                then: [{ id: uid(), type: "action", config: { type: "INCREMENT_VAR", name: "$done", by: 1 } }],
                else: [],
              },
            ],
            else: [],
          }],
        },
        // percent = ($done / $total) * 100
        { id: uid(), type: "action", config: { type: "MULTIPLY_VAR", name: "$done", expr: 100 } },
        { id: uid(), type: "action", config: { type: "DIV_VAR", name: "$done", by: "$total" } },
        makeDisplayUpdate({ targetFieldId, itemId, sourceExpr: "$done" }),
      ],
    },
  };
}

/** Create a static-literal operation using the pipeline steps format. */
export function makeLiteralOp({ name, targetFieldId, itemId, value, userId, gridId }) {
  return {
    id: uid(), userId, gridId,
    name,
    description: `Sets ${name} to a fixed value: "${value}"`,
    triggerType: "onFilterChange",
    triggerTypes: ["onFilterChange", "onLoad"],
    triggerConfig: {},
    enabled: true,
    targetFieldId,
    pipeline: {
      sources: [],
      steps: [makeDisplayUpdate({ targetFieldId, itemId, sourceExpr: `literal:${value}` })],
    },
  };
}

/**
 * Generates time labels for 24-hour schedule in 30-minute increments
 */
export function generateTimeSlots() {
  const slots = [];
  for (let hour = 0; hour < 24; hour++) {
    for (let minute = 0; minute < 60; minute += 30) {
      const h = hour % 12 || 12;
      const ampm = hour < 12 ? "am" : "pm";
      const m = minute === 0 ? "00" : "30";
      slots.push({
        label: `${h}:${m}${ampm}`,
        hour,
        minute,
      });
    }
  }
  return slots;
}
