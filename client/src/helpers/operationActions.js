// blocks/operationActions.js
// ============================================================
// Pure action helpers extracted from operationExecutor.js
//
// Exports: resolveExpr, evalRule, evalGroup,
//          extractFieldValuesFiltered, executeActionItem
// ============================================================

import { applyAggregation, extractFieldValues } from "./CalculationHelpers";
import { toast } from "sonner";

// ============================================================
// FILTERED VALUE EXTRACTION
// ============================================================
// Extends extractFieldValues with scope and timeFilter support.

export function extractFieldValuesFiltered(occurrences, fieldId, opts = {}) {
  const { flowFilter = "any", scope, timeFilter, state = {}, activeDate: activeDateStr } = opts;

  // No time filtering — just extract with flow filter
  if (!timeFilter || timeFilter === "all" || timeFilter === "inherit") {
    return extractFieldValues(occurrences, fieldId, { flowFilter });
  }

  // Build date field IDs for parent-chain walk
  const fieldsById = state.fieldsById || {};
  const occurrencesById = state.occurrencesById || {};
  const dateFieldIds = Object.values(fieldsById)
    .filter(f => f.type === "date")
    .map(f => f.id);

  // Reference date: use activeDate from filter nav, fall back to today
  const refDate = activeDateStr ? new Date(activeDateStr + "T00:00:00") : new Date();

  // Walk up parent chain to find a date field value (same logic as gatherLoopItems)
  const findDateValue = (occ) => {
    let cur = occ;
    for (let depth = 0; depth < 4 && cur; depth++) {
      for (const dfId of dateFieldIds) {
        const fv = cur.fields?.[dfId];
        const val = fv?.value !== undefined ? fv.value : fv;
        if (val) return val;
      }
      cur = cur.parentId ? occurrencesById[cur.parentId] : null;
    }
    return null;
  };

  const filtered = occurrences.filter(occ => {
    const dateVal = findDateValue(occ);
    // No date at all → treat as persistent (matches any time filter)
    if (!dateVal) return true;
    const d = new Date(dateVal);
    if (timeFilter === "daily") return d.toDateString() === refDate.toDateString();
    if (timeFilter === "weekly") {
      const weekStart = new Date(refDate);
      weekStart.setDate(refDate.getDate() - refDate.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 7);
      return d >= weekStart && d < weekEnd;
    }
    if (timeFilter === "monthly") return d.getMonth() === refDate.getMonth() && d.getFullYear() === refDate.getFullYear();
    if (timeFilter === "yearly") return d.getFullYear() === refDate.getFullYear();
    return true;
  });

  return extractFieldValues(filtered, fieldId, { flowFilter });
}

// ============================================================
// EXPRESSION RESOLVER
// ============================================================

/**
 * Resolve an expression string against $vars map.
 * Expression formats:
 *   "$varName.fieldId"           — look up variable's field value
 *   "literal:value"              — use literal value
 *   "occ:$exprOrId.fieldId.value" — look up occurrence by ID, get field value
 *   "occ:$exprOrId.fieldId.flow"  — look up occurrence by ID, get field flow
 *   "field:fieldId.value"        — get field value across all occurrences (first match)
 *   "field:fieldId.flow"         — get field flow across all occurrences (first match)
 *   (anything else)              — treat as literal
 */
export function resolveExpr(expr, $vars) {
  if (expr == null) return null;
  // Non-string values (numbers, booleans) are literals — return as-is
  if (typeof expr !== "string") return expr;
  if (expr === "") return null;
  if (expr.startsWith("literal:")) {
    const raw = expr.slice(8);
    // Coerce well-known scalar literals so SET_FIELD_VALUE on boolean/number
    // fields round-trips correctly through the editor (literal:false → false).
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "null") return null;
    if (raw !== "" && !isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    return raw;
  }

  // occ:$trigger.occurrenceId.fieldId.value
  // occ:someOccId.fieldId.flow
  if (expr.startsWith("occ:")) {
    const rest = expr.slice(4); // e.g. "$trigger.occurrenceId.fieldId.value"
    const parts = rest.split(".");
    // parts[0] could be "$trigger" and parts[1] "occurrenceId" OR a literal ID
    let occId;
    let startIdx;
    if (parts[0].startsWith("$")) {
      // Resolve the occ ID from a $var reference (potentially 2 parts like "$trigger.occurrenceId")
      const innerExpr = `${parts[0]}.${parts[1]}`;
      occId = resolveExpr(innerExpr, $vars);
      startIdx = 2;
    } else {
      occId = parts[0]; // literal occurrence ID
      startIdx = 1;
    }
    if (!occId) return null;
    const fieldId = parts[startIdx];
    const prop = parts[startIdx + 1] || "value";
    if (!fieldId) return null;
    const occurrencesById = $vars["_occurrencesById"] || {};
    const occ = occurrencesById[occId];
    const fv = occ?.fields?.[fieldId];
    if (fv === undefined || fv === null) return null;
    if (prop === "flow") return fv.flow ?? null;
    return fv.value !== undefined ? fv.value : fv;
  }

  // field:fieldId.value or field:fieldId.flow — search all occurrences
  if (expr.startsWith("field:")) {
    const rest = expr.slice(6);
    const [fieldId, prop = "value"] = rest.split(".");
    if (!fieldId) return null;
    const occurrencesById = $vars["_occurrencesById"] || {};
    for (const occ of Object.values(occurrencesById)) {
      const fv = occ?.fields?.[fieldId];
      if (fv !== undefined && fv !== null) {
        if (prop === "flow") return fv.flow ?? null;
        return fv.value !== undefined ? fv.value : fv;
      }
    }
    return null;
  }

  // daysUntil:expr — days from today to a date value (positive = future, negative = overdue)
  if (expr.startsWith("daysUntil:")) {
    const dateVal = resolveExpr(expr.slice(10), $vars);
    if (!dateVal) return null;
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    d.setHours(0, 0, 0, 0);
    return Math.round((d - today) / 86400000);
  }

  // Template string interpolation: "daypage ${$today}" → "daypage 2026-03-22"
  // Detect ${...} patterns and replace each with resolved inner expression.
  if (expr.includes("${")) {
    return expr.replace(/\$\{([^}]+)\}/g, (_, inner) => {
      const resolved = resolveExpr(inner.trim(), $vars);
      return resolved != null ? String(resolved) : "";
    });
  }

  if (expr.startsWith("$")) {
    // Walk arbitrary depth: "$item.fields.water.value" → $vars["$item"]["fields"]["water"]["value"]
    const parts = expr.slice(1).split(".");
    const varName = `$${parts[0]}`;
    let cur = $vars[varName];
    if (cur == null) return null;
    for (let i = 1; i < parts.length; i++) {
      if (cur == null) return null;
      cur = cur[parts[i]];
    }
    return cur ?? null;
  }

  return expr; // literal
}

// ============================================================
// CONDITION EVALUATORS
// ============================================================

/**
 * Evaluate a single condition rule.
 */
export function evalRule(rule, $vars) {
  const { left, comparator, right } = rule;
  const leftVal = resolveExpr(left, $vars);

  if (comparator === "IS_EMPTY")     return leftVal === null || leftVal === undefined || leftVal === "";
  if (comparator === "IS_NOT_EMPTY") return leftVal !== null && leftVal !== undefined && leftVal !== "";

  const rightVal = resolveExpr(right, $vars) ?? right;

  switch (comparator) {
    case "IS":               return String(leftVal) === String(rightVal);
    case "IS_NOT":           return String(leftVal) !== String(rightVal);
    case "GREATER":          return Number(leftVal) > Number(rightVal);
    case "LESS":             return Number(leftVal) < Number(rightVal);
    case "GREATER_OR_EQUAL": return Number(leftVal) >= Number(rightVal);
    case "LESS_OR_EQUAL":    return Number(leftVal) <= Number(rightVal);
    case "CONTAINS":         return String(leftVal).includes(String(rightVal));
    case "NOT_CONTAINS":     return !String(leftVal).includes(String(rightVal));
    // Array comparators — left resolves to an array (e.g. $item._ancestors)
    case "HAS_ANCESTOR":
    case "ARRAY_INCLUDES": {
      const arr = Array.isArray(leftVal) ? leftVal : [];
      return arr.some(a => String(a) === String(rightVal));
    }
    case "NOT_HAS_ANCESTOR": {
      const arr = Array.isArray(leftVal) ? leftVal : [];
      return !arr.some(a => String(a) === String(rightVal));
    }
    // Date comparators — leftVal is a date field value (ISO string or Date)
    case "DATE_EQUALS":
    case "SAME_DAY": {
      // Right null/"" = wildcard ("no filter set" → match everything).
      // Left null = occurrence has no date → doesn't match a concrete filter.
      // Normalizes both sides to YYYY-MM-DD so "2026-04-16T17:00:00.000Z" matches "2026-04-16".
      if (rightVal == null || rightVal === "") return true;
      if (leftVal == null || leftVal === "") return false;
      const dayKey = (v) => {
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
        const d = new Date(v);
        if (isNaN(d.getTime())) return null;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      };
      const lk = dayKey(leftVal);
      const rk = dayKey(rightVal);
      return lk != null && lk === rk;
    }
    case "SAME_WEEK": {
      // Same ISO week (Mon-Sun). Right null/"" = wildcard; left null = no match.
      if (rightVal == null || rightVal === "") return true;
      if (leftVal == null || leftVal === "") return false;
      const da = new Date(leftVal); const db = new Date(rightVal);
      if (isNaN(da.getTime()) || isNaN(db.getTime())) return false;
      const weekStart = (d) => {
        const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const dow = x.getDay(); // 0=Sun..6=Sat
        const offset = dow === 0 ? -6 : 1 - dow; // shift to Monday
        x.setDate(x.getDate() + offset);
        return x.getTime();
      };
      return weekStart(da) === weekStart(db);
    }
    case "SAME_MONTH": {
      if (rightVal == null || rightVal === "") return true;
      if (leftVal == null || leftVal === "") return false;
      const da = new Date(leftVal); const db = new Date(rightVal);
      if (isNaN(da.getTime()) || isNaN(db.getTime())) return false;
      return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth();
    }
    case "SAME_YEAR": {
      if (rightVal == null || rightVal === "") return true;
      if (leftVal == null || leftVal === "") return false;
      const da = new Date(leftVal); const db = new Date(rightVal);
      if (isNaN(da.getTime()) || isNaN(db.getTime())) return false;
      return da.getFullYear() === db.getFullYear();
    }
    case "DATE_BEFORE_TODAY": {
      if (!leftVal) return false;
      const d = new Date(leftVal);
      if (isNaN(d.getTime())) return false;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      return d < today;
    }
    case "DATE_IS_TODAY": {
      if (!leftVal) return false;
      const d = new Date(leftVal);
      if (isNaN(d.getTime())) return false;
      return d.toDateString() === new Date().toDateString();
    }
    case "DATE_AFTER_TODAY": {
      if (!leftVal) return false;
      const d = new Date(leftVal);
      if (isNaN(d.getTime())) return false;
      const today = new Date(); today.setHours(23, 59, 59, 999);
      return d > today;
    }
    case "DATE_WITHIN_DAYS": {
      if (!leftVal) return false;
      const d = new Date(leftVal);
      if (isNaN(d.getTime())) return false;
      // Normalize both to midnight so partial-day offsets don't affect the count
      d.setHours(0, 0, 0, 0);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const n = parseInt(rightVal) || 7;
      const diffDays = Math.round((d - today) / (1000 * 60 * 60 * 24));
      return diffDays >= 0 && diffDays <= n;
    }
    default: return false;
  }
}

/**
 * Evaluate a condition group (AND or OR).
 */
export function evalGroup(group, $vars) {
  const { operator = "AND", rules = [] } = group;
  if (rules.length === 0) return true;

  // A rules entry is either a leaf rule (has `comparator`) or a nested group (has `rules`)
  const evaluate = (entry) => {
    if (Array.isArray(entry?.rules)) return evalGroup(entry, $vars);
    return evalRule(entry, $vars);
  };

  if (operator === "OR") return rules.some(evaluate);
  return rules.every(evaluate);
}

// ============================================================
// ACTION EXECUTOR
// ============================================================

/**
 * Execute a single action by type + config.
 * Shared by executeSteps and any direct callers.
 *
 * context._executors = { executePipeline, executeOperation } — injected by executePipeline
 * to avoid circular imports for the RUN_OPERATION case.
 */
export function executeActionItem(type, cfg, $vars, context, transaction) {
  const { state, fieldsById = {}, occurrencesById = {}, operationsById = {} } = context;
  const updates = [];

  switch (type) {
    // ---- Variable operations: mutate $vars in-place, no updates emitted ----
    case "INIT_VAR": {
      // cfg.value can be a literal (number, string), cfg.expr can be a resolveExpr expression,
      // cfg.arrayOf can be an array of expressions (each resolved) for literal-array initialization.
      let initVal;
      if (cfg.arrayOf !== undefined) {
        const items = Array.isArray(cfg.arrayOf) ? cfg.arrayOf : [cfg.arrayOf];
        initVal = items.map(x => resolveExpr(x, $vars));
      } else if (cfg.expr !== undefined) {
        initVal = resolveExpr(cfg.expr, $vars);
      } else {
        initVal = cfg.value;
      }
      $vars[cfg.name] = initVal !== undefined ? initVal : 0;
      break;
    }
    case "SET_VAR": {
      $vars[cfg.name] = resolveExpr(cfg.expr, $vars) ?? cfg.value ?? null;
      break;
    }
    case "ADD_TO_VAR": {
      const addVal = Number(resolveExpr(cfg.expr, $vars)) || 0;
      $vars[cfg.name] = (Number($vars[cfg.name]) || 0) + addVal;
      break;
    }
    case "MULTIPLY_VAR": {
      const mulVal = Number(resolveExpr(cfg.expr, $vars)) ?? 1;
      $vars[cfg.name] = (Number($vars[cfg.name]) || 0) * mulVal;
      break;
    }
    case "PUSH_TO_VAR": {
      // Push a value onto an array variable. Creates the array if it doesn't exist.
      const pushVal = resolveExpr(cfg.expr, $vars) ?? cfg.value;
      if (!Array.isArray($vars[cfg.name])) $vars[cfg.name] = [];
      $vars[cfg.name] = [...$vars[cfg.name], pushVal];
      break;
    }
    case "SUBTRACT_FROM_VAR": {
      const subVal = Number(resolveExpr(cfg.expr, $vars)) || 0;
      $vars[cfg.name] = (Number($vars[cfg.name]) || 0) - subVal;
      break;
    }
    case "INCREMENT_VAR": {
      const incrBy = Number(resolveExpr(cfg.by ?? cfg.expr, $vars)) || Number(cfg.by) || 1;
      $vars[cfg.name] = (Number($vars[cfg.name]) || 0) + incrBy;
      break;
    }
    case "DECREMENT_VAR": {
      const decrBy = Number(resolveExpr(cfg.by ?? cfg.expr, $vars)) || Number(cfg.by) || 1;
      $vars[cfg.name] = (Number($vars[cfg.name]) || 0) - decrBy;
      break;
    }
    case "DIV_VAR": {
      const divVal = Number(resolveExpr(cfg.by, $vars));
      $vars[cfg.name] = divVal !== 0 ? Math.round(((Number($vars[cfg.name]) || 0) / divVal) * 100) / 100 : 0;
      break;
    }

    case "SHOW_VALUE":
    case "SET_VALUE": {
      const value = resolveExpr(cfg.sourceExpr, $vars);
      if (cfg.targetFieldId) {
        const target = cfg.targetValue != null
          ? { value: Number(cfg.targetValue), period: cfg.targetPeriod || "daily" }
          : null;
        updates.push({ fieldId: cfg.targetFieldId, value, target });
      }
      break;
    }

    case "NOTIFY": {
      if (cfg.message) toast(cfg.message);
      break;
    }

    case "AGGREGATE": {
      const occurrences = Object.values(occurrencesById);
      let allValues = [];
      if (Array.isArray(cfg.allowedFields) && cfg.allowedFields.length > 0) {
        for (const af of cfg.allowedFields) {
          allValues.push(...extractFieldValuesFiltered(occurrences, af.fieldId, {
            flowFilter: af.flowFilter || cfg.flowFilter || "any",
            timeFilter: cfg.timeFilter,
            state,
          }));
        }
      } else if (cfg.fieldId) {
        allValues = extractFieldValuesFiltered(occurrences, cfg.fieldId, {
          flowFilter: cfg.flowFilter || "any",
          timeFilter: cfg.timeFilter,
          state,
        });
      }
      const result = applyAggregation(allValues, cfg.aggregation);
      if (cfg.targetFieldId) {
        const target = cfg.targetValue != null
          ? { value: Number(cfg.targetValue), period: cfg.targetPeriod || "daily" }
          : null;
        updates.push({ fieldId: cfg.targetFieldId, value: result, target });
      }
      break;
    }

    case "INCREMENT_FIELD": {
      if (cfg.targetFieldId) {
        const amount = parseFloat(cfg.amount ?? 1);
        if (!isNaN(amount)) updates.push({ fieldId: cfg.targetFieldId, _increment: amount });
      }
      break;
    }

    case "MARK_COMPLETE": {
      if (cfg.completedFieldId) {
        updates.push({ fieldId: cfg.completedFieldId, value: cfg.markValue !== false });
      }
      break;
    }

    // Real CRUD effects — dispatched + emitted by bindSocketToStore after execution

    case "SET_FIELD_VALUE": {
      const occId = resolveExpr(cfg.occurrenceIdExpr || "$trigger.occurrenceId", $vars);
      // Distinguish "expression resolved to nothing" from "user wants to clear the field":
      //   valueExpr present + resolves to null/undefined + no `value` key → skip the write
      //   `value: null` set explicitly → write null (clears the field)
      let value;
      if (cfg.valueExpr !== undefined) {
        const resolved = resolveExpr(cfg.valueExpr, $vars);
        if ((resolved === null || resolved === undefined) && !("value" in cfg)) break;
        value = resolved !== null && resolved !== undefined ? resolved : cfg.value;
      } else {
        value = cfg.value;
      }
      if (occId && cfg.fieldId) {
        updates.push({ _effect: "SET_FIELD_VALUE", occurrenceId: occId, fieldId: cfg.fieldId, value, flow: cfg.flow || "replace" });
      }
      break;
    }

    case "MOVE_OCCURRENCE": {
      const occId = resolveExpr(cfg.occurrenceIdExpr || "$trigger.occurrenceId", $vars);
      const toContainerId = cfg.toContainerId || resolveExpr(cfg.toContainerIdExpr, $vars);
      if (occId && toContainerId) {
        updates.push({ _effect: "MOVE_OCCURRENCE", occurrenceId: occId, toContainerId });
      }
      break;
    }

    case "MOVE_OCCURRENCE_TO_PARENT": {
      const occId         = resolveExpr(cfg.occurrenceIdExpr, $vars);
      const toParentOccId = resolveExpr(cfg.toParentOccIdExpr, $vars);
      if (occId && toParentOccId) {
        updates.push({
          _effect: "MOVE_OCCURRENCE_TO_PARENT",
          occurrenceId: occId,
          toParentOccurrenceId: toParentOccId,
        });
      }
      break;
    }

    case "REMOVE_OCCURRENCE": {
      const occId = resolveExpr(cfg.occurrenceIdExpr || "$trigger.occurrenceId", $vars);
      if (occId) updates.push({ _effect: "REMOVE_OCCURRENCE", occurrenceId: occId });
      break;
    }

    case "CREATE_OCCURRENCE": {
      if (cfg.instanceId && cfg.containerId) {
        updates.push({ _effect: "CREATE_OCCURRENCE", instanceId: cfg.instanceId, containerId: cfg.containerId, fields: cfg.fields || {} });
      }
      break;
    }

    case "UPDATE_MODULE": {
      const modId = resolveExpr(cfg.moduleId || cfg.moduleIdExpr || "$trigger.moduleId", $vars);
      let patch = cfg.patch;
      if (!patch && cfg.patchJson) {
        try { patch = JSON.parse(cfg.patchJson); } catch { patch = null; }
      }
      if (modId && patch) updates.push({ _effect: "UPDATE_MODULE", moduleId: modId, patch });
      break;
    }

    // ---- DATE_DIFF: compute days until/since a date field, per occurrence or globally ----
    case "DATE_DIFF": {
      const { dateFieldId, targetFieldId, perOccurrence = true } = cfg;
      if (!dateFieldId || !targetFieldId) break;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (perOccurrence) {
        // Write daysUntilDue to each occurrence that has the date field set
        for (const occ of Object.values(occurrencesById)) {
          const fv = occ.fields?.[dateFieldId];
          if (!fv) continue;
          const dateVal = fv.value !== undefined ? fv.value : fv;
          if (!dateVal) continue;
          const dueDate = new Date(dateVal);
          if (isNaN(dueDate.getTime())) continue;
          dueDate.setHours(0, 0, 0, 0);
          const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
          updates.push({ fieldId: targetFieldId, occurrenceId: occ.id, value: diffDays });
        }
      } else {
        // Single value: closest upcoming due date (positive = future, negative = past)
        let minDiff = null;
        for (const occ of Object.values(occurrencesById)) {
          const fv = occ.fields?.[dateFieldId];
          if (!fv) continue;
          const dateVal = fv.value !== undefined ? fv.value : fv;
          if (!dateVal) continue;
          const dueDate = new Date(dateVal);
          if (isNaN(dueDate.getTime())) continue;
          dueDate.setHours(0, 0, 0, 0);
          const diffDays = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
          if (diffDays >= 0 && (minDiff === null || diffDays < minDiff)) minDiff = diffDays;
        }
        if (minDiff !== null) updates.push({ fieldId: targetFieldId, value: minDiff });
      }
      break;
    }

    // ---- COUNT_DATE_OVERDUE: count occurrences where date field < today ----
    case "COUNT_DATE_OVERDUE": {
      const { dateFieldId, targetFieldId } = cfg;
      if (!dateFieldId || !targetFieldId) break;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let count = 0;
      for (const occ of Object.values(occurrencesById)) {
        const fv = occ.fields?.[dateFieldId];
        if (!fv) continue;
        const dateVal = fv.value !== undefined ? fv.value : fv;
        if (!dateVal) continue;
        const d = new Date(dateVal);
        if (isNaN(d.getTime())) continue;
        d.setHours(0, 0, 0, 0);
        if (d < today) count++;
      }
      updates.push({ fieldId: targetFieldId, value: count });
      break;
    }

    // ---- COUNT_DATE_UPCOMING: count occurrences where date field is within N days ----
    case "COUNT_DATE_UPCOMING": {
      const { dateFieldId, targetFieldId, withinDays = 7 } = cfg;
      if (!dateFieldId || !targetFieldId) break;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      let count = 0;
      for (const occ of Object.values(occurrencesById)) {
        const fv = occ.fields?.[dateFieldId];
        if (!fv) continue;
        const dateVal = fv.value !== undefined ? fv.value : fv;
        if (!dateVal) continue;
        const d = new Date(dateVal);
        if (isNaN(d.getTime())) continue;
        d.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((d - today) / (1000 * 60 * 60 * 24));
        if (diffDays >= 0 && diffDays <= withinDays) count++;
      }
      updates.push({ fieldId: targetFieldId, value: count });
      break;
    }

    // ---- UPDATE_STYLE: patch ownStyle on a module ----
    // cfg: { moduleId?, moduleIdExpr?, style: { background?, color?, border?, fontSize?, ... } }
    // All style values can be resolveExpr expressions (e.g. "$item.color" or "literal:#ff0000").
    case "UPDATE_STYLE": {
      const modId = resolveExpr(cfg.moduleId || cfg.moduleIdExpr || "$trigger.moduleId", $vars);
      if (!modId || !cfg.style) break;
      const resolvedStyle = {};
      for (const [key, val] of Object.entries(cfg.style)) {
        resolvedStyle[key] = resolveExpr(val, $vars) ?? val;
      }
      updates.push({ _effect: "UPDATE_MODULE", moduleId: modId, patch: { ownStyle: resolvedStyle } });
      break;
    }

    case "DELETE_MODULE": {
      const modId = resolveExpr(cfg.moduleId || cfg.moduleIdExpr || "$trigger.moduleId", $vars);
      if (modId) updates.push({ _effect: "DELETE_MODULE", moduleId: modId });
      break;
    }

    // ---- APPEND_TO_DOC: append a paragraph to a doc container occurrence ----
    case "APPEND_TO_DOC": {
      const occId = resolveExpr(cfg.occurrenceId || cfg.occurrenceIdExpr, $vars);
      const occ = occurrencesById[occId];
      if (!occ?.textmap) break;
      const text = String(resolveExpr(cfg.content, $vars) ?? "");
      if (!text) break;
      const newParagraph = { type: "paragraph", content: [{ type: "text", text }] };
      const updated = { ...occ, textmap: { ...occ.textmap, content: [...(occ.textmap.content || []), newParagraph] } };
      updates.push({ _effect: "UPDATE_OCCURRENCE", occurrence: updated });
      break;
    }

    // ---- PREPEND_OCCURRENCE: create occurrence at position 0 of container ----
    case "PREPEND_OCCURRENCE": {
      const instanceId = resolveExpr(cfg.instanceId || cfg.instanceIdExpr, $vars);
      const containerId = resolveExpr(cfg.containerId || cfg.containerIdExpr, $vars);
      if (instanceId && containerId) {
        updates.push({ _effect: "CREATE_OCCURRENCE_AT", instanceId, containerId, position: 0, fields: cfg.fields || {} });
      }
      break;
    }

    // ---- APPLY_TEMPLATE: fill a container from a named/id'd template ----
    case "APPLY_TEMPLATE": {
      const containerId = resolveExpr(cfg.containerId || cfg.containerIdExpr, $vars);
      const templateId = resolveExpr(cfg.templateId || cfg.templateIdExpr, $vars)
        || (state?.grid?.templates ?? []).find(t => t.name === resolveExpr(cfg.templateName, $vars))?.id;
      if (containerId && templateId) {
        const iterationValue = resolveExpr(cfg.iterationValue ?? "$iterationValue", $vars);
        updates.push({ _effect: "APPLY_TEMPLATE", containerId, templateId, iterationValue });
      }
      break;
    }

    // ---- UPDATE_VIEW: update a view record (e.g. set activeOccurrenceId) ----
    // cfg: { viewId, viewIdExpr?, activeOccurrenceId?, patch? }
    case "UPDATE_VIEW": {
      const viewId = resolveExpr(cfg.viewId || cfg.viewIdExpr, $vars);
      const patch = { ...(cfg.patch || {}) };
      if (cfg.activeOccurrenceId !== undefined) {
        patch.activeOccurrenceId = resolveExpr(cfg.activeOccurrenceId, $vars);
      }
      if (viewId && Object.keys(patch).length > 0) {
        updates.push({ _effect: "UPDATE_VIEW", viewId, patch });
      }
      break;
    }

    // ---- SET_TEXTMAP: set or append to an occurrence's textmap (doc content) ----
    case "SET_TEXTMAP": {
      const occId = resolveExpr(cfg.occurrenceId || cfg.occurrenceIdExpr, $vars);
      const occ = occurrencesById[occId];
      if (!occ) break;
      const text = String(resolveExpr(cfg.content, $vars) ?? "");
      if (!text) break;
      const newNode = { type: cfg.nodeType || "paragraph", content: [{ type: "text", text }] };
      if (cfg.mode === "replace" || !occ.textmap) {
        updates.push({ _effect: "UPDATE_OCCURRENCE", occurrence: { ...occ, textmap: { type: "doc", content: [newNode] } } });
      } else {
        const position = cfg.position === "start" ? 0 : (occ.textmap.content || []).length;
        const newContent = [...(occ.textmap.content || [])];
        newContent.splice(position, 0, newNode);
        updates.push({ _effect: "UPDATE_OCCURRENCE", occurrence: { ...occ, textmap: { ...occ.textmap, content: newContent } } });
      }
      break;
    }

    // ---- RESET_RECURRING_TASK: reset completionField + advance dueDate by N days ----
    // cfg: { completionFieldId, dueDateFieldId, recurrenceDays, occurrenceIdExpr? }
    // Triggered via onComplete; reads dueDate from trigger occurrence, advances by recurrenceDays.
    case "RESET_RECURRING_TASK": {
      const occId = resolveExpr(cfg.occurrenceIdExpr || "$trigger.occurrenceId", $vars);
      const { completionFieldId, dueDateFieldId } = cfg;
      const recurrenceDays = Number(resolveExpr(cfg.recurrenceDaysExpr, $vars) ?? cfg.recurrenceDays ?? 0);
      if (!occId || !completionFieldId) break;

      // Reset the completion field to false
      updates.push({ _effect: "SET_FIELD_VALUE", occurrenceId: occId, fieldId: completionFieldId, value: false, flow: "replace" });

      // Advance dueDate if recurrenceDays > 0
      if (dueDateFieldId && recurrenceDays > 0) {
        const occ = occurrencesById[occId];
        const existingFv = occ?.fields?.[dueDateFieldId];
        const rawDate = existingFv?.value !== undefined ? existingFv.value : existingFv;
        const baseDate = rawDate && !isNaN(new Date(rawDate).getTime()) ? new Date(rawDate) : new Date();
        const newDate = new Date(baseDate);
        newDate.setDate(newDate.getDate() + recurrenceDays);
        updates.push({ _effect: "SET_FIELD_VALUE", occurrenceId: occId, fieldId: dueDateFieldId, value: newDate.toISOString(), flow: "replace" });
      }
      break;
    }

    // ---- CREATE_FOLDER: find/create folder by name under a parent ----
    // Idempotent: if folder with same name + parentId already exists, returns existing ID.
    // Sets $lastCreatedFolderId in $vars.
    // cfg: { name, parentId?, parentIdExpr?, folderType? }
    case "CREATE_FOLDER": {
      const name = resolveExpr(cfg.name, $vars) ?? cfg.name;
      const parentId = resolveExpr(cfg.parentId || cfg.parentIdExpr, $vars) ?? null;
      const folderType = cfg.folderType || "normal";
      if (!name) break;

      // Check if folder already exists in state (state.folders is an array)
      const allFolders = context.state?.folders || [];
      const existing = allFolders.find(f => f.name === name && f.parentId === parentId);
      if (existing) {
        $vars["$lastCreatedFolderId"] = existing.id;
        break;
      }

      // Generate ID and push effect to create
      const folderId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
      $vars["$lastCreatedFolderId"] = folderId;
      updates.push({ _effect: "CREATE_FOLDER", folderId, name, parentId, folderType });
      break;
    }

    // ---- HIDE_OCCURRENCE: hide an occurrence from rendering ----
    // Sets occurrence.hidden = true via server. Used in place of "untilDone" mode.
    // cfg: { occurrenceIdExpr? }  — defaults to $trigger.occurrenceId
    case "HIDE_OCCURRENCE": {
      const occId = resolveExpr(cfg.occurrenceIdExpr || "$trigger.occurrenceId", $vars);
      if (occId) updates.push({ _effect: "HIDE_OCCURRENCE", occurrenceId: occId });
      break;
    }

    // ---- SHOW_OCCURRENCE: reverse a HIDE_OCCURRENCE ----
    case "SHOW_OCCURRENCE": {
      const occId = resolveExpr(cfg.occurrenceIdExpr || "$trigger.occurrenceId", $vars);
      if (occId) updates.push({ _effect: "SHOW_OCCURRENCE", occurrenceId: occId });
      break;
    }

    // ---- ADD_TO_POOL: create a new instance + add to pool container ----
    // cfg: { poolId, label?, labelExpr? }
    case "ADD_TO_POOL": {
      const poolId = resolveExpr(cfg.poolId, $vars);
      const label = resolveExpr(cfg.labelExpr, $vars) ?? cfg.label ?? "New Item";
      if (poolId) {
        updates.push({ _effect: "ADD_TO_POOL", poolId, label });
      }
      break;
    }

    // ---- REMOVE_FROM_POOL: delete an occurrence from a pool container ----
    // cfg: { poolId, moduleIdExpr? }
    // Finds the specific pool occurrence (targetId === moduleId) within the pool container.
    // Only removes that one canonical pool occurrence — not schedule copies.
    case "REMOVE_FROM_POOL": {
      const moduleId = resolveExpr(cfg.moduleIdExpr || "$trigger.instanceId", $vars);
      const poolId = resolveExpr(cfg.poolId, $vars);
      if (moduleId && poolId) {
        updates.push({ _effect: "REMOVE_FROM_POOL", moduleId, poolId });
      }
      break;
    }

    // ---- DISPLAY_LOCAL_FIELDS: show evaluated rows on the operation node ----
    // cfg: { fields: [{ label, expr }] }
    // Returns _effect so callers (OpItem) can render them on the node card.
    case "DISPLAY_LOCAL_FIELDS": {
      const rows = (cfg.fields || []).map(f => ({
        label: f.label || f.expr || "",
        value: resolveExpr(f.expr, $vars),
      }));
      updates.push({ _effect: "DISPLAY_LOCAL_FIELDS", rows });
      break;
    }

    // ---- CYCLE_FIELD_VALUE: rotate through a select field's options by day-of-year ----
    // cfg: { sourceFieldId, targetFieldId, cycleBy: "dayOfYear" | "sequential" }
    // Picks options[dayOfYear % n].label and writes to targetFieldId as a SHOW_VALUE.
    case "CYCLE_FIELD_VALUE": {
      const sourceField = fieldsById?.[cfg.sourceFieldId];
      const options = sourceField?.meta?.options || [];
      if (options.length === 0) break;
      let idx = 0;
      if (cfg.cycleBy === "sequential") {
        // Sequential: idx based on a $counter var or just day-of-year fallback
        idx = Math.floor(Math.abs(resolveExpr(cfg.counterExpr || "$dayOfYear", $vars) || 0)) % options.length;
      } else {
        // Default: day-of-year
        const now = $vars?.["$today"] || $vars?.["$now"] ? new Date($vars["$today"] || $vars["$now"]) : new Date();
        const startOfYear = new Date(now.getFullYear(), 0, 0);
        const dayOfYear = Math.floor((now - startOfYear) / 86400000);
        idx = dayOfYear % options.length;
      }
      const chosen = options[idx];
      if (chosen && cfg.targetFieldId) {
        updates.push({ fieldId: cfg.targetFieldId, value: chosen.label ?? chosen.value ?? "" });
      }
      break;
    }

    // ---- FIND_MODULE: search $allModules by name, store result in $vars ----
    // cfg: { nameExpr, resultVar?, resultIdVar? }
    case "FIND_MODULE": {
      const name = resolveExpr(cfg.nameExpr, $vars);
      if (!name) break;
      const allModules = $vars.$allModules || {};
      const found = Object.values(allModules).find(m => m.name === name && !m.trashed)
        || Object.values(allModules).find(m => m.label === name && !m.trashed);
      $vars[cfg.resultVar || "$foundModule"] = found || null;
      $vars[cfg.resultIdVar || "$foundModuleId"] = found?.id || null;
      break;
    }

    // ---- FIND_OCCURRENCE: search by targetId, moduleLabel, or module meta key/value ----
    // cfg: { targetIdExpr?, moduleLabel?, moduleLabelExpr?,
    //        moduleMetaKey?, moduleMetaValue?, moduleMetaSecondaryKey?, moduleMetaSecondaryValue?,
    //        dateFieldId?, dateExpr?, resultVar?, resultIdVar? }
    // Skips template occurrences (meta.isTemplate === true).
    case "FIND_OCCURRENCE": {
      const targetId = resolveExpr(cfg.targetIdExpr, $vars);
      const moduleLabel = resolveExpr(cfg.moduleLabelExpr, $vars) || cfg.moduleLabel;
      const allOccurrences = $vars.$allOccurrences || occurrencesById || {};
      const allModules = $vars.$allModules || [];
      let found = null;

      // Pad bare YYYY-MM-DD strings so storage + lookup both parse to local-midnight.
      // Without this, "2026-04-25" parses as UTC on one side and local on the other,
      // so toDateString() mismatches across timezone boundaries → existing date-tagged
      // occurrences are never found and duplicates are created on every run.
      const toLocalDate = (val) => {
        if (val == null || val === "") return null;
        if (typeof val === "string" && val.length <= 10) return new Date(val + "T00:00:00");
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
      };

      let effectiveTargetIds = [];
      if (targetId) {
        effectiveTargetIds = [targetId];
      } else if (moduleLabel) {
        const mod = allModules.find(m => m.label?.toLowerCase() === moduleLabel.toLowerCase());
        if (mod) effectiveTargetIds = [mod.id];
      } else if (cfg.moduleMetaKey) {
        // Match modules by meta key/value (with optional secondary key/value). Both
        // values run through resolveExpr so callers can reference $vars.
        const metaValue = resolveExpr(cfg.moduleMetaValue, $vars);
        const metaSecondaryValue = cfg.moduleMetaSecondaryKey != null
          ? resolveExpr(cfg.moduleMetaSecondaryValue, $vars)
          : undefined;
        const matches = allModules.filter(m => {
          const v = m?.meta?.[cfg.moduleMetaKey];
          if (String(v) !== String(metaValue)) return false;
          if (cfg.moduleMetaSecondaryKey) {
            return String(m?.meta?.[cfg.moduleMetaSecondaryKey]) === String(metaSecondaryValue);
          }
          return true;
        });
        effectiveTargetIds = matches.map(m => m.id);
      }

      if (effectiveTargetIds.length > 0) {
        const occList = Array.isArray(allOccurrences) ? allOccurrences : Object.values(allOccurrences);
        const candidates = occList.filter(o =>
          effectiveTargetIds.includes(o.targetId) && !o.deleted && !o.meta?.isTemplate
        );

        if (cfg.dateFieldId) {
          const targetDateStr = resolveExpr(cfg.dateExpr, $vars) || resolveExpr("$today", $vars);
          const refDate = toLocalDate(targetDateStr);
          if (refDate) {
            found = candidates.find(o => {
              const fv = o.fields?.[cfg.dateFieldId];
              const val = fv?.value !== undefined ? fv.value : fv;
              const d = toLocalDate(val);
              return d && d.toDateString() === refDate.toDateString();
            }) || null;
          }
        } else {
          found = candidates[0] || null;
        }
      }
      $vars[cfg.resultVar || "$foundOccurrence"] = found || null;
      $vars[cfg.resultIdVar || "$foundOccurrenceId"] = found?.id || null;
      break;
    }

    // ---- CREATE_MODULE: create module + occurrence in one shot ----
    // cfg: { nameExpr, role?, kind?, parentIdExpr?, parentId?, viewIdExpr?, viewId?, extra? }
    // Sets $lastCreatedModuleId and $lastCreatedOccurrenceId in $vars.
    case "CREATE_MODULE": {
      const name = resolveExpr(cfg.nameExpr, $vars);
      if (!name) break;
      const role = cfg.role || "container";
      const kind = cfg.kind || "doc";
      const parentId = resolveExpr(cfg.parentIdExpr || cfg.parentId, $vars) || null;
      const viewId = resolveExpr(cfg.viewIdExpr || cfg.viewId, $vars) || null;
      const moduleId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
      const occurrenceId = globalThis.crypto?.randomUUID?.() ?? String(Date.now() + 1);
      $vars.$lastCreatedModuleId = moduleId;
      $vars.$lastCreatedOccurrenceId = occurrenceId;
      // Optimistic-publish into $vars.$allModules so subsequent FIND_MODULE calls in
      // the same pipeline run see the just-created module and don't duplicate.
      const newModuleStub = { id: moduleId, name, label: name, role, kind, ...(cfg.extra?.meta ? { meta: cfg.extra.meta } : {}) };
      if (Array.isArray($vars.$allModules)) {
        $vars.$allModules = [...$vars.$allModules, newModuleStub];
      }
      updates.push({
        _effect: "CREATE_MODULE",
        moduleId, occurrenceId, name, role, kind, parentId, viewId,
        ...(cfg.extra || {}),
      });
      break;
    }

    // ---- COMPUTE_TEXTMAP_FROM_TEMPLATE: clone template textmap + substitute [tokens] ----
    // Pure computation — no effect emitted. Stores substituted TipTap JSON in a $var.
    // cfg: { templateOccIdExpr, tokens: [{ token, valueExpr, value? }], resultVar? }
    case "COMPUTE_TEXTMAP_FROM_TEMPLATE": {
      const templateOccId = resolveExpr(cfg.templateOccIdExpr, $vars);
      const templateOcc = occurrencesById[templateOccId];
      if (!templateOcc?.textmap) break;

      const textmap = JSON.parse(JSON.stringify(templateOcc.textmap));
      const tokens = cfg.tokens || [];
      const substitute = (node) => {
        if (node.type === "text" && typeof node.text === "string") {
          for (const tkn of tokens) {
            const val = String(resolveExpr(tkn.valueExpr, $vars) ?? tkn.value ?? "");
            node.text = node.text.split(tkn.token).join(val);
          }
        }
        if (Array.isArray(node.content)) {
          for (const child of node.content) substitute(child);
        }
      };
      substitute(textmap);
      $vars[cfg.resultVar || "$computedTextmap"] = textmap;
      break;
    }

    // ---- CREATE_OCCURRENCE_FOR_MODULE: create a new occurrence for an existing module ----
    // Unlike CREATE_MODULE (creates both module + occurrence), this creates only an occurrence.
    // cfg: { moduleIdExpr, dateFieldId?, dateExpr?, textmapVar?, parentIdExpr?, parentId?,
    //        viewIdExpr?, viewId?, resultVar?, resultIdVar? }
    // Sets $lastCreatedOccurrenceId + cfg.resultIdVar in $vars.
    case "CREATE_OCCURRENCE_FOR_MODULE": {
      const moduleId = resolveExpr(cfg.moduleIdExpr || cfg.moduleId, $vars);
      if (!moduleId) break;

      const occurrenceId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
      $vars[cfg.resultVar || "$foundOccurrence"] = { id: occurrenceId };
      $vars[cfg.resultIdVar || "$lastCreatedOccurrenceId"] = occurrenceId;

      // Build initial fields
      const fields = {};
      if (cfg.dateFieldId) {
        // $activeDate may be null when no filter is active — fall back to $today
        const dateVal = resolveExpr(cfg.dateExpr, $vars) || resolveExpr("$today", $vars);
        if (dateVal) fields[cfg.dateFieldId] = { value: dateVal, flow: "in" };
      }

      // Optional pre-computed textmap from a $var (e.g. set by COMPUTE_TEXTMAP_FROM_TEMPLATE)
      const textmap = cfg.textmapVar ? ($vars[cfg.textmapVar] ?? null) : null;

      const parentIdResolved = resolveExpr(cfg.parentIdExpr || cfg.parentId, $vars) || null;
      const viewIdResolved = resolveExpr(cfg.viewIdExpr || cfg.viewId, $vars) || null;

      // Optimistic-publish the new occurrence into $vars so subsequent FIND_OCCURRENCE
      // calls in the same pipeline run see it (effects don't apply until after the
      // pipeline returns, but the slot loop → preset seed flow needs the just-created
      // slot occurrence to be visible immediately).
      const newOccStub = {
        id: occurrenceId,
        targetType: "module",
        targetId: moduleId,
        parentId: parentIdResolved,
        viewId: viewIdResolved,
        fields,
        textmap,
        meta: { createdByOperation: true },
      };
      if (Array.isArray($vars.$allOccurrences)) {
        $vars.$allOccurrences = [...$vars.$allOccurrences, newOccStub];
      }

      updates.push({
        _effect: "CREATE_OCCURRENCE_FOR_MODULE",
        occurrenceId,
        moduleId,
        parentId: parentIdResolved,
        viewId: viewIdResolved,
        fields,
        textmap,
        insertAtIndex: typeof cfg.insertAtIndex === "number" ? cfg.insertAtIndex : null,
      });
      break;
    }

    // ---- LINK_OCCURRENCE_TO_PARENT: idempotently add child to parent.occurrences[] ----
    // The container's date FIELD value is the source of truth for "does this exist for
    // the active date" — separate from where it lives in the page tree. FIND_OCCURRENCE
    // matches on date FIELD across all occurrences (orphans included); this action
    // re-links the matched orphan into the page so the renderer can see it.
    // cfg: { occurrenceIdExpr, parentOccIdExpr }
    case "LINK_OCCURRENCE_TO_PARENT": {
      const occurrenceId = resolveExpr(cfg.occurrenceIdExpr || cfg.occurrenceId, $vars);
      const parentOccurrenceId = resolveExpr(cfg.parentOccIdExpr || cfg.parentOccurrenceId, $vars);
      if (!occurrenceId || !parentOccurrenceId) break;

      // Optimistic-publish into $vars.$allOccurrences so subsequent steps see the link.
      if (Array.isArray($vars.$allOccurrences)) {
        $vars.$allOccurrences = $vars.$allOccurrences.map(o => {
          if (o.id !== parentOccurrenceId) return o;
          const childIds = Array.isArray(o.occurrences) ? o.occurrences : [];
          if (childIds.includes(occurrenceId)) return o;
          return { ...o, occurrences: [...childIds, occurrenceId] };
        });
      }

      updates.push({
        _effect: "LINK_OCCURRENCE_TO_PARENT",
        occurrenceId,
        parentOccurrenceId,
      });
      break;
    }

    // ---- FILL_FROM_TEMPLATE: apply substituted template textmap to an EXISTING occurrence ----
    // Use this to refresh an already-created page from the template (re-fill).
    // For NEW occurrences, use COMPUTE_TEXTMAP_FROM_TEMPLATE + CREATE_OCCURRENCE_FOR_MODULE instead.
    // cfg: { templateOccIdExpr, targetOccIdExpr, tokens: [{ token, valueExpr, value? }] }
    case "FILL_FROM_TEMPLATE": {
      const templateOccId = resolveExpr(cfg.templateOccIdExpr, $vars);
      const targetOccId = resolveExpr(cfg.targetOccIdExpr || cfg.occurrenceIdExpr, $vars);
      const templateOcc = occurrencesById[templateOccId];
      const targetOcc = occurrencesById[targetOccId];
      if (!templateOcc?.textmap || !targetOcc) break;

      const textmap = JSON.parse(JSON.stringify(templateOcc.textmap));
      const tokens = cfg.tokens || [];
      const substitute = (node) => {
        if (node.type === "text" && typeof node.text === "string") {
          for (const tkn of tokens) {
            const val = String(resolveExpr(tkn.valueExpr, $vars) ?? tkn.value ?? "");
            node.text = node.text.split(tkn.token).join(val);
          }
        }
        if (Array.isArray(node.content)) {
          for (const child of node.content) substitute(child);
        }
      };
      substitute(textmap);
      updates.push({ _effect: "UPDATE_OCCURRENCE", occurrence: { ...targetOcc, textmap } });
      break;
    }

    // ---- PICK_RANDOM_FROM_POOL: pick a random child from a pool container ----
    // cfg: { poolId, varName? }
    // Stores the picked module's label in $vars[varName] (default: "$pickedLabel").
    // Uses the pool container's occurrence.occurrences array for ordering.
    case "PICK_RANDOM_FROM_POOL": {
      const containerId = resolveExpr(cfg.poolId, $vars);
      const varName = cfg.varName || "$pickedLabel";
      if (!containerId) break;

      // Find the pool container's occurrence to get ordered child IDs
      const containerOcc = Object.values(occurrencesById).find(o => o.targetId === containerId);
      if (!containerOcc?.occurrences?.length) break;

      const childOccIds = containerOcc.occurrences;
      const randomIdx = Math.floor(Math.random() * childOccIds.length);
      const pickedOcc = occurrencesById[childOccIds[randomIdx]];
      if (!pickedOcc) break;

      // Prefer a specific field value if fieldId given; fall back to module label
      if (cfg.fieldId) {
        const fv = pickedOcc.fields?.[cfg.fieldId];
        $vars[varName] = fv?.value !== undefined ? fv.value : (fv ?? "");
      } else {
        const mod = (context.state?.modulesById || {})[pickedOcc.targetId];
        $vars[varName] = mod?.label ?? "";
      }
      break;
    }

    case "RUN_OPERATION": {
      if (cfg.operationId) {
        const subOp = operationsById[cfg.operationId];
        // Use injected executors to avoid circular imports
        const { executePipeline: _execPipeline, executeOperation: _execOp } = context._executors || {};
        if (subOp?.pipeline && _execPipeline) {
          updates.push(..._execPipeline(subOp, context, transaction, context._extraVars));
        } else if (subOp && _execOp) {
          updates.push(..._execOp(subOp, null, transaction, context));
        }
      }
      break;
    }

    case "SET_FILTER": {
      // Write a filter value to grid.activeFilterValues[fieldId].
      // cfg: { fieldId, valueExpr } — fieldId is the filter column; valueExpr resolves to a value.
      const fieldId = cfg.fieldId;
      const value = resolveExpr(cfg.valueExpr ?? cfg.value, $vars);
      if (fieldId && value != null) {
        updates.push({ _effect: "SET_FILTER", fieldId, value: String(value) });
      }
      break;
    }

    default:
      break;
  }

  return updates;
}
