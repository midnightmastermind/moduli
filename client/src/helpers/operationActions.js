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
import { applyUpdate } from "./applyUpdate";
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
      } else if (cfg.value !== null && typeof cfg.value === "object" && !Array.isArray(cfg.value)) {
        value = cfg.value;
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
        const mod = state?.modulesById?.[modId];
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
        const mod = (context.state?.modulesById || {})[pickedOcc.moduleId];
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
