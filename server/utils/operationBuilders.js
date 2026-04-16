// utils/operationBuilders.js
// Operation factory helpers used by createDefaultUserData.js

import { nanoid } from "nanoid";

export function uid() {
  return nanoid(12);
}

// ============================================================
// LOOP-BASED OPERATION HELPERS
// These replace the old black-box AGGREGATE action with explicit
// granular building blocks: LOOP → IF → variable accumulation → SHOW_VALUE.
// All helpers fire on both field changes and iteration navigation.
// ============================================================

/** Sum a single field across occurrences (daily/weekly/all, optional flow filter) */
export function makeLoopSumOp({ name, targetFieldId, fieldId, timeFilter = "daily", flowFilter = "any", targetValue, targetPeriod = "daily", folderId = null, userId, gridId, pageOccId = null }) {
  return {
    id: uid(), userId, gridId, name, folderId,
    description: `Sum of ${name} values (${timeFilter}) — granular LOOP pipeline`,
    triggerType: "onChange",
    triggerTypes: ["onChange", "onIteration", "onLoad"],
    triggerConfig: { onChange: { allowedFields: [fieldId] } },
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$total", value: 0 } },
        {
          id: uid(), type: "loop",
          over: "field_occurrences", fieldId, timeFilter, flowFilter, as: "$item",
          ...(pageOccId ? { pageOccId } : {}),
          body: [{
            id: uid(), type: "if",
            condition: { operator: "AND", rules: [{ comparator: "IS_NOT_EMPTY", left: "$item.value" }] },
            then: [{ id: uid(), type: "action", config: { type: "ADD_TO_VAR", name: "$total", expr: "$item.value" } }],
            else: [],
          }],
        },
        { id: uid(), type: "action", config: { type: "SHOW_VALUE", targetFieldId, sourceExpr: "$total", ...(targetValue != null ? { targetValue, targetPeriod } : {}) } },
      ],
    },
  };
}

/** Count non-empty field occurrences */
export function makeLoopCountOp({ name, targetFieldId, fieldId, timeFilter = "daily", flowFilter = "any", folderId = null, userId, gridId }) {
  return {
    id: uid(), userId, gridId, name, folderId,
    description: `Count of non-empty ${name} occurrences (${timeFilter}) — granular LOOP pipeline`,
    triggerType: "onChange",
    triggerTypes: ["onChange", "onIteration", "onLoad"],
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
        { id: uid(), type: "action", config: { type: "SHOW_VALUE", targetFieldId, sourceExpr: "$count" } },
      ],
    },
  };
}

/** Count occurrences where boolean field === true */
export function makeLoopCountTrueOp({ name, targetFieldId, fieldId, timeFilter = "daily", folderId = null, targetValue, targetPeriod = "daily", userId, gridId, pageOccId = null }) {
  return {
    id: uid(), userId, gridId, name, folderId,
    description: `Count completed (true) ${name} occurrences (${timeFilter}) — granular LOOP pipeline`,
    triggerType: "onChange",
    triggerTypes: ["onChange", "onIteration", "onLoad"],
    triggerConfig: { onChange: { allowedFields: [fieldId] } },
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$count", value: 0 } },
        {
          id: uid(), type: "loop",
          over: "field_occurrences", fieldId, timeFilter, flowFilter: "any", as: "$item",
          ...(pageOccId ? { pageOccId } : {}),
          body: [{
            id: uid(), type: "if",
            condition: { operator: "AND", rules: [{ comparator: "IS", left: "$item.value", right: true }] },
            then: [{ id: uid(), type: "action", config: { type: "INCREMENT_VAR", name: "$count", by: 1 } }],
            else: [],
          }],
        },
        { id: uid(), type: "action", config: { type: "SHOW_VALUE", targetFieldId, sourceExpr: "$count", ...(targetValue != null ? { targetValue, targetPeriod } : {}) } },
      ],
    },
  };
}

/** Capture last recorded value (overwrites $latest each iteration — final = last in time order) */
export function makeLoopLastOp({ name, targetFieldId, fieldId, timeFilter = "daily", folderId = null, userId, gridId }) {
  return {
    id: uid(), userId, gridId, name, folderId,
    description: `Last recorded ${name} value (${timeFilter}) — granular LOOP pipeline`,
    triggerType: "onChange",
    triggerTypes: ["onChange", "onIteration", "onLoad"],
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
        { id: uid(), type: "action", config: { type: "SHOW_VALUE", targetFieldId, sourceExpr: "$latest" } },
      ],
    },
  };
}

/** Sum across multiple source fields (e.g., set1Reps + set2Reps + set3Reps) — one LOOP per field */
export function makeLoopMultiSumOp({ name, targetFieldId, fieldIds, timeFilter = "daily", folderId = null, targetValue, targetPeriod = "daily", userId, gridId }) {
  return {
    id: uid(), userId, gridId, name, folderId,
    description: `Sum of ${fieldIds.length} source fields (${timeFilter}) — granular LOOP pipeline`,
    triggerType: "onChange",
    triggerTypes: ["onChange", "onIteration", "onLoad"],
    triggerConfig: { onChange: { allowedFields: fieldIds } },
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
        { id: uid(), type: "action", config: { type: "SHOW_VALUE", targetFieldId, sourceExpr: "$total", ...(targetValue != null ? { targetValue, targetPeriod } : {}) } },
      ],
    },
  };
}

/** Net balance = income (flow:in) minus spent (flow:out) — two loops, then subtract */
export function makeNetBalanceOp({ name, targetFieldId, incomeFieldId, spentFieldId, folderId = null, userId, gridId }) {
  return {
    id: uid(), userId, gridId, name, folderId,
    description: `Net balance = Σ income (flow:in) − Σ spent (flow:out), all time — granular LOOP pipeline`,
    triggerType: "onChange",
    triggerTypes: ["onChange", "onIteration", "onLoad"],
    triggerConfig: { onChange: { allowedFields: [incomeFieldId, spentFieldId] } },
    enabled: true,
    pipeline: {
      sources: [],
      steps: [
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$income", value: 0 } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$spent", value: 0 } },
        { id: uid(), type: "action", config: { type: "INIT_VAR", name: "$net", value: 0 } },
        // Accumulate income
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
        // Accumulate spent
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
        { id: uid(), type: "action", config: { type: "SHOW_VALUE", targetFieldId, sourceExpr: "$net" } },
      ],
    },
  };
}

/** Completion rate as percentage: (done / total) × 100 — uses DIV_VAR */
export function makeCompletionRateOp({ name, targetFieldId, fieldId, timeFilter = "all", folderId = null, userId, gridId }) {
  return {
    id: uid(), userId, gridId, name, folderId,
    description: `Completion rate % (${timeFilter}) — counts done vs total, divides, shows % — granular LOOP pipeline`,
    triggerType: "onChange",
    triggerTypes: ["onChange", "onIteration", "onLoad"],
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
        { id: uid(), type: "action", config: { type: "SHOW_VALUE", targetFieldId, sourceExpr: "$done" } },
      ],
    },
  };
}

/** Create a static-literal operation using the pipeline steps format. */
export function makeLiteralOp({ name, targetFieldId, value, userId, gridId }) {
  return {
    id: uid(), userId, gridId,
    name,
    description: `Sets ${name} to a fixed value: "${value}"`,
    triggerType: "onIteration",
    triggerTypes: ["onIteration", "onLoad"],
    triggerConfig: {},
    enabled: true,
    targetFieldId,
    pipeline: {
      sources: [],
      steps: [{
        id: uid(),
        type: "action",
        config: { type: "SHOW_VALUE", targetFieldId, sourceExpr: `literal:${value}` },
      }],
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
