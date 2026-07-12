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
import { toast } from "../state/notificationStore";
import { ringAlarm } from "./alarmSound";

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
  // Value Builder reference sentinel: { __ref: "$path" } — resolve as the
  // wrapped path. Lets authors store a picker-driven reference in a
  // structured editor (JsonStructureEditor.jsx ReferenceInput) and have
  // the runtime evaluate it like any other $path. Empty __ref → null.
  if (typeof expr === "object" && !Array.isArray(expr) && expr !== null
      && Object.prototype.hasOwnProperty.call(expr, "__ref")) {
    return expr.__ref ? resolveExpr(expr.__ref, $vars) : null;
  }
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

  // dateLong:expr — formats a date expression as "Sunday, May 24th, 2026"
  // (YYYY-MM-DD strings parsed as LOCAL midnight to avoid timezone drift).
  if (expr.startsWith("dateLong:")) {
    const dateVal = resolveExpr(expr.slice(9), $vars);
    if (dateVal == null || dateVal === "") return "";
    let d;
    if (typeof dateVal === "string" && /^\d{4}-\d{2}-\d{2}/.test(dateVal)) {
      const [y, m, day] = dateVal.slice(0, 10).split("-").map(Number);
      d = new Date(y, m - 1, day);
    } else {
      d = new Date(dateVal);
    }
    if (isNaN(d.getTime())) return String(dateVal);
    const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
    const month = d.toLocaleDateString("en-US", { month: "long" });
    const dayNum = d.getDate();
    const j = dayNum % 10, k = dayNum % 100;
    const suffix = (k >= 11 && k <= 13) ? "th" : j === 1 ? "st" : j === 2 ? "nd" : j === 3 ? "rd" : "th";
    return `${weekday}, ${month} ${dayNum}${suffix}, ${d.getFullYear()}`;
  }

  // Template string interpolation: "daypage ${$today}" → "daypage 2026-03-22"
  // Detect ${...} patterns and replace each with resolved inner expression.
  // If the substituted result is itself a path expression ($var.x.y), recurse
  // so callers like `"$allItemsById.${$childId}"` resolve to the actual
  // occurrence object instead of stopping at the substituted string.
  if (expr.includes("${")) {
    const substituted = expr.replace(/\$\{([^}]+)\}/g, (_, inner) => {
      const resolved = resolveExpr(inner.trim(), $vars);
      return resolved != null ? String(resolved) : "";
    });
    if (substituted.startsWith("$")) return resolveExpr(substituted, $vars);
    return substituted;
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
    // Numeric comparators. The `_THAN` aliases match the natural-language
    // phrasing seed authors reach for ("$count GREATER_THAN 0") — without
    // them, a hand-typed predicate silently falls through to the default
    // `return false`, making a guard's whole AND branch dead code. Aliased
    // here so authoring stays forgiving on either name.
    case "GREATER":
    case "GREATER_THAN":             return Number(leftVal) > Number(rightVal);
    case "LESS":
    case "LESS_THAN":                return Number(leftVal) < Number(rightVal);
    case "GREATER_OR_EQUAL":
    case "GREATER_THAN_OR_EQUAL":    return Number(leftVal) >= Number(rightVal);
    case "LESS_OR_EQUAL":
    case "LESS_THAN_OR_EQUAL":       return Number(leftVal) <= Number(rightVal);
    case "CONTAINS":         return String(leftVal).includes(String(rightVal));
    case "NOT_CONTAINS":     return !String(leftVal).includes(String(rightVal));
    // Time-of-day comparators — generic, domain-agnostic. Parse BOTH 12h
    // ("9:00am", "9am", "12:30 PM") and 24h ("14:30", "09:00") forms, plus the
    // time portion of an ISO datetime, to minutes-since-midnight, then compare.
    // Either side unparseable → false (a time comparison against a non-time
    // never matches). Lets a pipeline ask "is this time-of-day field before
    // $currentTime?" without baking any time math into the seed.
    case "TIME_BEFORE":
    case "TIME_AFTER": {
      const toMin = (v) => {
        if (v == null) return null;
        const s = String(v).trim().toLowerCase();
        if (!s) return null;
        const m12 = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
        if (m12) {
          let h = parseInt(m12[1], 10);
          const min = m12[2] ? parseInt(m12[2], 10) : 0;
          if (h === 12) h = 0;
          if (m12[3] === "pm") h += 12;
          return (h > 23 || min > 59) ? null : h * 60 + min;
        }
        const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
        if (m24) {
          const h = parseInt(m24[1], 10);
          const min = parseInt(m24[2], 10);
          return (h > 23 || min > 59) ? null : h * 60 + min;
        }
        if (/^\d{4}-\d{2}-\d{2}t/.test(s)) {
          const d = new Date(v);
          if (!isNaN(d.getTime())) return d.getHours() * 60 + d.getMinutes();
        }
        return null;
      };
      const lm = toMin(leftVal);
      const rm = toMin(rightVal);
      if (lm == null || rm == null) return false;
      return comparator === "TIME_BEFORE" ? lm < rm : lm > rm;
    }
    // Calendar-day before/after — compares by day-key only (time of day
    // ignored). Either side null/""/unparseable → false. Lexical day-key
    // compare is correct date ordering; the regex slice avoids the timezone
    // shift `new Date("2026-06-03T..Z")` would introduce on a bare date.
    case "DATE_BEFORE":
    case "DATE_AFTER": {
      if (leftVal == null || leftVal === "" || rightVal == null || rightVal === "") return false;
      const dayKey = (v) => {
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
        const d = new Date(v);
        if (isNaN(d.getTime())) return null;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      };
      const lk = dayKey(leftVal);
      const rk = dayKey(rightVal);
      if (lk == null || rk == null) return false;
      return comparator === "DATE_BEFORE" ? lk < rk : lk > rk;
    }
    // Array comparators — left resolves to an array (e.g. $item._ancestors)
    case "HAS_ANCESTOR":
    case "ARRAY_INCLUDES": {
      const arr = Array.isArray(leftVal) ? leftVal : [];
      return arr.some(a => String(a) === String(rightVal));
    }
    case "NOT_HAS_ANCESTOR":
    case "ARRAY_NOT_INCLUDES": {
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
      //   { kind: "multi", dates: ["YYYY-MM-DD", ...] } → OR-match: leftVal
      //     passes if its day-key equals ANY date in the array.
      if (rightVal == null || rightVal === "") return true;
      if (leftVal == null || leftVal === "") return false;
      const isObj = typeof rightVal === "object" && !Array.isArray(rightVal);
      const dayKey = (v) => {
        if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
        const d = new Date(v);
        if (isNaN(d.getTime())) return null;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      };
      // Multi-date OR-match short-circuit.
      if (isObj && rightVal.kind === "multi" && Array.isArray(rightVal.dates)) {
        const lk = dayKey(leftVal);
        if (lk == null) return false;
        for (const ds of rightVal.dates) {
          const rk = dayKey(ds);
          if (rk != null && rk === lk) return true;
        }
        return false;
      }
      const anchor = isObj ? rightVal.value : rightVal;
      const unit = isObj ? (rightVal.unit || "day") : "day";
      const spanRaw = isObj ? Number(rightVal.span) : 1;
      const span = Number.isFinite(spanRaw) && spanRaw > 1 ? Math.floor(spanRaw) : 1;
      if (anchor == null || anchor === "") return true;
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
  // Tolerate legacy `$item.X` / `$record.X` predicates from seed data — the
  // editor writes bare record paths (`label`, `fields.X.value`) going
  // forward, but DB rows saved under older patterns carry these prefixes
  // (`$record.` appears in optionsSource find predicates, e.g. the Account
  // picker's `$record._ancestors HAS_ANCESTOR <library>`). Stripping here
  // means we never need to touch existing data.
  const normalized = path.startsWith("$item.") ? path.slice(6)
    : path.startsWith("$record.") ? path.slice(8)
    : path;
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
      // cfg.fallback / cfg.fallback2 — if the primary expr resolves to null/undefined, try these in order.
      let initVal;
      if (cfg.arrayOf !== undefined) {
        const items = Array.isArray(cfg.arrayOf) ? cfg.arrayOf : [cfg.arrayOf];
        initVal = items.map(x => resolveExpr(x, $vars));
      } else if (cfg.expr !== undefined) {
        initVal = resolveExpr(cfg.expr, $vars);
        if ((initVal === undefined || initVal === null) && cfg.fallback !== undefined) {
          initVal = resolveExpr(cfg.fallback, $vars);
        }
        if ((initVal === undefined || initVal === null) && cfg.fallback2 !== undefined) {
          initVal = resolveExpr(cfg.fallback2, $vars);
        }
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
      // Accept `cfg.by` (the form INCREMENT_VAR/DIV_VAR use) AND `cfg.expr`.
      // Was `expr`-only, so a caller passing `by: 240` got resolveExpr(undefined)
      // → NaN → the multiply silently no-op'd (the canvas-fan-out bug: every card
      // landed at the base x/y because $col*240 / $row*150 always came out 0).
      const mulVal = Number(resolveExpr(cfg.by ?? cfg.expr, $vars)) || Number(cfg.by) || 1;
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
    // ── Value manipulator (task #31) ────────────────────────────────────
    // JS-equivalent ops on local $vars. Each action reads / writes
    // $vars[cfg.name] in place. Pure — no effects emitted.

    case "SPLIT_STRING": {
      // cfg: { name, by? (default " "), to? (writes back into a different var) }
      const src = $vars[cfg.name];
      const sep = resolveExpr(cfg.by, $vars) ?? cfg.by ?? " ";
      const out = (typeof src === "string") ? src.split(sep) : (src == null ? [] : [src]);
      const target = cfg.to || cfg.name;
      $vars[target] = out;
      break;
    }
    case "JOIN_ARRAY": {
      // cfg: { name, by? (default ""), to? }
      const src = $vars[cfg.name];
      const sep = resolveExpr(cfg.by, $vars) ?? cfg.by ?? "";
      const out = Array.isArray(src) ? src.join(sep) : (src == null ? "" : String(src));
      const target = cfg.to || cfg.name;
      $vars[target] = out;
      break;
    }
    case "SORT_VAR": {
      // cfg: { name, direction? ("asc"|"desc"), by? (key for object array) }
      const src = $vars[cfg.name];
      if (!Array.isArray(src)) break;
      const direction = (cfg.direction === "desc") ? -1 : 1;
      const key = cfg.by || null;
      const sorted = [...src].sort((a, b) => {
        const av = key ? (a?.[key] ?? null) : a;
        const bv = key ? (b?.[key] ?? null) : b;
        if (av == null && bv == null) return 0;
        if (av == null) return 1 * direction;
        if (bv == null) return -1 * direction;
        if (av < bv) return -1 * direction;
        if (av > bv) return 1 * direction;
        return 0;
      });
      $vars[cfg.name] = sorted;
      break;
    }
    case "REMOVE_FROM_VAR": {
      // cfg: { name, at? (index), value? (literal to remove first match) }
      const src = $vars[cfg.name];
      if (!Array.isArray(src)) break;
      if (cfg.at != null) {
        const i = Number(resolveExpr(cfg.at, $vars));
        if (Number.isFinite(i) && i >= 0 && i < src.length) {
          const out = [...src];
          out.splice(i, 1);
          $vars[cfg.name] = out;
        }
      } else if ("value" in cfg) {
        const v = resolveExpr(cfg.value, $vars);
        const idx = src.indexOf(v);
        if (idx >= 0) {
          const out = [...src];
          out.splice(idx, 1);
          $vars[cfg.name] = out;
        }
      }
      break;
    }
    case "REPLACE_IN_VAR": {
      // cfg: { name, at (index), value (resolved expr) }
      const src = $vars[cfg.name];
      if (!Array.isArray(src)) break;
      const i = Number(resolveExpr(cfg.at, $vars));
      if (!Number.isFinite(i) || i < 0 || i >= src.length) break;
      const v = resolveExpr(cfg.value, $vars);
      const out = [...src];
      out[i] = v;
      $vars[cfg.name] = out;
      break;
    }
    case "MERGE_ARRAY": {
      // cfg: { name, with (expr → array), unique? (bool) }
      const src = Array.isArray($vars[cfg.name]) ? $vars[cfg.name] : [];
      const incoming = resolveExpr(cfg.with, $vars);
      const incomingArr = Array.isArray(incoming) ? incoming : (incoming == null ? [] : [incoming]);
      let out = [...src, ...incomingArr];
      if (cfg.unique) {
        const seen = new Set();
        out = out.filter(v => {
          const key = (typeof v === "object" && v !== null) ? JSON.stringify(v) : v;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      $vars[cfg.name] = out;
      break;
    }
    case "TYPE_OF": {
      // cfg: { name, to? } — write the JS-type of the var to `to` (default $type).
      const src = $vars[cfg.name];
      let t;
      if (Array.isArray(src)) t = "array";
      else if (src === null) t = "null";
      else t = typeof src;
      $vars[cfg.to || "$type"] = t;
      break;
    }
    case "ARRAY_LENGTH": {
      // cfg: { name, to? } — write length to `to` (default $length).
      const src = $vars[cfg.name];
      const len = Array.isArray(src) ? src.length : (typeof src === "string" ? src.length : 0);
      $vars[cfg.to || "$length"] = len;
      break;
    }

    // ---- GROUP_BY: group an array of objects by a dotted path ----
    // cfg: { name, by, to? }
    //   name — source array var
    //   by   — dotted path to extract group key from each element
    //          (e.g. "type", "fields.dateFieldId.value", "meta.scheduleSlot")
    //   to   — destination var, default $groups
    //
    // Output: object map keyed by group value, each value is an array
    // of the matching input items (insertion-ordered). Null/undefined
    // keys go under the literal "null" string for predictable lookup.
    // Use case: "purchases by account", "tasks by day", "rows by status".
    case "GROUP_BY": {
      const src = $vars[cfg.name];
      const byPath = cfg.by ? String(cfg.by) : null;
      if (!Array.isArray(src) || !byPath) {
        $vars[cfg.to || "$groups"] = {};
        break;
      }
      const groups = {};
      for (const item of src) {
        const k = byPath.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), item);
        const groupKey = (k == null) ? "null" : String(k);
        if (!groups[groupKey]) groups[groupKey] = [];
        groups[groupKey].push(item);
      }
      $vars[cfg.to || "$groups"] = groups;
      break;
    }

    // ---- MAP_VAR: transform each element of an array via an expression ----
    // cfg: { name, as?, expr, to? }
    //   name — source array var
    //   as   — element variable name, default "$item" (also writes $index)
    //   expr — expression evaluated per element; can reference $item / $index
    //   to   — destination var, default `name` (in-place)
    //
    // Sets $vars[as] + $vars.$index for each iteration, then restores the
    // PRIOR values after the loop so this action doesn't leak temporary
    // bindings into the surrounding scope.
    case "MAP_VAR": {
      const src = $vars[cfg.name];
      if (!Array.isArray(src)) break;
      const asName = cfg.as || "$item";
      // Save prior values to restore after — important when MAP_VAR runs
      // inside a LOOP that already uses $item.
      const priorItem = $vars[asName];
      const priorIndex = $vars.$index;
      const out = [];
      for (let i = 0; i < src.length; i++) {
        $vars[asName] = src[i];
        $vars.$index = i;
        out.push(resolveExpr(cfg.expr, $vars));
      }
      $vars[asName] = priorItem;
      $vars.$index = priorIndex;
      $vars[cfg.to || cfg.name] = out;
      break;
    }

    // ---- FILTER_VAR: keep elements matching a comparator ----
    // cfg: { name, as?, comparator?, right?, to? }
    //   name       — source array var
    //   as         — element variable name, default "$item"
    //   comparator — name from evalRule's comparator set (default "IS")
    //   right      — comparison right value (resolved via resolveExpr)
    //
    // Simpler than a full predicate group — for the common "keep entries
    // where each.field IS value" pattern. Predicate-group filtering can
    // be done by wrapping in an IF inside a LOOP. This action covers the
    // 90% case in one line.
    case "FILTER_VAR": {
      const src = $vars[cfg.name];
      if (!Array.isArray(src)) break;
      const asName = cfg.as || "$item";
      const comp = cfg.comparator || "IS";
      const priorItem = $vars[asName];
      const out = [];
      for (const el of src) {
        $vars[asName] = el;
        const rightVal = resolveExpr(cfg.right, $vars);
        const rule = { left: asName, comparator: comp, right: rightVal };
        if (evalRule(rule, $vars)) out.push(el);
      }
      $vars[asName] = priorItem;
      $vars[cfg.to || cfg.name] = out;
      break;
    }

    // ---- ARRAY_AT: index into array (or string), negative-friendly ----
    // cfg: { name, index, to? } — `index` resolves via resolveExpr.
    // Negative indices count from the end (-1 = last). Writes undefined
    // (not null) when out of bounds.
    case "ARRAY_AT": {
      const src = $vars[cfg.name];
      const idx = Number(resolveExpr(cfg.index, $vars));
      if (!Number.isFinite(idx)) {
        $vars[cfg.to || "$item"] = undefined;
        break;
      }
      if (Array.isArray(src)) {
        const i = idx < 0 ? src.length + idx : idx;
        $vars[cfg.to || "$item"] = (i >= 0 && i < src.length) ? src[i] : undefined;
      } else if (typeof src === "string") {
        const i = idx < 0 ? src.length + idx : idx;
        $vars[cfg.to || "$item"] = (i >= 0 && i < src.length) ? src.charAt(i) : undefined;
      } else {
        $vars[cfg.to || "$item"] = undefined;
      }
      break;
    }

    // ---- INDEX_OF_VAR: find index of a value in an array/string ----
    // cfg: { name, find, to? } — `find` resolves via resolveExpr.
    // Writes the integer index to `to` (default $index). -1 when missing.
    case "INDEX_OF_VAR": {
      const src = $vars[cfg.name];
      const find = resolveExpr(cfg.find, $vars);
      if (Array.isArray(src)) {
        $vars[cfg.to || "$index"] = src.indexOf(find);
      } else if (typeof src === "string") {
        $vars[cfg.to || "$index"] = src.indexOf(String(find ?? ""));
      } else {
        $vars[cfg.to || "$index"] = -1;
      }
      break;
    }

    // ---- TO_LOWER / TO_UPPER: case conversion ----
    // cfg: { name, to? } — `to` defaults to name (in-place).
    case "TO_LOWER": {
      const src = $vars[cfg.name];
      if (typeof src === "string") $vars[cfg.to || cfg.name] = src.toLowerCase();
      break;
    }
    case "TO_UPPER": {
      const src = $vars[cfg.name];
      if (typeof src === "string") $vars[cfg.to || cfg.name] = src.toUpperCase();
      break;
    }

    // ---- TRIM: strip whitespace ----
    case "TRIM_STRING": {
      const src = $vars[cfg.name];
      if (typeof src === "string") $vars[cfg.to || cfg.name] = src.trim();
      break;
    }

    // ---- REPLACE_STRING: find/replace within a string ----
    // cfg: { name, find, replace, all?, to? }
    // `find` and `replace` resolve via resolveExpr. `all:true` replaces every
    // occurrence (no regex — literal substring); default replaces only first.
    case "REPLACE_STRING": {
      const src = $vars[cfg.name];
      if (typeof src !== "string") break;
      const find = String(resolveExpr(cfg.find, $vars) ?? "");
      const replace = String(resolveExpr(cfg.replace, $vars) ?? "");
      if (find === "") break;
      let out;
      if (cfg.all === true) out = src.split(find).join(replace);
      else out = src.replace(find, replace);
      $vars[cfg.to || cfg.name] = out;
      break;
    }

    // ---- CONTAINS_STRING: test substring presence ----
    // cfg: { name, find, to? } — writes boolean to `to` (default $contains).
    case "CONTAINS_STRING": {
      const src = $vars[cfg.name];
      if (typeof src !== "string") {
        $vars[cfg.to || "$contains"] = false;
        break;
      }
      const find = String(resolveExpr(cfg.find, $vars) ?? "");
      $vars[cfg.to || "$contains"] = find === "" ? true : src.includes(find);
      break;
    }

    // ---- CONCAT_STRINGS: join multiple values into one string ----
    // cfg: { values: [expr...], separator?, to? }
    // Each value is resolved via resolveExpr; nulls/undefineds → "".
    // separator defaults to "". `to` defaults to $concat.
    case "CONCAT_STRINGS": {
      const items = Array.isArray(cfg.values) ? cfg.values : [];
      const sep = String(resolveExpr(cfg.separator, $vars) ?? "");
      const out = items
        .map(x => {
          const v = resolveExpr(x, $vars);
          return v == null ? "" : String(v);
        })
        .join(sep);
      $vars[cfg.to || "$concat"] = out;
      break;
    }

    // ---- SLICE_VAR: take a sub-range of an array or string ----
    // cfg: { name, start?, end?, to? } — like `Array.prototype.slice`.
    // Defaults: start=0, end=length. Negative indices count from the end.
    // Writes to `to` (default: same var, mutating in place).
    // Common use: "last 5 entries" via `start: -5`.
    case "SLICE_VAR": {
      const src = $vars[cfg.name];
      const start = Number(resolveExpr(cfg.start, $vars));
      const end = cfg.end !== undefined ? Number(resolveExpr(cfg.end, $vars)) : undefined;
      if (Array.isArray(src) || typeof src === "string") {
        const startIdx = Number.isFinite(start) ? start : 0;
        const sliced = end === undefined || !Number.isFinite(end)
          ? src.slice(startIdx)
          : src.slice(startIdx, end);
        $vars[cfg.to || cfg.name] = sliced;
      }
      break;
    }

    // ---- UNIQUE_VAR: deduplicate an array (Set-style) ----
    // cfg: { name, to?, by? } — `by` optionally names a dotted path on each
    // object to dedupe by (e.g. "id" so [{id:1},{id:1},{id:2}] → 2 entries).
    // Defaults to identity comparison for primitives. Output preserves order
    // of first occurrence. Writes to `to` (default: same var).
    case "UNIQUE_VAR": {
      const src = $vars[cfg.name];
      if (Array.isArray(src)) {
        const byPath = cfg.by ? String(cfg.by) : null;
        const getKey = byPath
          ? (v) => byPath.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), v)
          : (v) => v;
        const seen = new Set();
        const out = [];
        for (const item of src) {
          const k = getKey(item);
          // Objects/arrays from non-trivial `by` paths still hash by their
          // string form — primitives just hash directly.
          const hash = (k != null && typeof k === "object") ? JSON.stringify(k) : k;
          if (seen.has(hash)) continue;
          seen.add(hash);
          out.push(item);
        }
        $vars[cfg.to || cfg.name] = out;
      }
      break;
    }

    // ---- REVERSE_VAR: reverse an array or string in place ----
    // cfg: { name, to? } — like `Array.prototype.reverse` (or string reverse).
    case "REVERSE_VAR": {
      const src = $vars[cfg.name];
      if (Array.isArray(src)) {
        $vars[cfg.to || cfg.name] = [...src].reverse();
      } else if (typeof src === "string") {
        $vars[cfg.to || cfg.name] = src.split("").reverse().join("");
      }
      break;
    }

    // ---- STREAK_VAR: consecutive-days-backward count ----
    // cfg: { name, by?, to?, today? } — given an array of dated rows, count
    // the number of consecutive days (going backward from `today`) where AT
    // LEAST ONE row's date matches. `by` is the dotted path to the date
    // value on each row (defaults to "date"). `today` overrides $today.
    //
    // Use case: "Current Streak" trackers — pass an array of completed-task
    // rows with their dates, get back the streak length. Pure computation,
    // no I/O. Stops at the first missing day.
    case "STREAK_VAR": {
      const src = $vars[cfg.name];
      const byPath = cfg.by ? String(cfg.by) : "date";
      const todayStr = resolveExpr(cfg.today, $vars) ?? $vars.$today;
      if (!Array.isArray(src) || src.length === 0 || !todayStr) {
        $vars[cfg.to || "$streak"] = 0;
        break;
      }
      // Extract and normalize dates to YYYY-MM-DD strings.
      const datesSet = new Set();
      for (const row of src) {
        if (row == null) continue;
        const raw = byPath.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), row);
        if (!raw) continue;
        const s = typeof raw === "string" ? raw.slice(0, 10) : null;
        if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) datesSet.add(s);
      }
      // Walk backward from today, count consecutive days present.
      const parseYMD = (s) => {
        const [y, m, d] = s.split("-").map(Number);
        return new Date(y, m - 1, d);
      };
      const formatYMD = (d) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const dd = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${dd}`;
      };
      let streak = 0;
      const cur = parseYMD(todayStr);
      if (Number.isNaN(cur.getTime())) {
        $vars[cfg.to || "$streak"] = 0;
        break;
      }
      // Safety cap at 3650 days (~10 years). Streaks longer than that
      // are vanishingly rare and would suggest bad input data.
      for (let i = 0; i < 3650; i++) {
        if (datesSet.has(formatYMD(cur))) {
          streak++;
          cur.setDate(cur.getDate() - 1);
        } else {
          break;
        }
      }
      $vars[cfg.to || "$streak"] = streak;
      break;
    }

    // ──────────────────────────────────────────────────────────────────────
    // Numeric aggregators over arrays. cfg: { name, by?, to? }
    //   name — source array var
    //   by   — optional dotted path to extract a numeric value from each
    //          element (defaults to identity — assumes elements are numbers)
    //   to   — destination var (defaults to $sum / $min / $max / $avg)
    // All four short-circuit cleanly on non-arrays (write 0 / null).
    // Pattern saves the LOOP+ADD_TO_VAR boilerplate for the common case.
    // ──────────────────────────────────────────────────────────────────────
    case "SUM_VAR":
    case "MIN_VAR":
    case "MAX_VAR":
    case "AVG_VAR": {
      const src = $vars[cfg.name];
      const byPath = cfg.by ? String(cfg.by) : null;
      const pick = byPath
        ? (v) => {
            const r = byPath.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), v);
            return typeof r === "number" ? r : Number(r);
          }
        : (v) => (typeof v === "number" ? v : Number(v));
      const defaultName =
        type === "SUM_VAR" ? "$sum" :
        type === "MIN_VAR" ? "$min" :
        type === "MAX_VAR" ? "$max" : "$avg";
      if (!Array.isArray(src) || src.length === 0) {
        // Empty / missing → 0 for SUM/AVG, null for MIN/MAX (no meaningful answer).
        $vars[cfg.to || defaultName] =
          (type === "SUM_VAR" || type === "AVG_VAR") ? 0 : null;
        break;
      }
      const nums = src.map(pick).filter((n) => Number.isFinite(n));
      if (nums.length === 0) {
        $vars[cfg.to || defaultName] =
          (type === "SUM_VAR" || type === "AVG_VAR") ? 0 : null;
        break;
      }
      let result;
      if (type === "SUM_VAR") result = nums.reduce((a, b) => a + b, 0);
      else if (type === "MIN_VAR") result = Math.min(...nums);
      else if (type === "MAX_VAR") result = Math.max(...nums);
      else /* AVG_VAR */ {
        const sum = nums.reduce((a, b) => a + b, 0);
        // Two-decimal rounding to match DIV_VAR's precision convention.
        result = Math.round((sum / nums.length) * 100) / 100;
      }
      $vars[cfg.to || defaultName] = result;
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

      // Task #30 follow-up — FIND auto-detects: returns the bare item when
      // there's exactly one match, the full array when there are multiple,
      // null when no matches. Authors that need an array-of-one for shape
      // consistency can set `cfg.multiple: true` to force-array.
      const forceArray = cfg.multiple === true;
      const result = forceArray
        ? candidates
        : (candidates.length > 1 ? candidates : (candidates[0] || null));
      if (cfg.itemVar) $vars[cfg.itemVar] = result;
      if (cfg.itemIdVar) {
        $vars[cfg.itemIdVar] = forceArray
          ? candidates.map(c => c.id)
          : (candidates.length > 1
              ? candidates.map(c => c.id)
              : (candidates[0]?.id ?? null));
      }
      break;
    }

    // ---- CREATE: mint template (idempotent on label) + instance ----
    // cfg: { name, role?, kind?, meta?, parent?, date?: { fieldId, value },
    //        fields?, textmap?, insertAtIndex?, itemIdVar?, itemVar? }
    case "CREATE": {
      // ── Multiple mode (task #30) ──────────────────────────────────────
      // When `cfg.multiple === true`, CREATE acts as bulk creator: it expects
      // `cfg.rows: [{name|label, fields?, meta?, itemIdVar?, itemVar?}]` and
      // creates one occurrence per row. Base cfg keys (role/kind/parent/...)
      // apply to every row; per-row fields/meta merge on top of base fields/
      // meta. Result var (if set) binds to the array of created ids.
      // Same-kind constraint per user direction — only label/fields/meta
      // vary per row.
      if (cfg.multiple === true) {
        const rows = Array.isArray(cfg.rows) ? cfg.rows : [];
        if (rows.length === 0) break;
        const { rows: _ignored, name: baseName, label: baseLabel, fields: baseFields, meta: baseMeta, multiple: _m, ...base } = cfg;
        const createdIds = [];
        for (const row of rows) {
          if (!row || typeof row !== "object") continue;
          const rowName = row.name ?? row.label ?? baseName ?? baseLabel;
          if (!rowName) continue;
          const rowCfg = {
            ...base,
            name: rowName,
            fields: { ...(baseFields || {}), ...(row.fields || {}) },
            meta:   { ...(baseMeta   || {}), ...(row.meta   || {}) },
            itemIdVar: row.itemIdVar || null,
            itemVar:   row.itemVar   || null,
          };
          const rowUpdates = executeActionItem("CREATE", rowCfg, $vars, context, transaction);
          if (Array.isArray(rowUpdates) && rowUpdates.length > 0) {
            updates.push(...rowUpdates);
            const created = rowUpdates.find(u => u?._effect === "CREATE_ITEM");
            if (created?.instance?.id) createdIds.push(created.instance.id);
          }
        }
        if (cfg.resultVar) $vars[cfg.resultVar] = createdIds;
        break;
      }

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

      let parentId = resolveExpr(cfg.parent, $vars) ?? null;
      // FIND auto-returns an array on multi-match; coerce to first id so
      // Mongoose doesn't reject parentId as an Array.
      if (Array.isArray(parentId)) parentId = parentId[0] ?? null;

      // Per-occurrence filterOverride for the new instance. Each value is
      // resolved through resolveExpr so authors can write
      // `filterOverride: { [dateFieldId]: "$day" }` and have $day land as
      // the iteration's resolved date string. Without this, day-cols minted
      // by Build Schedule inherit the page's multi-day filter and end up
      // showing all the selected days' tasks instead of just their own.
      const filterOverride = cfg.filterOverride && typeof cfg.filterOverride === "object"
        ? Object.fromEntries(
            Object.entries(cfg.filterOverride).map(([k, v]) => {
              const rv = resolveExpr(v, $vars);
              return [k, rv === undefined ? v : rv];
            })
          )
        : null;

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
        ...(filterOverride ? { filterOverride } : {}),
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
          ...(filterOverride ? { filterOverride } : {}),
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
          ...(filterOverride ? { filterOverride } : {}),
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
        // cfg.linked === false → "shared-module copy" mode: new occurrence
        // reuses the source's module but carries NO linkedGroupId. Field
        // writes don't fan out across the group. Use when you want a fresh
        // independent placement (e.g. per-day routine instance) that still
        // benefits from a shared module label/bindings.
        const linkSiblings = cfg.linked !== false;
        let linkedGroupId = linkSiblings ? (src.linkedGroupId || null) : null;
        let mintedNewLink = false;
        if (linkSiblings && !linkedGroupId) {
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

        // filterOverride applies to ROOT only — typical caller intent is
        // "this clone has its own per-day filter; descendants inherit".
        let rootFilterOverride = null;
        if (isRoot && cfg.filterOverride && typeof cfg.filterOverride === "object") {
          rootFilterOverride = {};
          for (const [fid, expr] of Object.entries(cfg.filterOverride)) {
            const v = resolveExpr(expr, $vars);
            if (v != null) rootFilterOverride[fid] = v;
          }
        }

        const newId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

        // Recurse into children FIRST so we can inline their ids into our
        // CREATE_ITEM emit. Each child's own linkedGroupId pairs that child
        // with src.occurrences[i] independently. cfg.recursive === false
        // skips the walk (root-only clone — useful when the caller wants
        // to add a per-day instance set manually).
        const childIds = [];
        if (cfg.recursive !== false) {
          for (const childOccId of (src.occurrences || [])) {
            const childSrc = findSource(childOccId);
            if (!childSrc) continue;
            const childResult = linkOne(childSrc, newId, false, depth + 1);
            if (childResult?.newId) childIds.push(childResult.newId);
          }
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
        // Root may override its label via cfg.label (resolveExpr supports
        // template interpolation, e.g. "Schedule - ${dateLong:$day}").
        // Children inherit from source.
        const rootLabelOverride = isRoot && cfg.label != null
          ? resolveExpr(cfg.label, $vars)
          : null;
        const label = rootLabelOverride ?? src.label ?? tpl?.label ?? tpl?.name ?? null;

        // Root may seed meta atomically at create time via cfg.meta (leaves
        // deep-resolved). Used by Canvas: Build to stamp meta.x/y on the new
        // card in the SAME create — a follow-up `UPDATE $copy.meta.x` raced the
        // create (the update targeted an occurrence the server hadn't persisted
        // yet) and silently dropped the position, so every card piled at the
        // same spot.
        const rootMeta = isRoot && cfg.meta && typeof cfg.meta === "object"
          ? deepResolveExpr(cfg.meta, $vars)
          : null;
        const baseMeta = { createdByOperation: true, copyLinkSource: src.id, ...(rootMeta || {}) };

        const stub = {
          id: newId,
          moduleId: srcMod,
          parentId: targetParentId,
          fields,
          linkedGroupId,
          role,
          label,
          meta: { ...baseMeta },
          _ancestors: newAncestors,
          occurrences: childIds,
          ...(rootFilterOverride ? { filterOverride: rootFilterOverride } : {}),
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
            meta: { ...baseMeta },
            occurrences: childIds,
            ...(rootFilterOverride ? { filterOverride: rootFilterOverride } : {}),
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
            // Persist a discoverable "this is a copy of <src.id>" marker
            // so idempotency FINDs in op pipelines can match on
            // `meta.copyLinkSource IS $sourceId` directly — without
            // requiring the op author to know the `lg-<id>` linkedGroupId
            // derivation rule. The local stub already carries this in
            // memory; including it in the CREATE_ITEM instance pushes it
            // through to bindSocketToStore's create_occurrence emit so
            // it persists to Mongo. `baseMeta` also folds in any cfg.meta
            // (e.g. Canvas: Build's x/y) so position is set atomically at
            // create time instead of via a racy follow-up UPDATE.
            meta: { ...baseMeta },
            ...(rootLabelOverride ? { label: rootLabelOverride } : {}),
            ...(rootFilterOverride ? { filterOverride: rootFilterOverride } : {}),
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
      let rootParentId = resolveExpr(cfg.parent, $vars) ?? null;
      // FIND auto-returns an array when multiple records match; pick the
      // first id so Mongoose doesn't reject parentId as an Array.
      if (Array.isArray(rootParentId)) rootParentId = rootParentId[0] ?? null;
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
    // cfg: { itemIdExpr } OR { multiple: true, ids | idsExpr }
    case "DELETE": {
      if (cfg.multiple === true) {
        const raw = cfg.ids ?? resolveExpr(cfg.idsExpr, $vars);
        const ids = Array.isArray(raw) ? raw : [];
        for (const id of ids) {
          if (!id) continue;
          updates.push({ _effect: "DELETE_ITEM", itemId: id });
        }
        break;
      }
      const itemId = resolveExpr(cfg.itemIdExpr, $vars);
      if (itemId) updates.push({ _effect: "DELETE_ITEM", itemId });
      break;
    }

    case "NOTIFY": {
      // cfg: { message, sound?, duration? } — message resolves $vars; sound
      // rings the synthesized alarm (the Alarms tab's "alarm" type); duration
      // overrides the default toast lifetime (alarms linger, reminders less).
      const message = resolveExpr(cfg.message, $vars);
      if (message) toast(message, "duration" in cfg ? { duration: cfg.duration } : {});
      if (cfg.sound) ringAlarm();
      break;
    }

    case "SHOW_VALUE": {
      // Stage a named value to return to the caller. Two consumers:
      //   1. The /api/v1/operations/:id/run bridge surfaces every
      //      SHOW_VALUE effect under `vars` in the JSON response (see
      //      bindSocketToStore.js onRunOpForApi).
      //   2. The OperationLogPanel can render them as "result" rows.
      // cfg: { name, value } — name auto-prefixes "$" if missing,
      // value is run through resolveExpr.
      const rawName = cfg.name || "$result";
      const name = String(rawName).startsWith("$") ? String(rawName) : `$${rawName}`;
      const value = resolveExpr(cfg.value, $vars);
      updates.push({ _effect: "SHOW_VALUE", name, value });
      break;
    }

    case "GET_USER_INPUT": {
      // Suspend sentinel — executeSteps detects this, captures the remaining
      // steps as a continuation, and dispatches the request to
      // operationsBridge.requestUserInput. When the user submits, the
      // continuation resumes with the answer placed at $vars[resultVar]
      // (default "$userInput"). Downstream steps can resolveExpr against it
      // for chained question flows.
      //
      // cfg:
      //   question      — string with $var interpolation ("How long? $foo")
      //   inputType     — "text" | "number" | "select" | "boolean" | "date"
      //   options       — array of {value,label} or strings (for select)
      //   defaultValue  — initial value in the modal
      //   resultVar     — name of the $var to bind on resume (default "$userInput")
      //   title         — optional modal title
      const question = resolveExpr(cfg.question, $vars);
      const defaultValue = resolveExpr(cfg.defaultValue, $vars);
      const options = Array.isArray(cfg.options)
        ? cfg.options.map((o) => (typeof o === "string" ? { value: o, label: o } : o))
        : null;
      return [{
        _suspend: true,
        request: {
          question: question == null ? "" : String(question),
          inputType: cfg.inputType || "text",
          options,
          defaultValue,
          title: cfg.title || null,
        },
        resultVar: cfg.resultVar || "$userInput",
      }];
    }

    case "CALL_API": {
      // Outbound HTTP from a pipeline. Per docs/api-plan.md §2. Suspends
      // the pipeline (same _suspend pattern GET_USER_INPUT uses), the
      // executor's _handleSuspend awaits the response, then resumes with
      // the parsed body bound to `cfg.responseVar` (default "$apiResponse").
      //
      // cfg:
      //   url            — request URL ($var interpolation supported)
      //   method         — GET / POST / PUT / PATCH / DELETE (default GET)
      //   headers        — object; values resolved through $vars
      //   body           — object → JSON.stringify; string → sent as-is
      //   query          — object → URL-encoded query string
      //   timeoutMs      — default 10000, max 60000
      //   responseVar    — pipeline var to bind on resume (default "$apiResponse")
      //   onError        — "fail" (default; abort pipeline) | "continue" (bind error to errorVar and proceed)
      //   errorVar       — var to bind the error to when onError === "continue" (default "$apiError")
      //
      // Slice 1 lives in the browser. Phase 3 moves it to a server-side
      // executor for secrets + cross-origin.
      const url = resolveExpr(cfg.url, $vars);
      if (!url) break;
      const method = String(resolveExpr(cfg.method || "GET", $vars) || "GET").toUpperCase();
      const headers = deepResolveExpr(cfg.headers || {}, $vars);
      const query = deepResolveExpr(cfg.query || {}, $vars);
      const body = cfg.body != null ? deepResolveExpr(cfg.body, $vars) : null;
      const timeoutMs = Math.min(60000, Math.max(1000, Number(cfg.timeoutMs) || 10000));
      const responseVar = cfg.responseVar || "$apiResponse";
      const onError = cfg.onError === "continue" ? "continue" : "fail";
      const errorVar = cfg.errorVar || "$apiError";

      const finalUrl = (() => {
        const qs = Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(typeof v === "object" ? JSON.stringify(v) : String(v))}`)
          .join("&");
        if (!qs) return String(url);
        return String(url) + (String(url).includes("?") ? "&" : "?") + qs;
      })();

      const init = { method, headers: { ...headers } };
      if (body != null && method !== "GET") {
        init.body = typeof body === "string" ? body : JSON.stringify(body);
        if (typeof body !== "string" && !init.headers["Content-Type"]) {
          init.headers["Content-Type"] = "application/json";
        }
      }

      // Suspend sentinel — executor sees this and re-enters with the
      // resolved value. The Promise this returns is awaited by
      // _handleSuspend's `ask(last.request)` chain.
      return [{
        _suspend: true,
        _callApi: true,
        request: {
          fetch: (() => {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), timeoutMs);
            return fetch(finalUrl, { ...init, signal: ctrl.signal })
              .then(async (res) => {
                clearTimeout(timer);
                const contentType = res.headers.get("content-type") || "";
                const parsed = contentType.includes("application/json")
                  ? await res.json().catch(() => null)
                  : await res.text();
                if (!res.ok) {
                  if (onError === "continue") {
                    return { __apiError: true, status: res.status, body: parsed };
                  }
                  throw new Error(`CALL_API ${method} ${finalUrl} → ${res.status}`);
                }
                return parsed;
              })
              .catch((err) => {
                clearTimeout(timer);
                if (onError === "continue") {
                  return { __apiError: true, status: 0, message: String(err?.message || err) };
                }
                throw err;
              });
          })(),
        },
        resultVar: responseVar,
        errorVar,
        onError,
      }];
    }

    case "IMPORT_HTML":
    case "IMPORT_MARKDOWN": {
      // Pipe arbitrary HTML or markdown through the server-side
      // importer (server/services/markdownImporter.js, fronted by the
      // `import_text` socket handler) and bind the resulting root
      // occurrence id to a $var so downstream steps can MOVE / UPDATE
      // against the imported subtree.
      //
      // cfg (both actions):
      //   html OR markdown — the source content ($var interpolation supported)
      //   parentExpr       — destination parent occurrence id ($expr)
      //                       null/missing → server creates as a top-level
      //                       grid-level entity
      //   title            — root container label (default "Imported")
      //   htmlOpts         — { keepImages, keepTables, keepFigures, stripClasses }
      //                       only consumed when format === "html"
      //   timeoutMs        — Promise timeout, default 60s, max 120s
      //   resultVar        — $var to bind { rootOccurrenceId, stats, detectedFormat }
      //                       on resume (default "$importResult")
      //   errorVar         — $var to bind the error to when onError === "continue"
      //                       (default "$importError")
      //   onError          — "fail" (default) | "continue"
      //
      // Reuses the executor's _callApi suspend path (any ready Promise
      // attached via request.fetch) — see operationExecutor._handleSuspend.
      const format = type === "IMPORT_HTML" ? "html" : "markdown";
      const content = resolveExpr(format === "html" ? cfg.html : cfg.markdown, $vars);
      if (!content) break;
      const parentId = cfg.parentExpr ? resolveExpr(cfg.parentExpr, $vars) : null;
      const title = cfg.title ? resolveExpr(cfg.title, $vars) : "Imported";
      const htmlOpts = format === "html" ? (deepResolveExpr(cfg.htmlOpts || {}, $vars) || {}) : {};
      const timeoutMs = Math.min(120000, Math.max(1000, Number(cfg.timeoutMs) || 60000));
      const resultVar = cfg.resultVar || "$importResult";
      const errorVar = cfg.errorVar || "$importError";
      const onError = cfg.onError === "continue" ? "continue" : "fail";

      // Suspend sentinel — executor's _handleSuspend detects `_importText`
      // and invokes operationsBridge.importText with this request shape.
      return [{
        _suspend: true,
        _importText: true,
        request: { content: String(content), format, parentId, title, htmlOpts, timeoutMs },
        resultVar,
        errorVar,
        onError,
      }];
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
      const toContainerId = cfg.toContainerId || resolveExpr(cfg.toContainerIdExpr, $vars);
      if (!toContainerId) break;
      // Multiple mode (task #30) — `cfg.multiple === true` expects an
      // `cfg.ids: string[]` array (or `cfg.idsExpr` resolving to one).
      if (cfg.multiple === true) {
        const raw = cfg.ids ?? resolveExpr(cfg.idsExpr, $vars);
        const ids = Array.isArray(raw) ? raw : [];
        for (const id of ids) {
          if (!id) continue;
          updates.push({ _effect: "MOVE_OCCURRENCE", occurrenceId: id, toContainerId });
        }
        break;
      }
      const occId = resolveExpr(cfg.occurrenceIdExpr || "$trigger.occurrenceId", $vars);
      if (occId) {
        updates.push({ _effect: "MOVE_OCCURRENCE", occurrenceId: occId, toContainerId });
      }
      break;
    }

    case "REMOVE_OCCURRENCE": {
      if (cfg.multiple === true) {
        const raw = cfg.ids ?? resolveExpr(cfg.idsExpr, $vars);
        const ids = Array.isArray(raw) ? raw : [];
        for (const id of ids) {
          if (!id) continue;
          updates.push({ _effect: "REMOVE_OCCURRENCE", occurrenceId: id });
        }
        break;
      }
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

    // ---- DATE_ADD: add an amount of time to a base date ----
    // cfg: {
    //   base?: expr        — base date (default "$today"). ISO string, Date, or $expr.
    //   amount?: expr      — number of units to add (default 1).
    //   unit?: "day"|"week"|"month"|"year"  — default "day". Can be an expr.
    //   setDay?: expr      — optional. For month/year units: snap day-of-month BEFORE adding.
    //                          For week units: snap forward to that day-of-week (1=Mon..7=Sun).
    //   advanceUntil?: expr — optional date expr. While result <= advanceUntil, keep adding.
    //                          Lets a single step roll a cycle anchor to the next future date.
    //   resultVar?: string  — bind the resulting ISO date to $vars[resultVar].
    //   targetFieldId?: string         — also emit a field write effect.
    //   targetOccurrenceIdExpr?: expr  — required with targetFieldId.
    // ---- DATE_FORMAT: format an ISO date into a human-readable string ----
    // cfg: { date, format?, to? }
    //   date    — ISO date string or $expr resolving to one
    //   format  — token string. Supported tokens (subset of CLDR):
    //               yyyy   four-digit year (2026)
    //               yy     two-digit year (26)
    //               MMMM   full month name (May)
    //               MMM    abbreviated month (May)
    //               MM     two-digit month (05)
    //               M      month number (5)
    //               dd     two-digit day (07)
    //               d      day number (7)
    //               EEEE   full weekday (Monday)
    //               EEE    abbreviated weekday (Mon)
    //             Default: "EEE MMM d" → "Mon May 5"
    //   to      — destination var, default $formatted
    case "DATE_FORMAT": {
      const raw = resolveExpr(cfg.date, $vars);
      if (!raw) {
        $vars[cfg.to || "$formatted"] = "";
        break;
      }
      // Parse `YYYY-MM-DD` as LOCAL midnight (not UTC) so a date-only
      // string doesn't slide a day back in negative-UTC timezones.
      let d;
      if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const [y, m, day] = raw.split("-").map(Number);
        d = new Date(y, m - 1, day);
      } else {
        d = new Date(raw);
      }
      if (Number.isNaN(d.getTime())) {
        $vars[cfg.to || "$formatted"] = String(raw);
        break;
      }
      const format = String(resolveExpr(cfg.format, $vars) ?? "EEE MMM d");
      const MONTHS_LONG = ["January","February","March","April","May","June","July","August","September","October","November","December"];
      const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const WEEKDAYS_LONG = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
      const WEEKDAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      const pad2 = (n) => String(n).padStart(2, "0");
      // Two-pass token replacement using sentinels to prevent shorter
      // tokens (M / d) from matching letters inside already-substituted
      // month / weekday names (e.g. "May" contains 'M' / 'a' / 'y').
      const SENT = "\x01"; // non-printing placeholder
      const subs = [
        { tok: /yyyy/g, val: String(d.getFullYear()) },
        { tok: /yy/g,   val: pad2(d.getFullYear() % 100) },
        { tok: /MMMM/g, val: MONTHS_LONG[d.getMonth()] },
        { tok: /MMM/g,  val: MONTHS_SHORT[d.getMonth()] },
        { tok: /MM/g,   val: pad2(d.getMonth() + 1) },
        { tok: /M/g,    val: String(d.getMonth() + 1) },
        { tok: /dd/g,   val: pad2(d.getDate()) },
        { tok: /d/g,    val: String(d.getDate()) },
        { tok: /EEEE/g, val: WEEKDAYS_LONG[d.getDay()] },
        { tok: /EEE/g,  val: WEEKDAYS_SHORT[d.getDay()] },
      ];
      // Pass 1: replace each token with a sentinel-wrapped index.
      let out = format;
      for (let i = 0; i < subs.length; i++) {
        out = out.replace(subs[i].tok, `${SENT}${i}${SENT}`);
      }
      // Pass 2: swap sentinels for the real values. No further token regex
      // can match a value's letters because they're sealed off by sentinels.
      out = out.replace(new RegExp(`${SENT}(\\d+)${SENT}`, "g"), (_, idx) => subs[Number(idx)].val);
      $vars[cfg.to || "$formatted"] = out;
      break;
    }

    case "DATE_ADD": {
      const baseRaw = resolveExpr(cfg.base ?? "$today", $vars);
      if (!baseRaw) break;
      const result = new Date(baseRaw);
      if (isNaN(result.getTime())) break;
      result.setHours(12, 0, 0, 0);

      const amount = Number(resolveExpr(cfg.amount ?? 1, $vars));
      if (!Number.isFinite(amount)) break;
      const unit = String(resolveExpr(cfg.unit ?? "day", $vars) ?? "day");

      const setDay = cfg.setDay !== undefined ? Number(resolveExpr(cfg.setDay, $vars)) : NaN;
      if (Number.isFinite(setDay) && (unit === "month" || unit === "year")) {
        result.setDate(setDay);
      } else if (Number.isFinite(setDay) && unit === "week") {
        // 1=Mon..7=Sun -> JS getDay (0=Sun..6=Sat) normalized to Mon=0..Sun=6
        const targetDow = ((setDay - 1) % 7 + 7) % 7;
        const currentDow = (result.getDay() + 6) % 7;
        result.setDate(result.getDate() + ((targetDow - currentDow + 7) % 7));
      }

      const advance = (d) => {
        if (unit === "day")        d.setDate(d.getDate() + amount);
        else if (unit === "week")  d.setDate(d.getDate() + amount * 7);
        else if (unit === "month") d.setMonth(d.getMonth() + amount);
        else if (unit === "year")  d.setFullYear(d.getFullYear() + amount);
      };
      advance(result);

      if (cfg.advanceUntil !== undefined) {
        const limitRaw = resolveExpr(cfg.advanceUntil, $vars);
        if (limitRaw) {
          const limit = new Date(limitRaw);
          if (!isNaN(limit.getTime())) {
            limit.setHours(12, 0, 0, 0);
            // Bail when an iteration doesn't move the result (amount === 0
            // or any degenerate input) instead of grinding through the
            // safety counter. Cap raised to 5000 so a multi-year daily
            // advance can finish (730 iters for 2 years, etc.).
            let safety = 5000;
            while (result <= limit && safety-- > 0) {
              const prevTime = result.getTime();
              advance(result);
              if (result.getTime() === prevTime) break;
            }
          }
        }
      }

      const resultIso = result.toISOString();
      if (cfg.resultVar) $vars[cfg.resultVar] = resultIso;
      if (cfg.targetFieldId) {
        const occId = resolveExpr(cfg.targetOccurrenceIdExpr ?? cfg.targetOccurrenceId, $vars);
        if (occId) updates.push({ fieldId: cfg.targetFieldId, occurrenceId: occId, value: resultIso });
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
    // `poolContainerId` accepted as legacy alias (see fieldsByOptionsSource
    // unification and BUGS.md #21).
    case "ADD_TO_POOL": {
      const poolId = resolveExpr(cfg.poolId ?? cfg.poolContainerId, $vars);
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
      const poolId = resolveExpr(cfg.poolId ?? cfg.poolContainerId, $vars);
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
