// helpers/operationActions.js
// ============================================================
// Pure action helpers used by operationExecutor.js.
//
// Four CRUD verbs route every data write in the engine:
//   FIND    — locate items by predicate, store result in $vars
//   CREATE  — mint a template (idempotent on label) and an instance
//   UPDATE  — patch one piece of state at a path; routes through applyUpdate
//   DELETE  — remove an item
//
// Flow primitives (INIT_VAR, SET_VAR, ADD_TO_VAR, INCREMENT_VAR,
// DECREMENT_VAR, MULTIPLY_VAR, DIV_VAR, SUBTRACT_FROM_VAR, PUSH_TO_VAR)
// remain — they are read-modify-write math sugar on $vars, not CRUD.
//
// $item always refers to the current loop item / trigger payload.
// $allItems holds every item the operation can search; $allTemplates
// holds the template-level records (was $allModules).
//
// See plan: docs/superpowers/plans/2026-04-27-unified-operation-verbs.md
//
// Exports: resolveExpr, evalRule, evalGroup,
//          extractFieldValuesFiltered, executeActionItem
// ============================================================

import { applyAggregation, extractFieldValues } from "./CalculationHelpers";
import { applyUpdate, substituteTextmapTokens } from "./applyUpdate";
import { resolveOptions } from "./optionsResolver";
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
    // Coerce well-known scalar literals so UPDATE on boolean/number
    // fields round-trips correctly through the editor (literal:false → false).
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (raw === "null") return null;
    if (raw !== "" && !isNaN(Number(raw)) && /^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
    return raw;
  }

  // json:[...] / json:{...} — literal JSON value. Used by ExprOrPath array mode
  // to let users hand-write a list of items. Items inside the parsed JSON are
  // returned as-is (not recursively resolved against $vars).
  if (expr.startsWith("json:")) {
    try { return JSON.parse(expr.slice(5)); } catch { return null; }
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

// Recursively resolve every string leaf of an object/array through
// resolveExpr, leaving structure (and non-string scalars) intact. Used by
// the UPDATE action so an object-shaped value — e.g. a TipTap embed-cell
// doc `{ type:"doc", content:[{ type:"moduleEmbed", attrs:{ occurrenceId:
// "$c0" } }] }` — gets its `$var` leaves substituted. Literal strings pass
// through unchanged (resolveExpr returns non-`$`/non-prefixed strings as-is),
// so node `type`/`text` values are preserved.
export function deepResolveExpr(value, $vars) {
  if (typeof value === "string") return resolveExpr(value, $vars);
  if (Array.isArray(value)) return value.map(v => deepResolveExpr(v, $vars));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepResolveExpr(v, $vars);
    return out;
  }
  return value; // number / boolean / null / undefined — literal
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
    case "DATE_IN_PERIOD": {
      // Right shape can be:
      //   null/"" → wildcard (no filter set) → pass.
      //   "YYYY-MM-DD" → same-day match.
      //   { value: "YYYY-MM-DD", unit: "day"|"week"|"month"|"year", span?: N } →
      //     period match. `span > 1` is supported for unit:"day" only and
      //     widens the match to a rolling window of N days starting at value.
      if (rightVal == null || rightVal === "") return true;
      if (leftVal == null || leftVal === "") return false;
      const isObj = typeof rightVal === "object" && !Array.isArray(rightVal);
      const anchor = isObj ? rightVal.value : rightVal;
      const unit = isObj ? (rightVal.unit || "day") : "day";
      const spanRaw = isObj ? Number(rightVal.span) : 1;
      const span = Number.isFinite(spanRaw) && spanRaw > 1 ? Math.floor(spanRaw) : 1;
      if (anchor == null || anchor === "") return true;
      const dayKey = (v) => {
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
        const d = new Date(v);
        if (isNaN(d.getTime())) return null;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      };
      if (unit === "day") {
        const lk = dayKey(leftVal); const rk = dayKey(anchor);
        if (lk == null || rk == null) return false;
        if (span <= 1) return lk === rk;
        // Multi-day span: leftVal must fall in [rk, rk + span) by calendar day.
        const [ry, rm, rd] = rk.split("-").map(Number);
        const startMs = new Date(ry, rm - 1, rd).getTime();
        const [ly, lm, ld] = lk.split("-").map(Number);
        const leftMs = new Date(ly, lm - 1, ld).getTime();
        const dayMs = 24 * 60 * 60 * 1000;
        const diffDays = Math.round((leftMs - startMs) / dayMs);
        return diffDays >= 0 && diffDays < span;
      }
      const da = new Date(leftVal); const db = new Date(anchor);
      if (isNaN(da.getTime()) || isNaN(db.getTime())) return false;
      if (unit === "week") {
        const weekStart = (d) => {
          const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
          const dow = x.getDay();
          const offset = dow === 0 ? -6 : 1 - dow;
          x.setDate(x.getDate() + offset);
          return x.getTime();
        };
        return weekStart(da) === weekStart(db);
      }
      if (unit === "month") {
        return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth();
      }
      if (unit === "year") {
        return da.getFullYear() === db.getFullYear();
      }
      return false;
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

// ----- Record-path predicate evaluation (used by FIND) -----------------------
// FIND iterates a collection internally; each rule's `left` is a dotted path
// on the current record (`label`, `fields.<fid>.value`, `_ancestors`). The
// right side is still a regular expression resolved against $vars.

export function resolveRecordPath(record, path) {
  if (record == null || !path) return null;
  // Tolerate legacy `$item.X` predicates from seed data — the editor writes
  // bare record paths (`label`, `fields.X.value`) going forward, but DB rows
  // saved under the old FIND-inside-loop pattern still carry `$item.` prefixes.
  // Stripping it here means we never need to touch existing data.
  const normalized = path.startsWith("$item.") ? path.slice(6) : path;
  const parts = String(normalized).split(".");
  let cur = record;
  for (const seg of parts) {
    if (cur == null) return null;
    cur = cur[seg];
  }
  return cur ?? null;
}

export function evalRuleAgainstRecord(rule, record, $vars) {
  // Reuse the comparator switch by feeding evalRule a synthetic rule whose
  // `left` is a literal already-resolved value. The simplest way is to bind
  // a temporary $-var and rewrite the rule to reference it.
  const leftVal = resolveRecordPath(record, rule.left);
  // Use a unique key per call so concurrent evaluations don't clobber each
  // other (evalRule reads $vars synchronously so this is fine).
  const key = "$__find_left__";
  const prev = $vars[key];
  $vars[key] = leftVal;
  try {
    return evalRule({ ...rule, left: key }, $vars);
  } finally {
    $vars[key] = prev;
  }
}

export function evalGroupAgainstRecord(group, record, $vars) {
  const { operator = "AND", rules = [] } = group;
  if (rules.length === 0) return true;
  const evaluate = (entry) => {
    if (Array.isArray(entry?.rules)) return evalGroupAgainstRecord(entry, record, $vars);
    return evalRuleAgainstRecord(entry, record, $vars);
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
  const { state, fieldsById = {}, occurrencesById = {}, operationsById = {}, modulesById = {}, foldersById = {} } = context;
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
    case "PUSH_TO_ARRAY": {
      // Push an object row (or primitive) onto an array variable.
      // cfg: { name: string, value: object | any }
      // When cfg.value is a plain object, each leaf value is resolved via resolveExpr
      // so you can write: { label: "$book.label", pages: "$book.fields.<id>.value" }
      const arrName = cfg.name;
      if (!arrName) break;
      if (!Array.isArray($vars[arrName])) $vars[arrName] = [];
      if (cfg.value !== null && typeof cfg.value === "object" && !Array.isArray(cfg.value)) {
        const resolved = {};
        for (const [k, v] of Object.entries(cfg.value)) {
          resolved[k] = resolveExpr(v, $vars);
        }
        $vars[arrName] = [...$vars[arrName], resolved];
      } else {
        const pv = resolveExpr(cfg.value, $vars);
        $vars[arrName] = [...$vars[arrName], pv];
      }
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

    // ============================================================
    // Four CRUD verbs: FIND, CREATE, UPDATE, DELETE
    // ============================================================

    // ---- FIND: locate items by predicate ----
    // cfg: { over, predicate, multiple?: false, itemVar?, itemIdVar? }
    //
    // FIND owns its own iteration. `cfg.over` names a collection ($allOccurrences,
    // $allTemplates, $allFields, etc.). For each record in that collection, the
    // predicate is evaluated with `rule.left` interpreted as a record sub-path
    // (`label`, `fields.<fid>.value`, `_ancestors`) and `rule.right` resolved as
    // a regular expression against $vars. There is no `$item` namespace —
    // record-key paths are bare, and the editor's left-picker drills the
    // collection's record shape directly.
    case "FIND": {
      const overExpr = cfg.over || "$allOccurrences";
      const itemList = Array.isArray(resolveExpr(overExpr, $vars))
        ? resolveExpr(overExpr, $vars)
        : [];

      const predicate = cfg.predicate;
      const matchItem = (record) => {
        if (!predicate || !Array.isArray(predicate.rules) || predicate.rules.length === 0) return true;
        return evalGroupAgainstRecord(predicate, record, $vars);
      };

      const candidates = itemList
        .filter(it => it && !it.deleted && !it.meta?.isTemplate)
        .filter(matchItem);

      const result = cfg.multiple ? candidates : (candidates[0] || null);
      if (cfg.itemVar) $vars[cfg.itemVar] = result;
      if (cfg.itemIdVar) {
        $vars[cfg.itemIdVar] = cfg.multiple
          ? candidates.map(c => c.id)
          : (result?.id ?? null);
      }
      break;
    }

    // ---- CREATE: mint template (idempotent on label) + instance ----
    // cfg: { name, role?, kind?, meta?, parent?, date?: { fieldId, value },
    //        fields?, textmap?, insertAtIndex?, itemIdVar?, itemVar? }
    case "CREATE": {
      const name = resolveExpr(cfg.name, $vars) ?? cfg.name;
      if (!name) break;

      // Resolve $var references inside meta values so authors can write
      // `meta: { slotLabel: "$slot.label" }` and have it land as the
      // resolved string on the template.
      const resolvedMeta = cfg.meta && typeof cfg.meta === "object"
        ? Object.fromEntries(
            Object.entries(cfg.meta).map(([k, v]) => [k, resolveExpr(v, $vars) ?? v])
          )
        : null;

      const templateList = Array.isArray($vars.$allTemplates) ? $vars.$allTemplates : [];
      const existingTemplate = templateList.find(t => t && !t.trashed && (t.label === name || t.name === name));

      // Attach fields: every fieldId addressed by cfg.fields is auto-bound to
      // the module, plus anything in cfg.attachFields (explicit attach without
      // a value). Newly-minted templates get them in fieldBindings up front;
      // pre-existing templates get them merged via UPDATE_MODULE so date-
      // stamping ops can guarantee the field renders without the user
      // manually binding it first.
      const fieldsMapIds = cfg.fields && typeof cfg.fields === "object"
        ? Object.keys(cfg.fields).filter(Boolean)
        : [];
      const attachFieldIds = Array.from(new Set([
        ...(Array.isArray(cfg.attachFields) ? cfg.attachFields.filter(Boolean) : []),
        ...fieldsMapIds,
      ]));
      const hiddenMap = (cfg.fieldHidden && typeof cfg.fieldHidden === "object")
        ? cfg.fieldHidden
        : {};
      const buildBindings = (existing = []) => {
        const out = [...existing];
        for (const fid of attachFieldIds) {
          const idx = out.findIndex(b => b?.fieldId === fid);
          const explicit = Object.prototype.hasOwnProperty.call(hiddenMap, fid);
          const hidden = !!hiddenMap[fid];
          if (idx === -1) {
            out.push({ fieldId: fid, role: "input", order: out.length, ...(hidden ? { hidden: true } : {}) });
          } else if (explicit && (!!out[idx].hidden) !== hidden) {
            out[idx] = { ...out[idx], hidden: hidden ? true : undefined };
          }
        }
        return out;
      };

      let templateRecord = null;
      let templateId;
      if (existingTemplate) {
        templateId = existingTemplate.id;
        if (attachFieldIds.length) {
          const nextBindings = buildBindings(existingTemplate.fieldBindings || []);
          if (nextBindings.length !== (existingTemplate.fieldBindings || []).length) {
            updates.push({
              _effect: "UPDATE_MODULE",
              moduleId: templateId,
              patch: { fieldBindings: nextBindings },
            });
            existingTemplate.fieldBindings = nextBindings;
          }
        }
      } else {
        templateId = globalThis.crypto?.randomUUID?.() ?? String(Date.now());
        templateRecord = {
          id: templateId,
          name,
          label: name,
          role: cfg.role || "container",
          kind: cfg.kind || "doc",
          ...(resolvedMeta ? { meta: resolvedMeta } : {}),
          ...(attachFieldIds.length ? { fieldBindings: buildBindings() } : {}),
        };
        // Optimistic publish so subsequent FIND in same pipeline sees it
        if (Array.isArray($vars.$allTemplates)) {
          $vars.$allTemplates = [...$vars.$allTemplates, templateRecord];
        }
      }

      const instanceId = globalThis.crypto?.randomUUID?.() ?? String(Date.now() + 1);

      // Initial fields: cfg.fields map only. Date-typed writes are validated
      // against the field's type — if a resolveExpr leak produces a literal
      // string like "date" (the field name), the executor falls back to
      // $today instead of stamping the literal value (B20). No special-case
      // cfg.date branch — date is just another field, identified by its
      // field type via fieldsById.
      const isDateValue = (v) => {
        if (v == null) return false;
        if (v instanceof Date) return !isNaN(v.getTime());
        if (typeof v !== "string") return false;
        if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return false;
        return !isNaN(new Date(v).getTime());
      };
      const fields = {};
      if (cfg.fields) {
        for (const [fid, expr] of Object.entries(cfg.fields)) {
          const v = resolveExpr(expr, $vars);
          if (v == null) continue;
          const ftype = fieldsById?.[fid]?.type;
          if (ftype === "date" && !isDateValue(v)) {
            // Literal-string leak (e.g. resolveExpr returned "date" because
            // the user typed the field name as a value). Fall back to $today
            // rather than write a non-date string into a date field.
            const fallback = resolveExpr("$today", $vars);
            if (fallback) fields[fid] = { value: fallback, flow: "in" };
            continue;
          }
          fields[fid] = { value: v, flow: "in" };
        }
      }

      // Resolve textmap (with optional fromTemplate substitution)
      let textmap = null;
      if (cfg.textmap) {
        if (typeof cfg.textmap === "object" && cfg.textmap.fromTemplate !== undefined) {
          const tokens = {};
          for (const [k, v] of Object.entries(cfg.textmap.tokens || {})) {
            tokens[k] = resolveExpr(v, $vars);
          }
          const updateRes = applyUpdate(
            "$item.textmap",
            { fromTemplate: resolveExpr(cfg.textmap.fromTemplate, $vars), tokens },
            { vars: { $item: { id: instanceId } }, occurrencesById }
          );
          textmap = updateRes.effects?.[0]?.textmap ?? null;
        } else {
          textmap = cfg.textmap;
        }
      }

      const parentId = resolveExpr(cfg.parent, $vars) ?? null;

      // Compute the ancestor chain for the NEW instance from its parentId,
      // walking the existing parent chain in context.occurrencesById. Without
      // this, $allItems entries for just-CREATEd items have empty _ancestors,
      // so a same-pipeline FIND with `_ancestors HAS_ANCESTOR <pageId>` fails
      // to match them — the dedup check that's supposed to prevent re-creates
      // silently misses the new row. parentByChildId is rebuilt only at the
      // top of executePipeline, so we have to derive ancestors directly here.
      const newAncestors = [];
      if (parentId && context.occurrencesById) {
        const seen = new Set();
        let cur = parentId;
        let depth = 0;
        while (cur && !seen.has(cur) && depth++ < 12) {
          seen.add(cur);
          newAncestors.push(cur);
          const parentOcc = context.occurrencesById[cur];
          // Prefer the parent-by-child reverse map (from .occurrences[]); fall
          // back to .parentId. Mirrors executePipeline's ancestorsFor.
          let next = null;
          if (context._parentByChildId) next = context._parentByChildId[cur];
          if (!next && parentOcc) next = parentOcc.parentId || null;
          cur = next;
        }
      }

      const instance = {
        id: instanceId,
        moduleId: templateId,
        parentId,
        fields,
        textmap,
        meta: { createdByOperation: true },
        _ancestors: newAncestors,
      };

      // Optimistic publish into the built-in collections so subsequent FIND
      // steps in the same pipeline see the new instance. $allItems and
      // $allOccurrences are runtime aliases — keep them in sync. The role-
      // filtered slices ($allContainers/$allPages/$allInstances) get the new
      // instance too if its role matches.
      if (Array.isArray($vars.$allItems)) {
        $vars.$allItems = [...$vars.$allItems, instance];
      }
      if (Array.isArray($vars.$allOccurrences)) {
        $vars.$allOccurrences = [...$vars.$allOccurrences, instance];
      }
      const newRole = cfg.role || "container";
      if (newRole === "container" && Array.isArray($vars.$allContainers)) {
        $vars.$allContainers = [...$vars.$allContainers, instance];
      } else if (newRole === "panel" && Array.isArray($vars.$allPanels)) {
        $vars.$allPanels = [...$vars.$allPanels, instance];
      } else if (newRole === "page" && Array.isArray($vars.$allPages)) {
        $vars.$allPages = [...$vars.$allPages, instance];
      } else if (newRole === "instance" && Array.isArray($vars.$allInstances)) {
        $vars.$allInstances = [...$vars.$allInstances, instance];
      }

      // Also patch the context's occurrencesById overlay so nested RUN_OPERATION
      // callees — which build their own fresh $vars from `context.occurrencesById`
      // — see the just-created instance. Without this, an op that CREATEs an
      // item then RUN_OPERATIONs into a child op causes the child's FIND
      // idempotency checks to miss the new item and re-CREATE it on every
      // recursion level (capped at 4 → up to 4 dupes per call chain). The
      // overlay is the in-batch `liveOccs` from runMatchingOperations; mutating
      // it is its intended use.
      if (context.occurrencesById && typeof context.occurrencesById === "object") {
        context.occurrencesById[instanceId] = {
          id: instanceId,
          moduleId: templateId,
          parentId,
          fields,
          textmap,
          meta: { createdByOperation: true },
          occurrences: [],
        };
        // Append the new instance to the parent's occurrences[] in the overlay
        // so the next executePipeline rebuild of parentByChildId picks up the
        // linkage. Without this, recursive RUN_OPERATION chains (e.g. tracker
        // → seed → tracker) compute empty _ancestors for the new rows, fail
        // their HAS_ANCESTOR dedup, and re-CREATE the same items at every
        // recursion level — the schedule duplicates a user sees on completion
        // / drag-to-schedule. Spread the parent so we don't mutate the cached
        // localOccsById entry; the overlay is per-call.
        if (parentId && context.occurrencesById[parentId]) {
          const parent = context.occurrencesById[parentId];
          if (!(parent.occurrences || []).includes(instanceId)) {
            context.occurrencesById[parentId] = {
              ...parent,
              occurrences: [...(parent.occurrences || []), instanceId],
            };
          }
        }
        // Keep the parent-by-child reverse map in sync if the executor passed
        // one in. Same reason as above — recursive callees rebuild ancestors
        // from parentByChildId; if it's stale, HAS_ANCESTOR misses.
        if (context._parentByChildId && parentId) {
          context._parentByChildId[instanceId] = parentId;
        }
        // Mint the new template into context.state.modules too, so the next
        // CREATE's existingTemplate lookup finds it instead of minting yet
        // another fresh module with a different id.
        if (templateRecord && context.state && Array.isArray(context.state.modules)) {
          context.state.modules = [...context.state.modules, templateRecord];
        }
      }

      if (cfg.itemIdVar) $vars[cfg.itemIdVar] = instanceId;
      if (cfg.itemVar) $vars[cfg.itemVar] = instance;

      updates.push({
        _effect: "CREATE_ITEM",
        template: templateRecord,
        instance: {
          id: instanceId,
          templateId,
          parentId,
          fields,
          textmap,
          insertAtIndex: typeof cfg.insertAtIndex === "number" ? cfg.insertAtIndex : null,
        },
      });
      break;
    }

    // ---- COPY_LINK: mint a new occurrence sharing module + linkedGroupId ----
    // cfg: { sourceId, parent?, insertAtIndex?, fields?, copyFields? (default
    //        true), linkedGroupVar?, itemIdVar?, itemVar? }
    //
    // Distinct from CREATE (mints a fresh template + independent occurrence)
    // and from a deep copy (would mint a new module). The copy and the source
    // share both `moduleId` and `linkedGroupId`. The server's update_occurrence
    // handler (server/socketHandlers/occurrences.js:91-124) propagates field +
    // textmap writes bidirectionally across all occurrences sharing a
    // linkedGroupId, so completing one marks the source AND every other copy.
    //
    // If the source has no linkedGroupId yet, we mint one and emit an
    // UPDATE_OCCURRENCE for the source so the next field write on either
    // side triggers the linked-group fan-out at occurrences.js:92.
    //
    // RECURSION (added 2026-05-15): when the source has children, each child
    // is recursively COPY_LINKed too — pairwise, so source.occurrences[i] is
    // linked to copy.occurrences[i] via its own per-child linkedGroupId.
    // Server propagates fields/textmap across each pair independently. This
    // means structural copies of a doc/container subtree stay in sync at every
    // level (mark a sub-textblock done in one copy → ticks in all copies).
    // cfg.fields applies ONLY to the root clone; recursing into children with
    // the same stamp would overwrite their own per-child field values. Same
    // for cfg.itemIdVar / cfg.itemVar / cfg.linkedGroupVar / cfg.parent /
    // cfg.insertAtIndex — root only.
    case "COPY_LINK": {
      const sourceId = resolveExpr(cfg.sourceId, $vars);
      if (!sourceId) break;

      // Migration mode: when cfg.targetId points at an existing occurrence,
      // we just LINK the two via shared linkedGroupId — no new occurrence is
      // created. Used when an un-linked sibling exists from before COPY_LINK
      // was rolled out (or a pre-COPY_LINK seed run); subsequent Build Day
      // sweeps detect it via the existing-copy FIND and call back here with
      // targetId set to retroactively join them. Server's update_occurrence
      // linked-group fan-out (occurrences.js:91) then propagates writes
      // bidirectionally as if the copy had been COPY_LINKed from the start.
      // Shallow only — children of the target aren't pairwise-walked here
      // (use a fresh COPY_LINK to get recursive linking on freshly-cloned
      // subtrees). Acceptable for the canonical migration case (leaf todo
      // already swept into Due as a leaf copy).
      const migrationTargetId = resolveExpr(cfg.targetId, $vars);
      if (migrationTargetId) {
        const findOcc = (id) =>
          (context.occurrencesById && context.occurrencesById[id])
          || (Array.isArray($vars.$allItems) && $vars.$allItems.find(o => o?.id === id))
          || (Array.isArray($vars.$allOccurrences) && $vars.$allOccurrences.find(o => o?.id === id))
          || null;
        const src = findOcc(sourceId);
        const tgt = findOcc(migrationTargetId);
        if (!src || !tgt) break;

        let linkedGroupId = src.linkedGroupId || tgt.linkedGroupId || null;
        const sourceNeedsUpdate = !src.linkedGroupId || src.linkedGroupId !== linkedGroupId;
        const targetNeedsUpdate = !tgt.linkedGroupId || tgt.linkedGroupId !== linkedGroupId;
        if (!linkedGroupId) {
          // Deterministic — same derivation as the fresh-clone path so a
          // migration link and a fresh COPY_LINK of the same source converge
          // on one group id (see the long note in the fresh path below).
          linkedGroupId = `lg-${src.id}`;
        }

        // Mirror onto in-pipeline overlay so subsequent steps + later sweeps
        // in the same pipeline see the freshly-linked state.
        if (context.occurrencesById?.[sourceId]) {
          context.occurrencesById[sourceId] = { ...context.occurrencesById[sourceId], linkedGroupId };
        }
        if (context.occurrencesById?.[migrationTargetId]) {
          context.occurrencesById[migrationTargetId] = { ...context.occurrencesById[migrationTargetId], linkedGroupId };
        }
        if (Array.isArray($vars.$allItems)) {
          $vars.$allItems = $vars.$allItems.map(o =>
            o && (o.id === sourceId || o.id === migrationTargetId) ? { ...o, linkedGroupId } : o
          );
        }
        if (Array.isArray($vars.$allOccurrences)) {
          $vars.$allOccurrences = $vars.$allOccurrences.map(o =>
            o && (o.id === sourceId || o.id === migrationTargetId) ? { ...o, linkedGroupId } : o
          );
        }

        if (sourceNeedsUpdate) {
          updates.push({ _effect: "UPDATE_OCCURRENCE", occurrence: { id: sourceId, linkedGroupId } });
        }
        if (targetNeedsUpdate) {
          updates.push({ _effect: "UPDATE_OCCURRENCE", occurrence: { id: migrationTargetId, linkedGroupId } });
        }

        if (cfg.linkedGroupVar) $vars[cfg.linkedGroupVar] = linkedGroupId;
        if (cfg.itemIdVar) $vars[cfg.itemIdVar] = migrationTargetId;
        break;
      }

      // Date-typed value validation, identical to CREATE (B20 fix).
      const isDateValue = (v) => {
        if (v == null) return false;
        if (v instanceof Date) return !isNaN(v.getTime());
        if (typeof v !== "string") return false;
        if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return false;
        return !isNaN(new Date(v).getTime());
      };

      // Source can be in either context.occurrencesById (live overlay,
      // includes same-pipeline CREATEs) or $vars.$allItems (executor's
      // enriched snapshot built once at executePipeline start). Prefer the
      // overlay since it sees in-flight mutations.
      const findSource = (id) =>
        (context.occurrencesById && context.occurrencesById[id])
        || (Array.isArray($vars.$allItems) && $vars.$allItems.find(o => o?.id === id))
        || (Array.isArray($vars.$allOccurrences) && $vars.$allOccurrences.find(o => o?.id === id))
        || null;

      // Recursive helper. Mints a new link-id per source occurrence (reuses
      // existing where present), recurses into children, and emits the
      // CREATE_ITEM with the children's ids inlined so the parent is
      // created with its `occurrences[]` set in one shot (avoids the
      // bindSocketToStore parent.occurrences[] race — same pattern as
      // APPLY_TEMPLATE clone). seen + depth cap protect against any cycle
      // a malformed source subtree could introduce.
      const seen = new Set();
      const linkOne = (src, targetParentId, isRoot, depth) => {
        if (!src || seen.has(src.id) || depth > 24) return null;
        seen.add(src.id);
        const srcMod = src.moduleId || src.templateId;
        if (!srcMod) return null;

        // Reuse or mint linkedGroupId for THIS source occurrence. mintedNewLink
        // gates the source UPDATE_OCCURRENCE patch (no-op when re-linking).
        // The minted id is DETERMINISTIC (`lg-<sourceOccId>`), not random:
        // Build Day fires several times per load (onLoad + the filter-bootstrap
        // onFilterChange), and across separate op runs in one batch the
        // source's freshly-minted link isn't always visible in the frozen
        // snapshot. A random id would diverge — source ends up in one group,
        // the swept copy (or a duplicate copy) in another — and the server's
        // linkedGroupId fan-out never matches, so completing one never ticks
        // the other. Deriving the id from the stable source occ id makes every
        // COPY_LINK of the same source converge on one group, idempotently.
        let linkedGroupId = src.linkedGroupId || null;
        let mintedNewLink = false;
        if (!linkedGroupId) {
          linkedGroupId = `lg-${src.id}`;
          mintedNewLink = true;
          if (context.occurrencesById && context.occurrencesById[src.id]) {
            context.occurrencesById[src.id] = { ...context.occurrencesById[src.id], linkedGroupId };
          }
          if (Array.isArray($vars.$allItems)) {
            $vars.$allItems = $vars.$allItems.map(o => (o && o.id === src.id ? { ...o, linkedGroupId } : o));
          }
          if (Array.isArray($vars.$allOccurrences)) {
            $vars.$allOccurrences = $vars.$allOccurrences.map(o => (o && o.id === src.id ? { ...o, linkedGroupId } : o));
          }
        }

        // Initial fields: optional copy from source. cfg.fields applies to
        // ROOT only (recursing it into children would clobber per-child
        // values — typical caller intent is "stamp date on the root copy").
        const fields = cfg.copyFields !== false ? { ...(src.fields || {}) } : {};
        if (isRoot && cfg.fields && typeof cfg.fields === "object") {
          for (const [fid, expr] of Object.entries(cfg.fields)) {
            const v = resolveExpr(expr, $vars);
            if (v == null) continue;
            const ftype = fieldsById?.[fid]?.type;
            if (ftype === "date" && !isDateValue(v)) {
              const fallback = resolveExpr("$today", $vars);
              if (fallback) fields[fid] = { value: fallback, flow: "in" };
              continue;
            }
            fields[fid] = { value: v, flow: "in" };
          }
        }

        const newId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

        // Recurse into children FIRST so we can inline their ids into our
        // CREATE_ITEM emit. Each child's own linkedGroupId pairs that child
        // with src.occurrences[i] independently.
        const childIds = [];
        for (const childOccId of (src.occurrences || [])) {
          const childSrc = findSource(childOccId);
          if (!childSrc) continue;
          const childResult = linkOne(childSrc, newId, false, depth + 1);
          if (childResult?.newId) childIds.push(childResult.newId);
        }

        // _ancestors walk — chain logic identical to CREATE.
        const newAncestors = [];
        if (targetParentId && context.occurrencesById) {
          const ancSeen = new Set();
          let cur = targetParentId;
          let walkDepth = 0;
          while (cur && !ancSeen.has(cur) && walkDepth++ < 12) {
            ancSeen.add(cur);
            newAncestors.push(cur);
            const parentOcc = context.occurrencesById[cur];
            let next = null;
            if (context._parentByChildId) next = context._parentByChildId[cur];
            if (!next && parentOcc) next = parentOcc.parentId || null;
            cur = next;
          }
        }

        const tpl = Array.isArray($vars.$allTemplates)
          ? $vars.$allTemplates.find(t => t && t.id === srcMod)
          : null;
        const role = tpl?.role || src.role || "instance";
        const label = src.label ?? tpl?.label ?? tpl?.name ?? null;

        const stub = {
          id: newId,
          moduleId: srcMod,
          parentId: targetParentId,
          fields,
          linkedGroupId,
          role,
          label,
          meta: { createdByOperation: true, copyLinkSource: src.id },
          _ancestors: newAncestors,
          occurrences: childIds,
        };

        // Optimistic publish so subsequent same-pipeline FINDs see the clone.
        if (Array.isArray($vars.$allItems)) $vars.$allItems = [...$vars.$allItems, stub];
        if (Array.isArray($vars.$allOccurrences)) $vars.$allOccurrences = [...$vars.$allOccurrences, stub];
        if (role === "instance" && Array.isArray($vars.$allInstances)) $vars.$allInstances = [...$vars.$allInstances, stub];
        else if (role === "container" && Array.isArray($vars.$allContainers)) $vars.$allContainers = [...$vars.$allContainers, stub];
        else if (role === "page" && Array.isArray($vars.$allPages)) $vars.$allPages = [...$vars.$allPages, stub];
        else if (role === "panel" && Array.isArray($vars.$allPanels)) $vars.$allPanels = [...$vars.$allPanels, stub];

        if (context.occurrencesById && typeof context.occurrencesById === "object") {
          context.occurrencesById[newId] = {
            id: newId,
            moduleId: srcMod,
            parentId: targetParentId,
            fields,
            linkedGroupId,
            meta: { createdByOperation: true, copyLinkSource: src.id },
            occurrences: childIds,
          };
          if (targetParentId && context.occurrencesById[targetParentId]) {
            const parent = context.occurrencesById[targetParentId];
            if (!(parent.occurrences || []).includes(newId)) {
              context.occurrencesById[targetParentId] = {
                ...parent,
                occurrences: [...(parent.occurrences || []), newId],
              };
            }
          }
          if (context._parentByChildId && targetParentId) {
            context._parentByChildId[newId] = targetParentId;
          }
        }

        // CREATE_ITEM with template:null (reusing source's module) +
        // linkedGroupId on the instance. occurrences[] inlined so the parent
        // is created with its child list — bindSocketToStore.CREATE_ITEM
        // honors `inst.occurrences` (May 13 templates v2 wiring).
        updates.push({
          _effect: "CREATE_ITEM",
          template: null,
          instance: {
            id: newId,
            templateId: srcMod,
            parentId: targetParentId,
            fields,
            linkedGroupId,
            occurrences: childIds,
            ...(isRoot && typeof cfg.insertAtIndex === "number" ? { insertAtIndex: cfg.insertAtIndex } : {}),
          },
        });

        // If we minted a new linkedGroupId on this source, persist it onto
        // the SOURCE so the server's update_occurrence handler reads it on
        // the next write and fans out to every occurrence in the group.
        if (mintedNewLink) {
          updates.push({
            _effect: "UPDATE_OCCURRENCE",
            occurrence: { id: src.id, linkedGroupId },
          });
        }

        return { newId, linkedGroupId };
      };

      const root = findSource(sourceId);
      if (!root || !(root.moduleId || root.templateId)) break;
      const rootParentId = resolveExpr(cfg.parent, $vars) ?? null;
      const result = linkOne(root, rootParentId, true, 0);
      if (!result) break;

      if (cfg.itemIdVar) $vars[cfg.itemIdVar] = result.newId;
      if (cfg.itemVar) {
        $vars[cfg.itemVar] = (context.occurrencesById && context.occurrencesById[result.newId]) || null;
      }
      if (cfg.linkedGroupVar) $vars[cfg.linkedGroupVar] = result.linkedGroupId;

      break;
    }

    // ---- UPDATE: route writes by path through applyUpdate ----
    // cfg: { path, value }
    // path supports `${$varName}` interpolation so authors can address per-item
    // display keys: `$display.<fieldId>.${$goalId}`.
    case "UPDATE": {
      if (!cfg.path) break;
      const path = typeof cfg.path === "string" && cfg.path.includes("${")
        ? cfg.path.replace(/\$\{([^}]+)\}/g, (_, inner) => {
            const resolved = resolveExpr(inner.trim(), $vars);
            return resolved != null ? String(resolved) : "";
          })
        : cfg.path;
      let value;
      // Object-shaped value (e.g. textmap fromTemplate). Resolve nested exprs.
      if (cfg.value !== null && typeof cfg.value === "object" && !Array.isArray(cfg.value) && cfg.value.fromTemplate !== undefined) {
        const tokens = {};
        for (const [k, v] of Object.entries(cfg.value.tokens || {})) {
          tokens[k] = resolveExpr(v, $vars);
        }
        value = {
          fromTemplate: resolveExpr(cfg.value.fromTemplate, $vars),
          tokens,
        };
      } else if (cfg.value !== null && typeof cfg.value === "object") {
        // Object OR array value (e.g. embed-cell doc JSON, table column-def
        // array). Deep-resolve so `$var` string leaves substitute while
        // structure + literal node types are preserved. (Was: objects passed
        // through verbatim and arrays hit resolveExpr as-a-whole, both
        // storing literal "$cellOcc" strings — the Phase-D blocker.)
        value = deepResolveExpr(cfg.value, $vars);
      } else {
        value = resolveExpr(cfg.value, $vars);
      }
      const result = applyUpdate(path, value, { vars: $vars, occurrencesById });
      if (result.varWrites) Object.assign($vars, result.varWrites);
      if (Array.isArray(result.effects)) updates.push(...result.effects);
      break;
    }

    // ---- DELETE: remove an item ----
    // cfg: { itemIdExpr }
    case "DELETE": {
      const itemId = resolveExpr(cfg.itemIdExpr, $vars);
      if (itemId) updates.push({ _effect: "DELETE_ITEM", itemId });
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

    // Other CRUD effects — dispatched + emitted by bindSocketToStore after execution

    case "MOVE_OCCURRENCE": {
      const occId = resolveExpr(cfg.occurrenceIdExpr || "$trigger.occurrenceId", $vars);
      const toContainerId = cfg.toContainerId || resolveExpr(cfg.toContainerIdExpr, $vars);
      if (occId && toContainerId) {
        updates.push({ _effect: "MOVE_OCCURRENCE", occurrenceId: occId, toContainerId });
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

    // ---- ADD_CHILD: append childId to a parent occurrence's occurrences[] ----
    // cfg: { parentId, childId } (both exprs). Pure occurrences[] append — does
    // NOT touch the child's parentId, so the child can live in a folder (tree)
    // AND be listed by a panel occurrence as an inactive tab (the Notes-page
    // pattern). Idempotent: skips when already present. Reuses the existing
    // UPDATE_OCCURRENCE effect; optimistically patches the in-pipeline overlay.
    case "ADD_CHILD": {
      const parentId = resolveExpr(cfg.parentId, $vars);
      const childId = resolveExpr(cfg.childId, $vars);
      if (!parentId || !childId) break;
      const parentOcc =
        (context.occurrencesById && context.occurrencesById[parentId])
        || (Array.isArray($vars.$allOccurrences) && $vars.$allOccurrences.find(o => o?.id === parentId))
        || null;
      const existing = Array.isArray(parentOcc?.occurrences) ? parentOcc.occurrences : [];
      if (existing.includes(childId)) break;
      const next = [...existing, childId];
      if (context.occurrencesById && context.occurrencesById[parentId]) {
        context.occurrencesById[parentId] = { ...context.occurrencesById[parentId], occurrences: next };
      }
      updates.push({ _effect: "UPDATE_OCCURRENCE", occurrence: { id: parentId, occurrences: next } });
      break;
    }

    case "UPDATE_MODULE": {
      const modId = resolveExpr(cfg.moduleId || cfg.moduleIdExpr || "$trigger.moduleId", $vars);
      let patch = cfg.patch;
      if (!patch && cfg.patchJson) {
        try { patch = JSON.parse(cfg.patchJson); } catch { patch = null; }
      }
      // attachFields = [fieldId, ...] — merged into the module's fieldBindings
      // so the renderer shows the field after this op runs. cfg.fieldHidden
      // toggles per-binding visibility on the merged result.
      const attachIds = Array.isArray(cfg.attachFields) ? cfg.attachFields.filter(Boolean) : [];
      const hiddenMap = (cfg.fieldHidden && typeof cfg.fieldHidden === "object") ? cfg.fieldHidden : {};
      if (modId && (attachIds.length || Object.keys(hiddenMap).length)) {
        const mod = modulesById[modId];
        const existing = mod?.fieldBindings || patch?.fieldBindings || [];
        let changed = false;
        const next = existing.map(b => {
          const hidden = !!hiddenMap[b?.fieldId];
          if (b && b.hidden !== hidden) {
            changed = true;
            return { ...b, hidden: hidden ? true : undefined };
          }
          return b;
        });
        for (const fid of attachIds) {
          if (!next.some(b => b?.fieldId === fid)) {
            const hidden = !!hiddenMap[fid];
            next.push({ fieldId: fid, role: "input", order: next.length, ...(hidden ? { hidden: true } : {}) });
            changed = true;
          }
        }
        if (changed) {
          patch = { ...(patch || {}), fieldBindings: next };
        }
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

    // ============================================================
    // APPLY_TEMPLATE — clone a template subtree into a target occurrence
    // cfg: { templateRef, targetOccurrenceVar, mode?: "append"|"replace"|"merge",
    //        unwrapRoot?, defaultFields?, replacements?, rootParent?, rootLabel?,
    //        resultVar? }
    //   replacements: { "{token}": expr } — find-and-replace over every cloned
    //     occurrence's textmap text nodes (e.g. { "{Date}": "$dayDate" }).
    //     Embedded child refs (instanceTextblock/moduleEmbed occurrenceId +
    //     instanceId) are auto-remapped to the clones, so a doc page template
    //     whose textblock child holds the H1 renders correctly after apply.
    //   rootParent: expr → parent id for the cloned ROOT (folder id ok). When
    //     set, mints a standalone new subtree (no clone-into-target); used to
    //     create one fresh page per apply. rootLabel: expr → override the root
    //     clone's module label. rootIdVar: bind the cloned root occurrence id
    //     to a $var (so the caller can pin it onto a panel, etc.). All optional
    //     — omit for the classic clone-into-target / unwrapRoot behavior
    //     (Daily Routine etc.).
    // ============================================================
    case "APPLY_TEMPLATE": {
      const templateRef = resolveExpr(cfg.templateRef, $vars);
      const targetRaw = resolveExpr(cfg.targetOccurrenceVar, $vars);
      const targetOccurrenceId = (typeof targetRaw === "object" && targetRaw !== null)
        ? (targetRaw.id || null)
        : (typeof targetRaw === "string" ? targetRaw : null);
      // mode:
      //   "append" (default) — clone everything fresh (creates duplicates if applied twice)
      //   "replace"          — clear target's children first, then clone everything
      //   "merge"            — for each template node, if a sibling of the clone target
      //                        already carries the same identitySignature, skip cloning
      //                        that node and recurse into its template children with
      //                        target = matched node. Nodes with no identitySignature
      //                        always clone fresh. Use case: re-apply on day nav so
      //                        existing slots stay put but missing routine instances
      //                        get added.
      const mode = ["replace", "merge", "append"].includes(cfg.mode) ? cfg.mode : "append";
      // unwrapRoot:true — clone the template root's CHILDREN into target,
      // skipping the root node itself.
      const unwrapRoot = !!cfg.unwrapRoot;

      // defaultFields:{[fid]:expr} — merged into each cloned instance's `fields`
      // map at CREATE_ITEM time, only when role==="instance" (slot containers
      // have no date binding). Avoids a follow-up LOOP+UPDATE_ITEM_FIELD pass
      // whose socket emits race the create's createQueue: if update_occurrence
      // wins the upsert order, the create's $set clobbers the date stamp.
      const resolvedDefaultFields = (() => {
        const out = {};
        const raw = cfg.defaultFields;
        if (!raw || typeof raw !== "object") return out;
        for (const [k, v] of Object.entries(raw)) {
          const resolved = resolveExpr(v, $vars);
          if (resolved == null || resolved === "") continue;
          out[k] = { value: resolved, flow: "in" };
        }
        return out;
      })();

      // replacements:{ "[token]": expr } — find-and-replace pass over every
      // cloned occurrence's textmap. Each value expr is resolved once here;
      // the cloned textmap's text nodes get `[token]` → resolved string
      // substituted via substituteTextmapTokens (shared with applyUpdate's
      // COMPUTE_TEXTMAP path so there's one token-substitution impl). Use
      // case: a "Day Page" template whose textblock child carries the H1
      // "Day Page - {Date}" — applying it stamps the active date in.
      const resolvedReplacements = (() => {
        const out = {};
        const raw = cfg.replacements;
        if (!raw || typeof raw !== "object") return out;
        for (const [token, expr] of Object.entries(raw)) {
          const v = resolveExpr(expr, $vars);
          if (v == null) continue;
          out[token] = String(v);
        }
        return out;
      })();
      const hasReplacements = Object.keys(resolvedReplacements).length > 0;
      const applyReplacements = (tm) =>
        hasReplacements && tm ? substituteTextmapTokens(tm, resolvedReplacements) : (tm || null);

      // Embedded-reference remap. A doc page renders its child textblocks via
      // `instanceTextblock` (and moduleEmbed / instancePill) nodes inside its
      // OWN textmap, keyed by the child's occurrenceId (+ instanceId = child
      // module id). When we clone the page its children get fresh ids, so the
      // cloned page's textmap must be rewritten to point at the clones — else
      // it still references the template's textblock (renders the original or
      // nothing). occRemap/modRemap are filled as each node is cloned (depth-
      // first: children before their parent's textmap is built).
      const occRemap = new Map(); // srcOccId  → cloneOccId
      const modRemap = new Map(); // srcModId  → cloneModId
      const remapEmbeddedRefs = (tm) => {
        if (tm == null || (occRemap.size === 0 && modRemap.size === 0)) return tm;
        const walk = (node) => {
          if (!node || typeof node !== "object") return;
          if (node.attrs && typeof node.attrs === "object") {
            const a = node.attrs;
            if (a.occurrenceId && occRemap.has(a.occurrenceId)) a.occurrenceId = occRemap.get(a.occurrenceId);
            if (a.instanceId && modRemap.has(a.instanceId)) a.instanceId = modRemap.get(a.instanceId);
          }
          if (Array.isArray(node.content)) node.content.forEach(walk);
        };
        walk(tm);
        return tm;
      };
      // Combined: token replace THEN ref remap. substituteTextmapTokens already
      // deep-clones; when there are no replacements but we still need a remap,
      // clone here so we never mutate the shared template textmap in-place.
      const cloneTextmap = (tm) => {
        if (tm == null) return null;
        let out = applyReplacements(tm);
        if (out === tm) out = JSON.parse(JSON.stringify(tm));
        return remapEmbeddedRefs(out);
      };

      // rootParent (optional): when set, the cloned ROOT is parented directly
      // here (a folder id is fine — pages parent to folders via parentId) and
      // no clone-into-an-existing-target is required. Used to mint a brand-new
      // top-level page from a template (e.g. one Day Page per date in the Day
      // Pages folder) rather than merging children into an existing page.
      // rootLabel (optional): overrides the root clone's module label so the
      // new page can be named per-apply (e.g. "Day Page - 2026-05-15").
      // Both default to undefined → every existing caller (Daily Routine etc.)
      // is byte-for-byte unchanged.
      const rootParentId = cfg.rootParent != null ? resolveExpr(cfg.rootParent, $vars) : null;
      const rootLabelOverride = cfg.rootLabel != null ? resolveExpr(cfg.rootLabel, $vars) : null;

      if (!templateRef) break;
      const target = occurrencesById[targetOccurrenceId];
      // target is required UNLESS rootParent is supplied (standalone clone).
      if (!rootParentId && (!targetOccurrenceId || !target)) break;

      // Walk the template subtree from occurrencesById, mint new ids, push CREATE_ITEM
      // per node so bindSocketToStore.CREATE_ITEM does the local dispatch + socket emit.
      const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const newOccIds = [];
      const newOccStubs = []; // depth-first: leaves first, roots last. Each entry has .id so UPDATE can bind.

      function clone(srcOccId, parentId, isRoot) {
        const srcOcc = occurrencesById[srcOccId];
        if (!srcOcc) return null;
        const srcModId = srcOcc.moduleId || srcOcc.targetId;
        const srcMod = srcModId ? modulesById[srcModId] : null;
        if (!srcMod) return null;

        // MERGE: if a child of parentId already shares this template node's
        // identitySignature, skip cloning and recurse into the template's
        // children with target = matched node. identitySignature is null/empty
        // by default → no match → always clones fresh.
        if (mode === "merge" && srcOcc.identitySignature) {
          const sig = srcOcc.identitySignature;
          const parentOcc = occurrencesById[parentId] || $vars.$allOccurrences?.find(o => o.id === parentId);
          const siblingIds = parentOcc?.occurrences || [];
          const matched = siblingIds
            .map(id => occurrencesById[id] || $vars.$allOccurrences?.find(o => o.id === id))
            .find(o => o && o.identitySignature === sig);
          if (matched) {
            // Track child IDs we add this pass so downstream same-pipeline FINDs
            // walking matched.occurrences[] see them. Without this, recursive
            // clones into a matched node are invisible to FINDs that ran later
            // in the same pipeline (the optimistic stub was never patched).
            const addedChildIds = [];
            for (const childOccId of (srcOcc.occurrences || [])) {
              const childCloneId = clone(childOccId, matched.id, false);
              if (childCloneId && !siblingIds.includes(childCloneId)) {
                addedChildIds.push(childCloneId);
              }
            }
            if (addedChildIds.length && Array.isArray($vars.$allOccurrences)) {
              const patchedMatched = {
                ...matched,
                occurrences: [...(matched.occurrences || []), ...addedChildIds],
              };
              $vars.$allOccurrences = $vars.$allOccurrences.map(o => o.id === matched.id ? patchedMatched : o);
              if (Array.isArray($vars.$allItems)) {
                $vars.$allItems = $vars.$allItems.map(o => o.id === matched.id ? patchedMatched : o);
              }
            }
            return matched.id;
          }
        }

        const cloneModId = newId();
        const cloneOccId = newId();
        occRemap.set(srcOccId, cloneOccId);
        if (srcModId) modRemap.set(srcModId, cloneModId);

        const childIds = [];
        for (const childOccId of (srcOcc.occurrences || [])) {
          const childCloneId = clone(childOccId, cloneOccId, false);
          if (childCloneId) childIds.push(childCloneId);
        }

        // Strip templateModule marker on apply, attach appliedFromTemplateId on root
        const newModuleMeta = { ...(srcMod.meta || {}), templateModule: false };
        const newOccMeta = isRoot
          ? { ...(srcOcc.meta || {}), appliedFromTemplateId: templateRef }
          : { ...(srcOcc.meta || {}) };

        updates.push({
          _effect: "CREATE_ITEM",
          template: {
            id: cloneModId,
            name: (isRoot && rootLabelOverride) ? rootLabelOverride : (srcMod.label || srcMod.name),
            label: (isRoot && rootLabelOverride) ? rootLabelOverride : (srcMod.label || srcMod.name),
            role: srcMod.role,
            kind: srcMod.kind,
            meta: newModuleMeta,
            fieldBindings: Array.isArray(srcMod.fieldBindings) ? srcMod.fieldBindings : [],
          },
          instance: {
            id: cloneOccId,
            templateId: cloneModId,
            parentId,
            // Merge defaultFields onto instance-role clones only — slot/page
            // clones don't carry the date binding so the extra key would be
            // dead weight (and CREATE_ITEM's auto-attach would inflate their
            // fieldBindings with an unrelated id).
            fields: srcMod.role === "instance"
              ? { ...(srcOcc.fields || {}), ...resolvedDefaultFields }
              : { ...(srcOcc.fields || {}) },
            textmap: cloneTextmap(srcOcc.textmap),
            viewId: srcOcc.viewId || null,
            meta: newOccMeta,
            identitySignature: srcOcc.identitySignature || null,
            // Children IDs included directly so the new occurrence is
            // created WITH its child list (CREATE_ITEM handler now honors
            // inst.occurrences). Avoids the race where a separate
            // UPDATE_OCCURRENCE patches occurrences[] outside the server's
            // createQueue and gets clobbered.
            occurrences: childIds,
          },
        });

        newOccIds.push(cloneOccId);
        const stub = {
          id: cloneOccId,
          moduleId: cloneModId,
          targetId: cloneModId,
          parentId,
          fields: srcMod.role === "instance"
            ? { ...(srcOcc.fields || {}), ...resolvedDefaultFields }
            : { ...(srcOcc.fields || {}) },
          occurrences: childIds,
          meta: newOccMeta,
          identitySignature: srcOcc.identitySignature || null,
          role: srcMod.role,
        };
        newOccStubs.push(stub);

        // Optimistic publish so subsequent FIND/LOOP in same pipeline sees it.
        // Mirror into role-filtered slices too — otherwise a follow-up FIND with
        // `over: "$allInstances"` (etc.) is blind to in-pipeline clones.
        if (Array.isArray($vars.$allOccurrences)) {
          $vars.$allOccurrences = [...$vars.$allOccurrences, stub];
          if (Array.isArray($vars.$allItems)) {
            $vars.$allItems = [...$vars.$allItems, stub];
          }
          if (stub.role === "container" && Array.isArray($vars.$allContainers)) {
            $vars.$allContainers = [...$vars.$allContainers, stub];
          } else if (stub.role === "page" && Array.isArray($vars.$allPages)) {
            $vars.$allPages = [...$vars.$allPages, stub];
          } else if (stub.role === "panel" && Array.isArray($vars.$allPanels)) {
            $vars.$allPanels = [...$vars.$allPanels, stub];
          } else if (stub.role === "instance" && Array.isArray($vars.$allInstances)) {
            $vars.$allInstances = [...$vars.$allInstances, stub];
          }
        }

        return cloneOccId;
      }

      // Mode "replace" first clears the target's children
      if (mode === "replace" && target && (target.occurrences || []).length) {
        updates.push({
          _effect: "UPDATE_OCCURRENCE",
          occurrence: { id: target.id, occurrences: [] },
        });
      }

      let rootCloneId = null;
      if (rootParentId) {
        // Standalone clone: the whole template (root included) becomes a new
        // subtree parented to rootParentId. unwrapRoot is ignored here — the
        // root IS the thing we want (e.g. the Day Page doc page itself).
        rootCloneId = clone(templateRef, rootParentId, true);
        if (!rootCloneId) break;
      } else if (unwrapRoot) {
        // Clone only the template root's CHILDREN into target (skip root node).
        const templateRoot = occurrencesById[templateRef];
        if (templateRoot) {
          for (const childOccId of (templateRoot.occurrences || [])) {
            clone(childOccId, target.id, false);
          }
        }
      } else {
        rootCloneId = clone(templateRef, target.id, true);
        if (!rootCloneId) break;
      }

      // CREATE_ITEM auto-appends each new occurrence to its parent.

      // resultVar holds full stubs (each has .id) so downstream LOOP+UPDATE
      // can bind to the records via `as: "$newOcc"` and `path: "$newOcc.fields..."`
      if (cfg.resultVar) $vars[cfg.resultVar] = newOccStubs;
      if (cfg.resultIdsVar) $vars[cfg.resultIdsVar] = newOccIds;
      // rootIdVar — the cloned ROOT occurrence id (null for unwrapRoot, which
      // has no single root). Lets the caller wire the new page somewhere, e.g.
      // LINK_OCCURRENCE_TO_PARENT it onto a panel as an inactive tab.
      if (cfg.rootIdVar && rootCloneId) $vars[cfg.rootIdVar] = rootCloneId;
      break;
    }

    // ============================================================
    // COPY_OCCURRENCE — clone an arbitrary occurrence subtree into a target
    // cfg: {
    //   sourceOccurrenceVar,  // expr → source occurrence id (the thing to copy)
    //   targetOccurrenceVar,  // expr → target parent occurrence id (where to place clones)
    //   includeChildren?:bool (default true)  // shallow copy when false
    //   resultVar?, resultIdsVar?             // bind clone stubs / ids
    // }
    // Differs from APPLY_TEMPLATE in that:
    //   - source need not be a template (no meta.templateName requirement)
    //   - cloned modules don't get templateModule:false stamped (no template metadata)
    //   - cloned root occurrence doesn't get appliedFromTemplateId stamped
    //   - no merge mode (always fresh clones)
    // Shares the CREATE_ITEM effect machinery, so the optimistic local
    // dispatch + per-node socket emit path is identical.
    // ============================================================
    case "COPY_OCCURRENCE": {
      const sourceRaw = resolveExpr(cfg.sourceOccurrenceVar, $vars);
      const sourceOccurrenceId = (typeof sourceRaw === "object" && sourceRaw !== null)
        ? (sourceRaw.id || null)
        : (typeof sourceRaw === "string" ? sourceRaw : null);
      const targetRaw = resolveExpr(cfg.targetOccurrenceVar, $vars);
      const targetOccurrenceId = (typeof targetRaw === "object" && targetRaw !== null)
        ? (targetRaw.id || null)
        : (typeof targetRaw === "string" ? targetRaw : null);
      const includeChildren = cfg.includeChildren !== false; // default true

      if (!sourceOccurrenceId || !targetOccurrenceId) break;
      const source = occurrencesById[sourceOccurrenceId];
      const target = occurrencesById[targetOccurrenceId];
      if (!source || !target) break;

      const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const newOccIds = [];
      const newOccStubs = [];

      function clone(srcOccId, parentId) {
        const srcOcc = occurrencesById[srcOccId];
        if (!srcOcc) return null;
        const srcModId = srcOcc.moduleId || srcOcc.targetId;
        const srcMod = srcModId ? modulesById[srcModId] : null;
        if (!srcMod) return null;

        const cloneModId = newId();
        const cloneOccId = newId();

        const childIds = [];
        if (includeChildren) {
          for (const childOccId of (srcOcc.occurrences || [])) {
            const childCloneId = clone(childOccId, cloneOccId);
            if (childCloneId) childIds.push(childCloneId);
          }
        }

        updates.push({
          _effect: "CREATE_ITEM",
          template: {
            id: cloneModId,
            name: srcMod.label || srcMod.name,
            label: srcMod.label || srcMod.name,
            role: srcMod.role,
            kind: srcMod.kind,
            meta: { ...(srcMod.meta || {}) },
            fieldBindings: Array.isArray(srcMod.fieldBindings) ? srcMod.fieldBindings : [],
          },
          instance: {
            id: cloneOccId,
            templateId: cloneModId,
            parentId,
            fields: { ...(srcOcc.fields || {}) },
            textmap: srcOcc.textmap || null,
            viewId: srcOcc.viewId || null,
            meta: { ...(srcOcc.meta || {}) },
            identitySignature: srcOcc.identitySignature || null,
            occurrences: childIds,
          },
        });

        newOccIds.push(cloneOccId);
        const stub = {
          id: cloneOccId,
          moduleId: cloneModId,
          targetId: cloneModId,
          parentId,
          fields: { ...(srcOcc.fields || {}) },
          occurrences: childIds,
          meta: { ...(srcOcc.meta || {}) },
          identitySignature: srcOcc.identitySignature || null,
          role: srcMod.role,
        };
        newOccStubs.push(stub);

        if (Array.isArray($vars.$allOccurrences)) {
          $vars.$allOccurrences = [...$vars.$allOccurrences, stub];
          if (Array.isArray($vars.$allItems)) {
            $vars.$allItems = [...$vars.$allItems, stub];
          }
          if (stub.role === "container" && Array.isArray($vars.$allContainers)) {
            $vars.$allContainers = [...$vars.$allContainers, stub];
          } else if (stub.role === "page" && Array.isArray($vars.$allPages)) {
            $vars.$allPages = [...$vars.$allPages, stub];
          } else if (stub.role === "panel" && Array.isArray($vars.$allPanels)) {
            $vars.$allPanels = [...$vars.$allPanels, stub];
          } else if (stub.role === "instance" && Array.isArray($vars.$allInstances)) {
            $vars.$allInstances = [...$vars.$allInstances, stub];
          }
        }

        return cloneOccId;
      }

      const rootCloneId = clone(sourceOccurrenceId, target.id);
      if (!rootCloneId) break;

      if (cfg.resultVar) $vars[cfg.resultVar] = newOccStubs;
      if (cfg.resultIdsVar) $vars[cfg.resultIdsVar] = newOccIds;
      // Convenience scalar — same shape as APPLY_TEMPLATE returns nothing of
      // the kind, but a single-source copy almost always wants the new root
      // id available downstream without indexing the stubs array.
      if (cfg.resultIdVar) $vars[cfg.resultIdVar] = rootCloneId;
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
      updates.push({ _effect: "UPDATE_ITEM_FIELD", itemId: occId, fieldId: completionFieldId, value: false, subKind: "value" });

      // Advance dueDate if recurrenceDays > 0
      if (dueDateFieldId && recurrenceDays > 0) {
        const occ = occurrencesById[occId];
        const existingFv = occ?.fields?.[dueDateFieldId];
        const rawDate = existingFv?.value !== undefined ? existingFv.value : existingFv;
        const baseDate = rawDate && !isNaN(new Date(rawDate).getTime()) ? new Date(rawDate) : new Date();
        const newDate = new Date(baseDate);
        newDate.setDate(newDate.getDate() + recurrenceDays);
        updates.push({ _effect: "UPDATE_ITEM_FIELD", itemId: occId, fieldId: dueDateFieldId, value: newDate.toISOString(), subKind: "value" });
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
    // Finds the specific pool occurrence whose moduleId matches within the pool container.
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
    // Picks options[dayOfYear % n].label and writes to targetFieldId as a display value.
    case "CYCLE_FIELD_VALUE": {
      const sourceField = fieldsById?.[cfg.sourceFieldId];
      const options = resolveOptions(sourceField, { fieldsById, occurrencesById, modulesById, foldersById }).options;
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

    // ---- PICK_RANDOM_FROM_POOL: pick a random child from a pool container ----
    // cfg: { poolId, varName? }
    // Stores the picked module's label in $vars[varName] (default: "$pickedLabel").
    // Uses the pool container's occurrence.occurrences array for ordering.
    case "PICK_RANDOM_FROM_POOL": {
      const containerId = resolveExpr(cfg.poolId, $vars);
      const varName = cfg.varName || "$pickedLabel";
      if (!containerId) break;

      // Find the pool container's occurrence to get ordered child IDs
      const containerOcc = Object.values(occurrencesById).find(o => o.moduleId === containerId);
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
        const mod = modulesById[pickedOcc.moduleId];
        $vars[varName] = mod?.label ?? "";
      }
      break;
    }

    case "RUN_OPERATION": {
      // Invoke another operation's pipeline inline. Look up by id (preferred,
      // stable) or by operationName (ergonomic for hand-written seeds).
      // The called op runs with the SAME `transaction` (so its $trigger.* is
      // identical to the caller's) but with a FRESH $vars built from its own
      // sources — that's important: vars from the caller would clobber the
      // callee's INIT_VARs and vice versa. Effects from the called op bubble
      // up and merge into the caller's effect list.
      //
      // Recursion guard: depth tracked via context._opCallDepth, capped at 4.
      const depth = (context._opCallDepth || 0);
      if (depth >= 4) {
        console.warn("[RUN_OPERATION] recursion depth cap hit, skipping");
        break;
      }

      let subOp = null;
      if (cfg.operationId) {
        subOp = operationsById[cfg.operationId];
      } else if (cfg.operationName) {
        const wanted = String(cfg.operationName);
        subOp = Object.values(operationsById).find(o => o?.name === wanted) || null;
      }
      if (!subOp) {
        console.warn(`[RUN_OPERATION] operation not found: ${cfg.operationId || cfg.operationName}`);
        break;
      }

      const { executePipeline: _execPipeline, executeOperation: _execOp } = context._executors || {};
      const childContext = { ...context, _opCallDepth: depth + 1 };
      if (subOp.pipeline && _execPipeline) {
        updates.push(..._execPipeline(subOp, childContext, transaction, context._extraVars));
      } else if (_execOp) {
        updates.push(..._execOp(subOp, null, transaction, childContext));
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
