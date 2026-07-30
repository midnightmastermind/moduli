// blocks/operationExecutor.js
// ============================================================
// Runtime executor for the Operations pipeline
//
// Architecture:
//   Transaction fires → shouldTrigger() check → executeOperation()
//   → evaluates blockTree (reporters) or runs statements (ACTION blocks)
//   → returns [{ fieldId, occurrenceId?, value }] updates
//
// computedValues key convention:
//   "fieldId"           — global / grid-level aggregation
//   "fieldId:occId"     — occurrence-specific display value
// ============================================================

import { BlockType } from "./blockTypes";
import { evaluateBlock } from "./blockEvaluator";
import { applyAggregation } from "./CalculationHelpers";
import { resolveExpr, evalGroup, extractFieldValuesFiltered, executeActionItem, resolveRecordPath, evalRuleAgainstRecord, evalGroupAgainstRecord } from "./operationActions";
import { buildParentMap } from "./dragHitTesting";
import { isEventCompatible } from "./triggerTypes";
import { getEffectiveFilterForOccurrence, makeEffectiveFilterResolver } from "../state/selectors";
import { operationsBridge } from "../state/bindSocketToStore";
import { analyzeAllOperations } from "./operationIntrospection";
import { applyDisplayRules } from "./displayRules";

// ============================================================
// RUN LOG — per-operation run history for the editor's log panel
// ============================================================
// Module-level store: each op keeps a capped history of its recent runs
// (live-run from the Run button OR trigger-fired). Subscribers (OperationEditor)
// get notified when a new run is appended.

const RUN_HISTORY_LIMIT = 20;            // newest first; oldest evicted past cap
const runHistory = new Map();            // Map<opId, RunLog[]>
const logSubscribers = new Map();        // Map<opId, Set<fn>>

// Walk an occurrence's ancestor chain and return the merged effective filter
// values. Closer ancestors win over distant ones; grid.activeFilterValues acts
// as the floor. Public so callers outside the executor (tests, panels) can
// share the same resolution.
export function effectiveFilterFor(occurrenceId, { occurrencesById = {}, gridFilters = null, parentByChildId = null } = {}) {
  const occ = occurrencesById[occurrenceId];
  if (!occ) return {};
  const merged = { ...(gridFilters || {}) };
  // Parent linkage is authoritative via parent.occurrences[], not `parentId`
  // (see selectors.getParentOccurrence). One shared reverse-map builder.
  const pbc = parentByChildId || buildParentMap(occurrencesById);
  const seen = new Set();
  let cur = occ;
  let depth = 0;
  const chain = [];
  while (cur && !seen.has(cur.id) && depth++ < 20) {
    seen.add(cur.id);
    chain.push(cur);
    const nextId = pbc[cur.id] ?? cur.parentId;
    cur = nextId ? occurrencesById[nextId] : null;
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const override = chain[i].filterOverride;
    if (override == null) continue;
    if (Object.keys(override).length === 0) {
      for (const k of Object.keys(merged)) delete merged[k];
      continue;
    }
    Object.assign(merged, override);
  }
  return merged;
}

export function getOpRunHistory(opId) {
  return runHistory.get(opId) || [];
}

// Browser-console accessor — paste-friendly run-log dumps without needing
// the in-app OperationLogPanel. Resolves ops by name (case-insensitive
// substring match) against window.__moduli_state__.operations so callers
// don't have to chase opIds. Returns a structured-clone-safe JSON dump.
//
// Usage from devtools:
//   __moduli_runs("Table: Build")          // last 3 runs of that op
//   __moduli_runs("Table: Build", 1)       // most recent run only
//   __moduli_runs()                         // index of all ops that have runs
//
// Pipe the result through JSON.stringify(_, null, 2) and paste.
if (typeof window !== "undefined") {
  window.__moduli_runs = function (opNameOrId, limit = 3) {
    const ops = window.__moduli_state__?.operations || [];
    const byId = new Map(ops.map(o => [o.id, o]));

    // No arg → index summary
    if (opNameOrId == null) {
      const out = [];
      for (const [opId, runs] of runHistory.entries()) {
        const op = byId.get(opId);
        out.push({ name: op?.name || `(unknown ${opId.slice(0, 8)})`, opId, runCount: runs.length, lastRunAt: runs[0]?.runAt ? new Date(runs[0].runAt).toISOString() : null });
      }
      out.sort((a, b) => (b.lastRunAt || "").localeCompare(a.lastRunAt || ""));
      return out;
    }

    // Resolve to opId — try id first, then case-insensitive name substring.
    let opId = byId.has(opNameOrId) ? opNameOrId : null;
    if (!opId) {
      const needle = String(opNameOrId).toLowerCase();
      const matches = ops.filter(o => (o.name || "").toLowerCase().includes(needle));
      if (matches.length === 0) return { error: `no op matches "${opNameOrId}"`, hint: 'call __moduli_runs() with no args to see all ops with runs' };
      if (matches.length > 1) return { error: `multiple ops match "${opNameOrId}"`, candidates: matches.map(o => o.name) };
      opId = matches[0].id;
    }

    const runs = (runHistory.get(opId) || []).slice(0, limit);
    return _shapeOpDump(opId, byId.get(opId)?.name || null, runHistory.get(opId) || [], runs);
  };

  // Trigger a JSON file download of either a single op's runs or ALL ops.
  //
  // Defaults are calibrated to NOT blow Firefox's string allocation limit
  // (~256MB on this machine — `Uncaught InternalError: allocation size
  // overflow` on JSON.stringify if exceeded). With ~70 ops × 20 in-memory
  // runs and per-step varsBefore snapshots of $allItems / $allOccurrences
  // each, a full dump is easily multi-GB. So:
  //   - "All ops" mode (no arg) is COMPACT: 3 runs per op + entries
  //     stripped of `varsBefore` and other heavy payload, just kind +
  //     action.config.type + action.boundVars + effects-by-type summary.
  //   - Single-op mode keeps FULL entries so deep dives stay debuggable.
  //
  // Usage:
  //   __moduli_download_runs()                     compact, all ops, 3 each
  //   __moduli_download_runs(null, 10)             compact, all ops, 10 each
  //   __moduli_download_runs("Table: Build")       FULL data, 20 runs
  //   __moduli_download_runs("Table: Build", 3)    FULL data, last 3 runs
  //   __moduli_download_runs(null, 20, { full: true })  ⚠ may OOM
  window.__moduli_download_runs = function (opNameOrId, limit, opts) {
    const ops = window.__moduli_state__?.operations || [];
    const byId = new Map(ops.map(o => [o.id, o]));
    const isAllOps = opNameOrId == null;
    const lim = Math.max(1, Math.min(Number(limit) || (isAllOps ? 3 : 20), 1000));
    const full = opts?.full === true || !isAllOps; // single-op defaults to full

    const dump = {};
    if (isAllOps) {
      for (const [opId, allRuns] of runHistory.entries()) {
        const op = byId.get(opId);
        dump[op?.name || opId] = _shapeOpDump(opId, op?.name || null, allRuns, allRuns.slice(0, lim), { full });
      }
    } else {
      let opId = byId.has(opNameOrId) ? opNameOrId : null;
      if (!opId) {
        const needle = String(opNameOrId).toLowerCase();
        const matches = ops.filter(o => (o.name || "").toLowerCase().includes(needle));
        if (matches.length === 0) { console.warn(`No op matches "${opNameOrId}"`); return; }
        if (matches.length > 1) { console.warn(`Multiple matches for "${opNameOrId}":`, matches.map(o => o.name)); return; }
        opId = matches[0].id;
      }
      const allRuns = runHistory.get(opId) || [];
      dump[byId.get(opId)?.name || opId] = _shapeOpDump(opId, byId.get(opId)?.name || null, allRuns, allRuns.slice(0, lim), { full });
    }

    // Stringify with try/catch so the user sees a useful message instead
    // of the raw `allocation size overflow` from JSON.stringify.
    let json;
    try {
      json = JSON.stringify(dump, null, 2);
    } catch (err) {
      console.error(
        `[__moduli_download_runs] Output too large to serialize (${err.message}). ` +
        `Try a single op (__moduli_download_runs("Table: Build")) or a smaller limit.`
      );
      return;
    }
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `moduli-runs-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    console.log(`Downloaded ${Object.keys(dump).length} op(s), ${(json.length / 1024).toFixed(1)} KB${full ? "" : " (compact)"}.`);
  };
}

// Private helper used by both __moduli_runs and __moduli_download_runs to
// shape a single op's run history for output (consistent across both
// surfaces). Pulls trigger metadata from the "start" log entry so the
// caller doesn't have to hunt for it.
function _shapeOpDump(opId, opName, allRuns, runs) {
  return {
    opId,
    opName,
    totalRunsInMemory: allRuns.length,
    runs: runs.map(r => {
      // The trigger info is on the "start" log entry, not the run-log
      // top level (RunLog shape is { runAt, durationMs, entries }).
      const startEntry = (r.entries || []).find(e => e.kind === "start") || {};
      return {
        runAt: new Date(r.runAt).toISOString(),
        durationMs: r.durationMs,
        transactionType: startEntry.transactionType || null,
        trigger: startEntry.trigger || null,
        matchedTriggerObject: startEntry.matchedTriggerObject || null,
        entries: r.entries, // full step-by-step log: action / if / loop_iter etc.
      };
    }),
  };
}

// Back-compat: returns the most recent run (or null)

export function subscribeToOpLog(opId, fn) {
  if (!logSubscribers.has(opId)) logSubscribers.set(opId, new Set());
  logSubscribers.get(opId).add(fn);
  return () => logSubscribers.get(opId)?.delete(fn);
}

function recordRunLog(opId, log) {
  if (!opId) return;
  const list = runHistory.get(opId) || [];
  list.unshift(log);
  if (list.length > RUN_HISTORY_LIMIT) list.length = RUN_HISTORY_LIMIT;
  runHistory.set(opId, list);
  logSubscribers.get(opId)?.forEach(fn => { try { fn(list); } catch {} });
}

function makeLogger() {
  return {
    entries: [],
    // Muted while a big loop is past its per-iteration log cap (see the loop
    // branch in executeSteps). Guarding add() too so nested helpers that log
    // via $vars._log directly can't bypass the cap.
    _mute: 0,
    add(kind, data) {
      if (this._mute > 0) return;
      this.entries.push({ kind, t: Date.now(), ...data });
    },
  };
}

// Per-loop cap on fully-logged iterations. Beyond this, a single
// `loop_truncated` marker is written and per-iteration logging (loop_iter +
// every if/action entry inside the body) is muted for the rest of the loop.
// WHY: a tracker loop over $allItems (~2500 items) logged a loop_iter entry
// PLUS a fully-resolved `if` condition snapshot per item, per loop, per op,
// per fire — with runHistory retaining 25 runs/op that compounded to
// GIGABYTES (OOM'd the behavioral suite) and dominated per-fire CPU. The
// first N iterations keep full diagnostics; FIND candidate breakdowns (the
// main "why didn't it match" tool) are unaffected.
const LOOP_LOG_ITER_CAP = 50;

// One bound-fieldIds array per TEMPLATE object. The $allItems enrichment runs
// per item per op fire (incl. the onLoad sweep), and items overwhelmingly share
// templates — a fresh `.map().filter()` per item allocated ~2500 duplicate
// arrays per fire. WeakMap keyed on the template object: a template WRITE
// swaps the object identity, so its cache entry invalidates for free.
const _boundFieldIdsCache = new WeakMap();
function boundFieldIdsFor(tpl) {
  if (!tpl || typeof tpl !== "object") return [];
  let ids = _boundFieldIdsCache.get(tpl);
  if (!ids) {
    ids = (tpl.fieldBindings || []).map(b => b?.fieldId).filter(Boolean);
    _boundFieldIdsCache.set(tpl, ids);
  }
  return ids;
}

// Snapshot user-facing $vars (skip _internal keys + huge built-ins).
// Returned object is a shallow clone — values may still be live references.
const _SNAPSHOT_SKIP = new Set([
  "_log", "_occurrencesById", "_fieldsById",
  "$allItems", "$allOccurrences", "$allContainers", "$allPages", "$allPanels", "$allInstances",
  "$allItemsById", "$allOccurrencesById",
  "$allTemplates", "$allFields", "$allOperations", "$grid",
]);
// Actions whose `cfg.name` is the target $var to mutate (vs CREATE where
// cfg.name is the new item's label). Used by the post-action boundVars
// snapshot to surface what got assigned.
const _VAR_TARGET_ACTIONS = new Set([
  "INIT_VAR", "SET_VAR",
  "ADD_TO_VAR", "SUBTRACT_FROM_VAR", "MULTIPLY_VAR", "DIV_VAR",
  "INCREMENT_VAR", "DECREMENT_VAR", "PUSH_TO_VAR",
]);
function snapshotVars($vars) {
  const out = {};
  for (const k of Object.keys($vars || {})) {
    if (k.startsWith("_") && !k.startsWith("$")) continue;
    if (_SNAPSHOT_SKIP.has(k)) continue;
    out[k] = $vars[k];
  }
  return out;
}

function _isFindAction(actionType) {
  return actionType === "FIND" || actionType === "FIND_OCCURRENCE" || actionType === "FIND_MODULE";
}

// For each record FIND iterated, capture per-rule { left, leftValue, comparator,
// rightValue, matched }. The display panel surfaces this under each FIND row so
// the user can see WHICH rules failed on WHICH records. Sorts by match-score
// desc — best near-misses first; the matched record (if any) is always first.
function collectFindCandidates(cfg, $vars, matchedId) {
  const overExpr = cfg.over || "$allOccurrences";
  const itemList = Array.isArray(resolveExpr(overExpr, $vars)) ? resolveExpr(overExpr, $vars) : [];
  const predicate = cfg.predicate;
  if (!predicate || !Array.isArray(predicate.rules)) return null;

  // Flatten leaf rules — nested groups are evaluated as a whole; show flat
  // breakdowns for the common case (top-level AND of leaf rules).
  const leafRules = predicate.rules.filter(r => r && !r.rules);

  // Build an id→label map from the full item pool so we can resolve each
  // candidate's ancestor IDs to readable names. Multiple occurrences of the
  // same template share a label (every "Drink Water" reads "Drink Water"),
  // so the candidates list looks like duplicates without a parent path.
  const fullPool = $vars.$allItems || $vars.$allOccurrences || [];
  const labelById = new Map();
  for (const item of fullPool) {
    if (item && item.id) labelById.set(item.id, item.label ?? item.name ?? null);
  }

  const evaluated = [];
  for (const record of itemList) {
    if (!record || record.deleted || record.meta?.isTemplate) continue;
    const ruleEvals = leafRules.map(rule => {
      let leftValue;
      try {
        if (_isBareRecordPath(rule.left)) {
          leftValue = resolveRecordPath(record, rule.left);
        } else {
          leftValue = resolveExpr(rule.left, $vars);
        }
      } catch { leftValue = undefined; }
      let rightValue;
      try { rightValue = resolveExpr(rule.right, $vars) ?? rule.right; } catch { rightValue = undefined; }
      let matched = false;
      try { matched = evalRuleAgainstRecord(rule, record, $vars); } catch { matched = false; }
      return { left: rule.left, comparator: rule.comparator, right: rule.right, leftValue, rightValue, matched };
    });
    const score = ruleEvals.filter(r => r.matched).length;
    // _ancestors is closest-first; reverse for breadcrumb display (root → leaf).
    // Drop unresolved ancestors so the path doesn't have gaps.
    const ancestorLabels = (Array.isArray(record._ancestors) ? record._ancestors : [])
      .map(aid => labelById.get(aid))
      .filter(Boolean)
      .reverse();
    evaluated.push({
      id: record.id,
      label: record.label ?? record.name ?? null,
      ancestorLabels,
      score,
      total: leafRules.length,
      isMatched: !!matchedId && record.id === matchedId,
      ruleEvals,
    });
  }

  // Sort: matched record first; then by match score desc; then by id for stability.
  evaluated.sort((a, b) => {
    if (a.isMatched !== b.isMatched) return a.isMatched ? -1 : 1;
    if (a.score !== b.score) return b.score - a.score;
    return String(a.id).localeCompare(String(b.id));
  });
  const totalIterated = evaluated.length;
  return { rules: leafRules.map(r => ({ left: r.left, comparator: r.comparator, right: r.right })), candidates: evaluated, totalIterated };
}

// Bare record paths used by FIND predicates (`templateId`, `_ancestors`,
// `fields.<fid>.value`, `meta.scheduleSlot`, etc.) — no $-prefix and no
// special prefix. resolveExpr would just return these strings literally,
// so the log used to show "templateId IS mod_dw" with the left unresolved.
// When we have a record context (e.g. the record FIND actually matched),
// these paths route through resolveRecordPath instead.
function _isBareRecordPath(s) {
  if (typeof s !== "string" || s === "") return false;
  if (s.startsWith("$") || s.includes("${")) return false;
  if (s.startsWith("literal:") || s.startsWith("json:")) return false;
  if (s.startsWith("occ:") || s.startsWith("field:") || s.startsWith("daysUntil:")) return false;
  return true;
}

// Resolve every leaf rule in a condition group, returning a parallel structure
// with `_leftValue` / `_rightValue` annotations on each rule. Used so the run
// log can show "$preset.moduleLabel" → "Drink Water".
//
// When `record` is provided (FIND with a match, or `$item` inside a loop body),
// bare record paths on the LEFT side resolve against the record. Without a
// record, bare paths resolve via resolveExpr which returns them as literal
// strings — so the log line ends up showing the path itself, not a value.
function resolveGroupForLog(group, $vars, record = null) {
  if (!group || !Array.isArray(group.rules)) return group;
  const rules = group.rules.map(r => {
    if (r.rules) return resolveGroupForLog(r, $vars, record);
    let leftValue, rightValue;
    try {
      if (record && _isBareRecordPath(r.left)) {
        leftValue = resolveRecordPath(record, r.left);
      } else {
        leftValue = resolveExpr(r.left, $vars);
      }
    } catch { leftValue = undefined; }
    try { rightValue = resolveExpr(r.right, $vars) ?? r.right; } catch { rightValue = undefined; }
    return { ...r, _leftValue: leftValue, _rightValue: rightValue };
  });
  return { ...group, rules };
}

// Resolve an action's config field expressions (cfg.parent, cfg.fields values, etc.)
// into a `_resolved` map, so the log can show the actual values used at runtime.
function resolveConfigForLog(cfg, $vars) {
  if (!cfg || typeof cfg !== "object") return null;
  const resolved = {};
  for (const k of Object.keys(cfg)) {
    const v = cfg[k];
    if (typeof v === "string" && v.startsWith("$")) {
      try { resolved[k] = resolveExpr(v, $vars); } catch { /* ignore */ }
    } else if (k === "fields" && v && typeof v === "object") {
      const fr = {};
      for (const fk of Object.keys(v)) {
        const fv = v[fk];
        if (typeof fv === "string" && fv.startsWith("$")) {
          try { fr[fk] = resolveExpr(fv, $vars); } catch { /* ignore */ }
        }
      }
      if (Object.keys(fr).length > 0) resolved.fields = fr;
    }
  }
  return Object.keys(resolved).length > 0 ? resolved : null;
}

// ============================================================
// TRIGGER MATCHING
// ============================================================

/**
 * Determine if an operation should fire for a given transaction type + context.
 * Back-compat boolean wrapper — the batch executor uses computeTriggerMatch
 * directly to thread the matched triggerObject into the run log.
 *
 * An op fires when it is enabled, one of its triggerTypes is compatible with
 * transactionType, AND either (a) it has no triggerObjects for that event,
 * or (b) at least one triggerObject's subject/target filter passes.
 *
 * @param {Object}      operation
 * @param {string|null} transactionType  — "MeasureOp"|"OccurrenceListOp"|"NavigationOp"|null
 * @param {Object}      [transaction]    — the transaction object (for subject/target filtering)
 * @returns {boolean}
 */
export function shouldTrigger(operation, transactionType, transaction) {
  return Boolean(computeTriggerMatch(operation, transactionType, transaction));
}

/**
 * Detailed trigger match — returns the matched triggerObject alongside the decision.
 * Batch executor (runMatchingOperations) uses this to log which triggerObject caused
 * the fire, so the log panel can show "onChange · Field · Water" in RunRow.
 *
 * @returns {false | { matched: true, triggerObject: Object|null }}
 *   triggerObject is the specific entry from op.triggerObjects that matched,
 *   or null when the op fires via event-type compatibility alone (no triggerObjects).
 */
export function computeTriggerMatch(operation, transactionType, transaction) {
  if (!operation?.enabled) return false;

  // An EXPLICITLY EMPTY triggerTypes array means "no event triggers at all" —
  // the seed's schedule-/alarm-managed ops (atTimes alarms, interval slot
  // painters) declare `triggerTypes: []` to fire ONLY via useScheduler.
  // Without this guard the onLoad sweep (transactionType null) matched them,
  // so every page load ran the seeded alarms' NOTIFY inline: a 60s "⏰" toast
  // + ringAlarm() per alarm (audible once the tab has autoplay permission;
  // the user's console showed the pair of AudioContext warnings at load).
  if (Array.isArray(operation.triggerTypes) && operation.triggerTypes.length === 0) return false;

  const types = Array.isArray(operation.triggerTypes)
    ? operation.triggerTypes
    : [operation.triggerType].filter(Boolean);

  // Legacy back-compat: an op with NO trigger config at all (triggerTypes
  // undefined AND no truthy triggerType) still auto-fires on load.
  if (types.length === 0) {
    return transactionType == null ? { matched: true, triggerObject: null } : false;
  }

  for (const t of types) {
    const result = matchesTrigger(t, operation, transactionType, transaction);
    if (result) return result;
  }
  return false;
}

/**
 * Check if a single trigger type matches the current transaction context.
 *
 * Resolution:
 *  - eventType must be compatible with transactionType (e.g. onChange needs MeasureOp).
 *  - If op.triggerObjects contains entries with eventType === t, at least one
 *    must match its subject/target filter.
 *  - If op.triggerObjects has no entries for t, event-type compatibility alone fires.
 *
 * @returns {false | { matched: true, triggerObject: Object|null }}
 */
function matchesTrigger(t, operation, transactionType, transaction) {
  if (!isEventCompatible(t, transactionType, transaction)) return false;

  const triggerObjects = Array.isArray(operation?.triggerObjects) ? operation.triggerObjects : [];
  const forThisEvent = triggerObjects.filter(to => to?.eventType === t);

  if (forThisEvent.length === 0) {
    return { matched: true, triggerObject: null };
  }

  for (const to of forThisEvent) {
    if (!matchSubjectFilter(to, t, transaction)) continue;
    if (!matchAncestorScope(to, t, transaction)) continue;
    return { matched: true, triggerObject: to };
  }
  return false;
}

/**
 * Optional ancestor scoping for event triggers.
 * When `ancestorId` or `ancestorLabel` is set on the trigger object, only fire
 * when the event's source occurrence is the chosen ancestor or one of its own
 * ancestors. Applies to:
 *   - onFilterChange / onNavigation (filter cascade)
 *   - onAdd / onDelete / onMove / onCreate / onRemove (occurrence lifecycle)
 *   - onChange (MeasureOp — when transaction carries _ancestorIds)
 * Transactions without ancestor data (grid-level filter changes, legacy fires
 * that pre-date the enrichment) bypass scoping when no ancestor is declared,
 * and fail-closed when an ancestor IS declared (the trigger explicitly asked
 * for scope; refuse to fire on un-scoped transactions).
 */
function matchAncestorScope(to, eventType, transaction) {
  const { ancestorId, ancestorLabel } = to || {};
  if (!ancestorId && !ancestorLabel) return true;
  const ids = transaction?._ancestorIds || [];
  const labels = transaction?._ancestorLabels || [];
  if (ids.length === 0 && labels.length === 0) return false;
  if (ancestorId && ids.includes(ancestorId)) return true;
  if (ancestorLabel && labels.includes(ancestorLabel)) return true;
  return false;
}

// Gate an event name against the current transaction type and payload
// semantics. Sourced from helpers/triggerTypes.js so the editor and
// runtime never drift out of sync.

/**
 * Evaluate a triggerObject's subject/target filter against the transaction.
 * Empty targetId ("") means "no filter — match any".
 *
 * See docs/superpowers/specs/2026-04-24-operations-editor-fix-design.md §1 for
 * the full subject → filter mapping table.
 */
function matchSubjectFilter(to, eventType, transaction) {
  const { subjectType, subjectRole, targetId } = to || {};

  // A "grid" subject on a filter/navigation trigger means the GLOBAL
  // (toolbar / grid.activeFilterValues) filter ONLY. A local occurrence
  // filterOverride change fires a NavigationOp carrying sourceOccurrenceId +
  // _ancestorIds (CommitHelpers.updateOccurrenceFilterOverride); a true
  // grid/toolbar change (App.jsx / bindSocketToStore onGridUpdated) carries
  // neither. Checked BEFORE the `!targetId` shortcut below, because these
  // triggers use targetId:"" and would otherwise match every filter change —
  // that's why changing the Physical container's date wrongly fired
  // Schedule: Build Day (its grid-subject onFilterChange trigger). Local
  // changes are handled exclusively by subjectType:"filterNav" triggers,
  // scoped further by matchAncestorScope's ancestorLabel.
  if (subjectType === "grid" && (eventType === "onFilterChange" || eventType === "onNavigation")) {
    return !transaction?.sourceOccurrenceId
      && !(Array.isArray(transaction?._ancestorIds) && transaction._ancestorIds.length > 0);
  }

  // Module add/delete with a role but NO specific targetId ("match any of this
  // role"): require the created/deleted occurrence's role to equal subjectRole.
  // This is the fix for the Wikipedia-import flood — an unscoped
  // `subjectRole:"instance"` onAdd trigger used to fire on EVERY occurrence
  // create (textblocks/containers/artifacts from an import all matched), running
  // each tracker's full aggregation per imported node. The new importer creates
  // no instance-role occurrences, so role-matching drops the flood to zero.
  // `_occRole` is stamped in runMatchingOperations; null = unresolved → fall
  // through to the old "match any" behavior so nothing else regresses.
  if (subjectType === "module" && subjectRole && !targetId &&
      (eventType === "onAdd" || eventType === "onDelete" ||
       eventType === "onCreate" || eventType === "onRemove")) {
    if (transaction?._occRole == null) return true;
    return transaction._occRole === subjectRole;
  }

  if (!targetId) return true;

  if (subjectType === "field") {
    // MeasureOps now always carry a `fields: { [fid]: value }` map (coalesced
    // shape — see CommitHelpers + dropHandlers fire sites). Match the trigger
    // when the configured targetId is among the changed fields.
    return !!(transaction?.fields && Object.prototype.hasOwnProperty.call(transaction.fields, targetId));
  }
  if (subjectType === "grid" || subjectType === "filterNav") return true;
  if (subjectType === "module") {
    if (subjectRole === "instance") return transaction?.instanceId === targetId;
    if (subjectRole === "container") {
      if (eventType === "onMove") return transaction?.fromContainerId === targetId;
      return transaction?.containerId === targetId;
    }
    if (subjectRole === "panel") {
      if (eventType === "onCreate" || eventType === "onAdd") {
        if (transaction?.toPanelId != null) return transaction.toPanelId === targetId;
        return transaction?.panelId === targetId;
      }
      if (eventType === "onMove") return transaction?.fromPanelId === targetId;
      return false;
    }
  }
  return true;
}

// ============================================================
// EXTENDED BLOCK EVALUATION
// ============================================================
// Extends the base blockEvaluator with executor-specific features:
// - AGGREGATION blocks support data.allowedFields, data.scope, data.timeFilter, data.flowFilter
// - ACTION blocks collect side-effects (SEND_TO_DISPLAY)
// - TRIGGER_DATA blocks read from the current transaction

/**
 * Evaluate a block, with extended handling for aggregation + action blocks.
 * @param {Object} block
 * @param {Object} ctx  — { state, fieldsById, variables, transaction, actions[] }
 */
function evalBlock(block, ctx) {
  if (!block) return null;

  switch (block.type) {
    // ---- Extended AGGREGATION with allowedFields / scope / timeFilter ----
    case BlockType.AGGREGATION: {
      const {
        aggregation,
        allowedFields,
        scope,
        timeFilter,
        flowFilter,
      } = block.data || {};

      if (!aggregation) return null;

      const { state = {} } = ctx;
      const occurrences = state.occurrences || [];

      // If allowedFields provided, aggregate across all of them
      if (Array.isArray(allowedFields) && allowedFields.length > 0) {
        const allValues = [];
        for (const af of allowedFields) {
          const ff = af.flowFilter || flowFilter || "any";
          const vals = extractFieldValuesFiltered(occurrences, af.fieldId, {
            flowFilter: ff,
            scope,
            timeFilter,
            state,
          });
          allValues.push(...vals);
        }
        return applyAggregation(allValues, aggregation);
      }

      // If a source slot is connected, use the standard evaluator path
      const sourceSlot = block.slots?.find(s => s.id === "source");
      if (sourceSlot?.connected?.type === BlockType.FIELD) {
        const { fieldId } = sourceSlot.connected.data;
        if (!fieldId) return null;
        const vals = extractFieldValuesFiltered(occurrences, fieldId, {
          flowFilter: flowFilter || "any",
          scope,
          timeFilter,
          state,
        });
        return applyAggregation(vals, aggregation);
      }

      return null;
    }

    // ---- TRIGGER_DATA: reads property from the triggering transaction ----
    case "trigger_data": {
      const { property } = block.data || {};
      const tx = ctx.transaction || {};
      return tx[property] ?? null;
    }

    // ---- CONDITION: execute inner blocks as statements ----
    case BlockType.CONDITION: {
      const cond = evalSlot(block, "condition", ctx);
      const branch = Boolean(cond) ? 0 : 1;
      const inner = block.innerSlots?.[branch];
      if (inner?.connected) {
        for (const b of inner.connected) evalBlock(b, ctx);
      }
      return null;
    }

    // ---- LOOP: for each / repeat / while ----
    case BlockType.LOOP: {
      const { loopType } = block.data || {};
      const body = block.innerSlots?.[0]?.connected || [];

      if (loopType === "repeat") {
        const count = Math.min(Math.max(0, Number(evalSlot(block, "count", ctx)) || 0), 10000);
        for (let i = 0; i < count; i++) {
          ctx.variables.__loopIndex = i;
          for (const b of body) evalBlock(b, ctx);
        }

      } else if (loopType === "while") {
        let guard = 0;
        while (guard++ < 10000) {
          const cond = evalSlot(block, "condition", ctx);
          if (!Boolean(cond)) break;
          for (const b of body) evalBlock(b, ctx);
        }

      } else {
        // for each — iterate over a collection (array or field values)
        let collection = evalSlot(block, "collection", ctx);
        if (!Array.isArray(collection)) collection = collection != null ? [collection] : [];
        for (let i = 0; i < Math.min(collection.length, 10000); i++) {
          ctx.variables.__item = collection[i];
          ctx.variables.__index = i;
          for (const b of body) evalBlock(b, ctx);
        }
      }
      return null;
    }

    // ---- HTTP_REQUEST action (fire-and-forget fetch) ----
    case "action": {
      const { actionType, targetFieldId, occurrenceId, method = "POST" } = block.data || {};

      if (actionType === "HTTP_REQUEST") {
        const url = evalSlot(block, "url", ctx);
        const body = evalSlot(block, "body", ctx);
        if (url) {
          // Fire-and-forget: don't await so executor stays synchronous
          try {
            fetch(String(url), {
              method,
              headers: { "Content-Type": "application/json" },
              body: body != null ? JSON.stringify({ value: body }) : undefined,
            }).catch(() => {});
          } catch {}
        }
        return null;
      }

      const value = evalSlot(block, "value", ctx);
      if (actionType === "SEND_TO_DISPLAY" && targetFieldId) {
        const targetNum = evalSlot(block, "target", ctx);
        const targetPeriod = block.data?.targetPeriod || "daily";
        const target = targetNum != null ? { value: Number(targetNum), period: targetPeriod } : null;
        ctx.actions.push({ fieldId: targetFieldId, occurrenceId, value, target });
      }
      return null;
    }

    // ---- Delegate everything else to the base evaluator ----
    default:
      return evaluateBlock(block, {
        state: ctx.state,
        fieldsById: ctx.fieldsById,
        variables: ctx.variables,
      });
  }
}

function evalSlot(block, slotId, ctx) {
  const slot = block.slots?.find(s => s.id === slotId);
  if (!slot?.connected) return null;
  return evalBlock(slot.connected, ctx);
}

// ============================================================
// MAIN EXECUTOR
// ============================================================

/**
 * Execute a single operation against the current state.
 *
 * @param {Object} operation     — operation entity
 * @param {string|null} transactionType — type of event that fired this
 * @param {Object} transaction   — the transaction object (may be null for onLoad)
 * @param {Object} context       — { state, fieldsById, occurrencesById }
 * @returns {Array} updates — [{ fieldId, occurrenceId?, value }]
 */
export function executeOperation(operation, transactionType, transaction, context = {}) {
  const { blockTree, targetFieldId, enabled } = operation;
  if (!enabled) return [];

  const { state = {}, fieldsById = {} } = context;

  // Build execution context
  const execCtx = {
    state,
    fieldsById,
    variables: {},
    transaction: transaction || {},
    actions: [],  // collected ACTION block results
  };

  // Case 1: No blockTree but has targetFieldId → nothing to evaluate
  if (!blockTree) return [];

  // Case 2: blockTree is a REPORTER (returns a value) → send to targetFieldId
  // Note: targets are specified via the target slot in SEND_TO_DISPLAY action blocks.
  // Plain reporter path does not carry target (no target slot available).
  const isReporter = isReporterBlock(blockTree);
  if (isReporter && targetFieldId) {
    const value = evalBlock(blockTree, execCtx);
    return [{ fieldId: targetFieldId, value, target: null }];
  }

  // Case 3: blockTree is a STATEMENT (has side-effects via ACTION blocks)
  // Traverse the block tree and collect all ACTION results (including target from SEND_TO_DISPLAY)
  traverseStatements(blockTree, execCtx);

  // Also handle targetFieldId if the root happens to produce a value
  if (targetFieldId && execCtx.actions.length === 0) {
    const value = evalBlock(blockTree, execCtx);
    if (value !== null && value !== undefined) {
      return [{ fieldId: targetFieldId, value, target: null }];
    }
  }

  return execCtx.actions;
}

/**
 * Check if a block is a reporter (returns a value vs. executes statements).
 */
function isReporterBlock(block) {
  if (!block) return false;
  const reporterTypes = new Set([
    BlockType.FIELD, BlockType.LITERAL, BlockType.VARIABLE,
    BlockType.OPERATOR, BlockType.COMPARISON, BlockType.LOGICAL,
    BlockType.AGGREGATION, BlockType.FUNCTION,
    "trigger_data",
  ]);
  return reporterTypes.has(block.type);
}

/**
 * Walk a block tree executing statements (ACTION, CONDITION, etc).
 */
function traverseStatements(block, ctx) {
  if (!block) return;
  evalBlock(block, ctx);

  // Walk inner slots (C_BLOCK bodies)
  for (const inner of block.innerSlots || []) {
    for (const b of inner.connected || []) {
      traverseStatements(b, ctx);
    }
  }
}

// ============================================================
// BATCH EXECUTOR
// ============================================================

/**
 * Run all enabled operations that match a transaction event.
 * Returns an array of all computed value updates.
 *
 * @param {Array}  operations     — all operations in current grid
 * @param {string|null} transactionType
 * @param {Object|null} transaction
 * @param {Object} context        — { state, fieldsById, occurrencesById }
 * @returns {Array} [{ fieldId, occurrenceId?, value }]
 */
// ── Synchronous self-trigger guard ───────────────────────────────────────────
// An operation must not be re-triggered while its OWN effects are mid-application
// on the current synchronous fire stack. A "rebuild" op (Table/Canvas Build) that
// deletes its own derived rows via DELETE effects would otherwise have each
// delete fire OccurrenceDeleteOp → re-match the same op → delete again →
// exponential fan-out (bounded only by the depth cap → browser freeze). The fire
// layer (bindSocketToStore) marks an op id here for the duration of applying that
// op's effects (spanning nested fires); runMatchingOperations skips any op
// currently in the set. Cross-loops (A→B→A) are covered too: both A and B stay
// marked while their effects are on the stack. This breaks cycles only — a linear
// A→B→C chain (each op once) is untouched, and explicit RUN_OPERATION recursion
// has its own depth cap.
const _opsApplyingEffects = new Set();
export function setOpApplyingEffects(opId, on) {
  if (!opId) return;
  if (on) _opsApplyingEffects.add(opId);
  else _opsApplyingEffects.delete(opId);
}
export function isOpApplyingEffects(opId) {
  return !!opId && _opsApplyingEffects.has(opId);
}

export function runMatchingOperations(operations, transactionType, transaction, context, { onError, onSuccess } = {}) {
  const updates = [];
  // Priority is per-trigger (1–10, default 5). Pre-match every op so we can sort
  // by the priority of the triggerObject that actually matched — an op with two
  // triggers can carry different priorities for each, and the matching one wins.
  // Tiebreaker: sortOrder. Ops that don't match are filtered out before sort.
  // Optional cascade-dedup set (shared across the burst of NavigationOp fires
  // a single filter change emits — one per inheriting descendant). An op that
  // already ran for an earlier transaction in the same cascade is skipped here,
  // so page-rebuild ops (Table: Build, Canvas: Build, Build Schedule — all
  // ancestor-scoped to a page and matching every descendant under it) run ONCE
  // per filter change instead of once per descendant (~50× on the Schedule
  // page). Safe because these ops resolve their working date from
  // operation.targetOccurrenceId, not the triggering occurrence — so which
  // descendant first matched is immaterial. See CommitHelpers.fireOperationsBatch.
  const cascadeFiredOps = context?.cascadeFiredOps || null;

  // Build the occurrences[] reverse map ONCE per sweep — executePipeline used
  // to rebuild it per op (×20 in a drop cascade). Sharing is correct across
  // the sweep: CREATE patches new child links into this map in place (see
  // operationActions CREATE), and walkers null-guard entries whose occurrence
  // was deleted mid-sweep.
  if (context && !context._parentByChildId && context.occurrencesById) {
    context._parentByChildId = buildParentMap(context.occurrencesById);
  }

  // Stamp the created/deleted occurrence's ROLE onto the transaction so an
  // onAdd/onDelete `subjectRole:"instance", targetId:""` trigger can match only
  // same-role creates. Without it, every unscoped tracker (Task Countdown, the
  // Volume/Reps trackers, …) ran its full aggregation on EVERY occurrence
  // create — including a Wikipedia import's textblocks/containers/artifacts —
  // which was the per-millisecond import flood. matchSubjectFilter reads
  // transaction._occRole. If the role can't be resolved it stays null and the
  // filter falls back to its old "match any" behavior (no over-rejection).
  if (transaction && transaction._occRole === undefined &&
      (transactionType === "OccurrenceCreateOp" || transactionType === "OccurrenceDeleteOp")) {
    const modId = transaction.instanceId
      ?? context?.occurrencesById?.[transaction.occurrenceId]?.moduleId;
    transaction._occRole = (modId && context?.modulesById?.[modId]?.role) || null;
  }

  const matched = [];
  for (const op of operations) {
    // Skip ops whose own effects are mid-application on this sync stack —
    // prevents a rebuild op's delete/create effects from re-triggering it
    // (the OccurrenceDeleteOp freeze cascade). See _opsApplyingEffects above.
    if (isOpApplyingEffects(op.id)) continue;
    if (cascadeFiredOps && cascadeFiredOps.has(op.id)) continue;
    const m = computeTriggerMatch(op, transactionType, transaction);
    if (!m) continue;
    matched.push({ op, match: m });
  }
  matched.sort((a, b) => {
    const pa = a.match.triggerObject?.priority ?? 5;
    const pb = b.match.triggerObject?.priority ?? 5;
    if (pa !== pb) return pa - pb;
    return (a.op.sortOrder ?? 50) - (b.op.sortOrder ?? 50);
  });

  // Live overlay of occurrencesById that picks up each op's CREATE_ITEM /
  // UPDATE_ITEM_* / DELETE_ITEM effects in batch-order. Without this the next
  // op in the priority chain sees the same stale snapshot — e.g. on first
  // onLoad the priority-3 goal aggregations would run before priority-1's
  // schedule-build CREATEs reach the store, so totals come up empty until
  // the user reloads twice.
  const liveOccs = { ...(context.occurrencesById || {}) };
  const liveCtx = { ...context, occurrencesById: liveOccs };

  // Per-op timing breakdown — surfaces which op is the slowest in a sync fan-out
  // (drop, filter change, MeasureOp burst). Prints a single sorted summary line
  // at the end so the slowest offender is obvious without trawling logs.
  const _opTimings = [];

  for (const { op, match } of matched) {
    // Mark fired for the cascade BEFORE running so a later transaction in the
    // same filter-change burst won't re-run it (even if this run errors).
    if (cascadeFiredOps) cascadeFiredOps.add(op.id);
    const startedAt = Date.now();
    const logger = makeLogger();
    logger.add("start", {
      opId: op.id,
      opName: op.name,
      transactionType,
      trigger: transaction ? { ...transaction } : null,
      matchedTriggerObject: match.triggerObject,
    });
    let results;
    try {
      if (op.pipeline) {
        results = executePipeline(op, liveCtx, transaction, undefined, logger);
      } else {
        results = executeOperation(op, transactionType, transaction, liveCtx);
      }
      // Invalidate the shared $allItems read-model cache ONLY when the op actually
      // changed the occurrence overlay — so idempotent no-op re-fires and
      // display-only trackers (the bulk of the onLoad sweep) reuse it.
      if (applyEffectsToLiveOccs(liveOccs, results)) liveCtx._allItemsCache = null;
      // Tag each effect with its source op so the fire layer can mark the op
      // "applying" while the effect is applied (self-trigger guard above).
      for (const r of results) {
        if (r && typeof r === "object" && r._sourceOpId === undefined) r._sourceOpId = op.id;
      }
      updates.push(...results);
      logger.add("end", { updates: results, durationMs: Date.now() - startedAt });
      // Success notification — only when the op actually produced effects, so
      // idempotent no-op runs (the common case on re-fire) stay silent.
      if (results.length > 0) onSuccess?.(op.name, results);
    } catch (err) {
      console.warn(`[operationExecutor] error in operation "${op.name}":`, err);
      logger.add("error", { message: String(err?.message || err), stack: err?.stack });
      onError?.(op.name, err);
    }
    const runLog = { runAt: startedAt, durationMs: Date.now() - startedAt, entries: logger.entries };
    recordRunLog(op.id, runLog);
    _opTimings.push({ name: op.name, durationMs: runLog.durationMs, effects: results?.length || 0 });

    // No automatic wire persistence (2026-05-26). Previous designs all
    // had hidden costs: setTimeout(0) blocked the main thread with
    // synchronous JSON.stringify, requestIdleCallback hiccuped during
    // drag, and the socket-emit/server-write pipeline added per-op
    // latency. Logs stay in-memory only via runHistory above (capped
    // at 20 per op). When you want to ship them to disk, run
    // `__moduli_download_runs()` in the browser console — file saves
    // to ~/Downloads/, then `node server/scripts/dumpOpRunLogs.js
    // ~/Downloads/moduli-runs-*.json` consumes it.
  }

  // Per-op timing summary — only emits if the batch took >20ms or any single
  // op took >10ms (cheap fan-outs stay quiet). Sorted slowest-first so the
  // worst offender is at the top.
  const totalMs = _opTimings.reduce((s, t) => s + t.durationMs, 0);
  const worstMs = _opTimings.reduce((m, t) => Math.max(m, t.durationMs), 0);
  if (_opTimings.length > 0 && (totalMs > 20 || worstMs > 10)) {
    const sorted = [..._opTimings].sort((a, b) => b.durationMs - a.durationMs);
    const lines = sorted.map(t => `  ${String(t.durationMs).padStart(5)}ms  ${String(t.effects).padStart(3)}fx  ${t.name}`).join("\n");
    console.log(`[op-timing] ${transactionType} total=${totalMs}ms ops=${_opTimings.length}\n${lines}`);
  }

  return updates;
}

// Strip the heaviest fields preemptively rather than discovering they're
// too big via multiple JSON.stringify passes. Previous design ran up to
// 4 stringify passes against multi-MB payloads (each 50-100ms of CPU);
// most logs are big precisely because of these fields, so stripping
// first + serializing once is dramatically cheaper. We still mark
// `_trimmed: true` so the dump script can show ⚠.
//
// Fields stripped:
//   - varsBefore: $vars snapshots taken before each action. Usually the
//     largest single field — can hold a full $allItems / $allOccurrences
//     dump (615 occurrences × all fields) per action entry.
//   - candidates: per-record evaluation breakdown for FIND actions. Up
//     to 25 candidates per FIND × N FINDs per op = thousands of nested
//     objects.
//   - resolvedConfig: expanded action config with all $-refs resolved.
//     Useful but verbose; the action.config raw form is kept.
//   - loop_iter.item: full occurrence object on each loop iteration.
//     Loops over $allInstances mean ~600 occurrence copies per loop.
function trimRunForWire(payload) {
  if (!Array.isArray(payload.entries)) return payload;

  const trimmed = { ...payload, entries: payload.entries.map(e => {
    let touched = false;
    let copy = e;
    if (e.varsBefore || e.candidates || e.resolvedConfig) {
      copy = { ...e };
      if (e.varsBefore) { delete copy.varsBefore; touched = true; }
      if (e.candidates) { delete copy.candidates; touched = true; }
      if (e.resolvedConfig) { delete copy.resolvedConfig; touched = true; }
    }
    if (e.kind === "loop_iter" && e.item) {
      if (copy === e) copy = { ...e };
      copy.item = "(trimmed)";
      touched = true;
    }
    if (touched) copy._trimmed = true;
    return copy;
  })};

  // Hard truncate runaway entry counts (rare but possible with deep loops
  // over $allItems). 1000 entries is enough for forensics.
  if (trimmed.entries.length > 1000) {
    const dropped = trimmed.entries.length - 1000;
    trimmed.entries = [
      ...trimmed.entries.slice(0, 1000),
      { kind: "_truncated", droppedEntryCount: dropped },
    ];
  }

  return trimmed;
}

// Apply pipeline effects to the in-batch occurrence overlay so the next op
// can see them. Mirrors the effect handlers in bindSocketToStore but only
// touches the speculative overlay — actual dispatch still happens once
// runMatchingOperations returns.
// Effect types that CHANGE the occurrence overlay (vs. display-only effects like
// SHOW_VALUE / SET_COMPUTED_VALUES, which don't). Drives the $allItems cache
// invalidation in runMatchingOperations — the sweep only rebuilds the read model
// after an op that actually mutated occurrences.
const _LIVEOCCS_MUTATING = new Set([
  "CREATE_ITEM", "DELETE_ITEM", "REMOVE_OCCURRENCE", "LINK_OCCURRENCE_TO_PARENT",
  "UPDATE_ITEM_FIELD", "UPDATE_ITEM_META", "UPDATE_ITEM_PARENT", "UPDATE_ITEM_TEXTMAP",
]);

// Returns true if any effect mutated `liveOccs` (so callers can invalidate caches
// derived from it).
export function applyEffectsToLiveOccs(liveOccs, effects) {
  if (!Array.isArray(effects) || effects.length === 0) return false;
  let mutated = false;
  for (const eff of effects) {
    if (!eff?._effect) continue;
    if (_LIVEOCCS_MUTATING.has(eff._effect)) mutated = true;
    switch (eff._effect) {
      case "CREATE_ITEM": {
        const inst = eff.instance;
        if (!inst?.id) break;
        liveOccs[inst.id] = {
          id: inst.id,
          moduleId: inst.templateId,
          parentId: inst.parentId ?? null,
          fields: inst.fields || {},
          textmap: inst.textmap ?? null,
          // Honor occurrences[] if the producer (APPLY_TEMPLATE / COPY_LINK)
          // inlined children so the parent shows them in the overlay before
          // the dispatch round-trip.
          occurrences: Array.isArray(inst.occurrences) ? [...inst.occurrences] : [],
          // CRITICAL: carry role/kind/label from the new template so the NEXT
          // op's `$allInstances` / `$allContainers` / `$allPages` filters see
          // this occurrence. allItems setup reads `occ.role ?? tpl?.role`;
          // `tpl` comes from `state.modules` which doesn't get updated between
          // ops in the same runMatchingOperations batch — so without these
          // stamps, BUILD-DAY's APPLY_TEMPLATE clones were invisible to
          // SCHED-TABLE's `over: $allInstances` loop (role: null → filtered out).
          role:  eff.template?.role  || inst.role  || null,
          kind:  eff.template?.kind  || inst.kind  || null,
          label: eff.template?.label || eff.template?.name || inst.label || null,
          linkedGroupId: inst.linkedGroupId || null,
        };
        if (inst.parentId && liveOccs[inst.parentId]) {
          const parent = liveOccs[inst.parentId];
          const children = Array.isArray(parent.occurrences) ? parent.occurrences : [];
          if (!children.includes(inst.id)) {
            liveOccs[inst.parentId] = { ...parent, occurrences: [...children, inst.id] };
          }
        }
        break;
      }
      case "UPDATE_ITEM_FIELD": {
        const occ = liveOccs[eff.itemId];
        if (!occ) break;
        const fields = { ...(occ.fields || {}) };
        const prev = fields[eff.fieldId] || {};
        if (eff.subKind === "flow") fields[eff.fieldId] = { ...prev, flow: eff.value };
        else fields[eff.fieldId] = { ...prev, value: eff.value, flow: prev.flow || "in" };
        liveOccs[eff.itemId] = { ...occ, fields };
        break;
      }
      case "UPDATE_ITEM_PARENT": {
        const occ = liveOccs[eff.itemId];
        if (!occ) break;
        liveOccs[eff.itemId] = { ...occ, parentId: eff.toParentId };
        break;
      }
      case "UPDATE_ITEM_META": {
        const occ = liveOccs[eff.itemId];
        if (!occ) break;
        liveOccs[eff.itemId] = { ...occ, meta: { ...(occ.meta || {}), ...(eff.metaPatch || {}) } };
        break;
      }
      case "UPDATE_ITEM_TEXTMAP": {
        const occ = liveOccs[eff.itemId];
        if (!occ) break;
        liveOccs[eff.itemId] = { ...occ, textmap: eff.textmap };
        break;
      }
      case "DELETE_ITEM":
      case "REMOVE_OCCURRENCE": {
        const id = eff.itemId || eff.occurrenceId;
        if (id) delete liveOccs[id];
        break;
      }
      case "LINK_OCCURRENCE_TO_PARENT": {
        const parent = liveOccs[eff.parentOccurrenceId];
        const childId = eff.occurrenceId;
        if (!parent || !childId) break;
        const children = Array.isArray(parent.occurrences) ? parent.occurrences : [];
        if (!children.includes(childId)) {
          liveOccs[eff.parentOccurrenceId] = { ...parent, occurrences: [...children, childId] };
        }
        break;
      }
      default:
        break;
    }
  }
  return mutated;
}

// ============================================================
// PIPELINE EXECUTOR
// ============================================================

/**
 * Execute a pipeline operation.
 *
 * Pipeline format:
 *   { sources: [...], steps: [...] }
 *
 * Step types:
 *   { type: "action", config: { type: "AGGREGATE", ... } }  — always executes
 *   { type: "if", condition: { operator, rules }, then: [...], else: [...] }  — conditional branch
 *
 * @param {Object} operation   — operation with .pipeline
 * @param {Object} context     — { state, fieldsById, occurrencesById, operationsById }
 * @param {Object} [transaction] — triggering transaction (exposed as $trigger)
 * @returns {Array} updates — [{ fieldId, value }] or [{ _effect, ... }]
 */
export function executePipeline(operation, context, transaction, extraVars, externalLogger) {
  const pipeline = operation.pipeline;
  if (!pipeline) return [];
  // Lazy logger — always present in $vars so helpers can append without null checks.
  // When called from runMatchingOperations, externalLogger is reused (one log per run).
  const logger = externalLogger || makeLogger();

  const { sources = [], steps = [] } = pipeline;
  const { state, fieldsById = {}, occurrencesById = {}, operationsById = {} } = context;

  // parentId on the occurrence itself is not always set — the authoritative ordering
  // is maintained via parent.occurrences[] — so we derive the parent from those arrays.
  const parentByChildId = context._parentByChildId || buildParentMap(occurrencesById);

  // Resolve an ancestor chain (closest ancestor first, capped at depth 12).
  // Used to enrich $allItems entries so HAS_ANCESTOR rules in $allItems-driven
  // loops have something to walk. parentId is the fallback when occurrences[] doesn't link.
  const ancestorsFor = (occId) => {
    const chain = [];
    const seen = new Set();
    let cur = parentByChildId[occId] ?? occurrencesById[occId]?.parentId;
    while (cur && !seen.has(cur) && chain.length < 12) {
      chain.push(cur);
      seen.add(cur);
      cur = parentByChildId[cur] ?? occurrencesById[cur]?.parentId;
    }
    return chain;
  };

  // Pre-enrich every occurrence into a merged "item" carrying its template's
  // label/name/role/kind/meta. The operation language never differentiates
  // template (was Module) from instance (was Occurrence) — both are items.
  // _effectiveFilter is the filter value chain resolved up to grid level —
  // pipelines can read e.g. `$schedPage._effectiveFilter.<dateFieldId>` to
  // know what date the user is viewing without firing as a NavigationOp.
  const allTemplates = state?.modules ?? [];
  const templateById = Object.fromEntries(allTemplates.map(t => [t.id, t]));
  // Memoized batch resolver — enriching every item used to re-walk each
  // occurrence's full ancestor chain (O(N × depth) per pipeline run, ×20 ops
  // per drop sweep in the CPU profile). Same semantics, ancestor contexts
  // computed once.
  // PERF: cache the enriched $allItems read model on the sweep context and reuse
  // it across ops, rebuilding only when an op MUTATES the occurrence overlay (see
  // the invalidation in runMatchingOperations' loop). This map is
  // O(occurrences × depth) — the ~56-op onLoad sweep rebuilt it 56× (~556ms
  // synchronous). Idempotent re-fires + display-only trackers don't mutate the
  // overlay, so it now rebuilds ~once per sweep. Safe to share by reference:
  // pipelines REASSIGN $vars.$allItems to fresh arrays on CREATE/UPDATE
  // (operationActions.js), never mutating this array or its items in place.
  const _canCache = context && typeof context === "object";
  let allItems = _canCache ? context._allItemsCache : null;
  if (!allItems) {
  const effFilterFor = makeEffectiveFilterResolver({ grid: state?.grid, occurrencesById, parentByChildId });
  allItems = Object.values(occurrencesById).map(occ => {
    const tpl = occ.moduleId ? templateById[occ.moduleId] : null;
    const effFilter = effFilterFor(occ);
    // Task #60 — autoStampFromFilter: when a field's meta opts in and the
    // stored value is empty, substitute the occurrence's effective filter
    // value for that field. Pure read-time substitution (no DB write).
    // Pipelines reading `$item.fields.<fid>.value` now see the filter
    // value the same way the Field renderer does. Mirrors FieldRenderer
    // logic so client UI + ops stay aligned. Skips when no field opts in
    // (most occurrences) so the cost is one Map check per item.
    let fields = occ.fields;
    if (effFilter && fields && typeof fields === "object") {
      let mutated = null;
      for (const fid of Object.keys(fields)) {
        const f = fieldsById[fid];
        if (f?.meta?.autoStampFromFilter !== true) continue;
        const stored = fields[fid];
        const storedValue = (stored && typeof stored === "object" && "value" in stored) ? stored.value : stored;
        if (storedValue != null && storedValue !== "") continue;
        const fromFilter = effFilter[fid];
        if (fromFilter == null || fromFilter === "") continue;
        const v = (typeof fromFilter === "object" && "value" in fromFilter) ? fromFilter.value : fromFilter;
        if (!mutated) mutated = { ...fields };
        mutated[fid] = (stored && typeof stored === "object")
          ? { ...stored, value: v }
          : { value: v, flow: "in" };
      }
      if (mutated) fields = mutated;
    }
    return {
      ...occ,
      fields,
      label: occ.label ?? tpl?.label ?? tpl?.name ?? null,
      // Stable TEMPLATE base label, regardless of any occurrence.label override.
      // A label-decorating op (e.g. date-prefix goal/tracker names) reads this
      // so it composes from the unchanging base and never re-prefixes its own
      // previously-written occurrence.label.
      moduleLabel: tpl?.label ?? tpl?.name ?? null,
      name: occ.name ?? tpl?.name ?? tpl?.label ?? null,
      role: occ.role ?? tpl?.role ?? null,
      kind: occ.kind ?? tpl?.kind ?? null,
      meta: { ...(tpl?.meta || {}), ...(occ.meta || {}) },
      templateId: occ.moduleId ?? null,
      _ancestors: ancestorsFor(occ.id),
      // Field ids the item's template binds — lets rules introspect "does this
      // item even HAVE field X" (vs. "the value is empty"). The completion-gate
      // policy reads it: an item that never bound Completed counts on scope
      // membership alone, while a bound-but-unchecked one is excluded.
      _boundFieldIds: boundFieldIdsFor(tpl),
      _effectiveFilter: effFilter,
    };
  });
    if (_canCache) context._allItemsCache = allItems;
  }

  // ---- Build $vars ----
  const _nowDate = new Date();
  // Use the user's local time zone for date strings, NOT UTC. `toISOString()`
  // gives UTC, which silently rolls over to "tomorrow" anywhere west of UTC
  // after local-evening. The active filter, the seeded test data, and every
  // user-visible date in the app uses local-day semantics, so $today must too.
  const _localDayString = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const _todayLocal = _localDayString(_nowDate);
  const $vars = {
    _log: logger,
    _occurrencesById: occurrencesById,
    _fieldsById: fieldsById,
    $now: _nowDate.toISOString(),
    $today: _todayLocal,
    $currentDate: _todayLocal,
    $currentHour: _nowDate.getHours(),
    $currentTime: _nowDate.toTimeString().slice(0, 5),
    // Active filter date — scoped to the operation's target occurrence
    // (walks the parent chain via filterOverride). $activeDate / $filterDate
    // are the YYYY-MM-DD string (or null when no date filter); the label
    // and day-of-week variants format the same date for token interpolation.
    ...(() => {
      const targetOccId = operation.targetOccurrenceId;
      const targetOcc = targetOccId ? occurrencesById[targetOccId] : null;
      const efv = getEffectiveFilterForOccurrence(targetOcc, { grid: state?.grid, occurrencesById, parentByChildId });
      // Accept both bare-string `YYYY-MM-DD` filter values and the
      // object form `{value, unit, span?, kind?, dates?}` used by the
      // date-range nav.
      const isDateStr = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
      const periodVal = Object.values(efv).find(v => {
        if (isDateStr(v)) return true;
        return v && typeof v === "object" && isDateStr(v.value);
      });
      const dateStr = periodVal && typeof periodVal === "object" ? periodVal.value : periodVal;
      const dayKey = dateStr ? dateStr.slice(0, 10) : null;
      const d = dateStr ? new Date(dateStr + "T00:00:00") : _nowDate;
      // Expand the period into a flat ISO day list. The Schedule: Build
      // Schedule op consumes this to mint one day-column per visible day.
      // Falls back to [$today] when the page has no active date filter
      // (cold load with no nav state).
      const expandPeriod = (p) => {
        if (p == null) return [];
        if (typeof p === "string") return isDateStr(p) ? [p.slice(0, 10)] : [];
        if (typeof p !== "object") return [];
        const { value, unit = "day", span = 1, kind, dates } = p;
        if (kind === "multi" && Array.isArray(dates)) {
          const out = [];
          const seen = new Set();
          for (const ds of dates) {
            if (!isDateStr(ds)) continue;
            const k = ds.slice(0, 10);
            if (!seen.has(k)) { seen.add(k); out.push(k); }
          }
          return out;
        }
        if (!isDateStr(value)) return [];
        const start = new Date(value + "T00:00:00");
        const enumerateDays = (from, count) => {
          const out = [];
          for (let i = 0; i < count; i++) {
            const dd = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
            out.push(_localDayString(dd));
          }
          return out;
        };
        if (unit === "week") {
          // Anchor week to its start (Mon). Value is treated as any day in the week.
          const dow = start.getDay();
          const offset = dow === 0 ? -6 : 1 - dow;
          const wkStart = new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset);
          return enumerateDays(wkStart, 7);
        }
        if (unit === "month") {
          const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
          const lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
          return enumerateDays(monthStart, lastDay);
        }
        if (unit === "year") {
          const yearStart = new Date(start.getFullYear(), 0, 1);
          const isLeap = (start.getFullYear() % 4 === 0 && start.getFullYear() % 100 !== 0) || (start.getFullYear() % 400 === 0);
          return enumerateDays(yearStart, isLeap ? 366 : 365);
        }
        // Default: day unit, honor span
        return enumerateDays(start, Math.max(1, Number(span) || 1));
      };
      const periodDates = expandPeriod(periodVal);
      const periodDatesOrToday = periodDates.length ? periodDates : [_todayLocal];
      // Relative, human label for the active filter date — "Today" / "Yesterday"
      // / "Tomorrow", else an ordinal calendar date ("July 18th"). Lets a
      // label-decorating op prefix goal/tracker names ("Today's Water", "July
      // 18th Water") off the user's current date lens. Compares calendar days
      // (midnight-normalized) so time-of-day never shifts the bucket.
      const _ordinal = (n) => {
        const s = ["th", "st", "nd", "rd"], v = n % 100;
        return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
      };
      const _today0 = new Date(_nowDate.getFullYear(), _nowDate.getMonth(), _nowDate.getDate());
      const _d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const _diffDays = Math.round((_d0 - _today0) / 86400000);
      const _dateOrdinal = `${d.toLocaleDateString("en-US", { month: "long" })} ${_ordinal(d.getDate())}`;
      const _relLabel =
        _diffDays === 0 ? "Today"
        : _diffDays === -1 ? "Yesterday"
        : _diffDays === 1 ? "Tomorrow"
        : _dateOrdinal;
      // Possessive prefix ready to prepend to a name: relative words take "'s"
      // ("Today's", "Yesterday's"); an explicit calendar date does NOT
      // ("July 18th"). Matches the desired "Today's Water" / "July 18th Water".
      const _possessive =
        _diffDays === 0 ? "Today's"
        : _diffDays === -1 ? "Yesterday's"
        : _diffDays === 1 ? "Tomorrow's"
        : _dateOrdinal;
      return {
        $activeDate: dayKey,
        $filterDate: dayKey,
        $activePeriod: periodVal || null,
        $activePeriodDates: periodDatesOrToday,
        $activePeriodCount: periodDatesOrToday.length,
        $activeDateLabel: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
        $activeDayOfWeek: d.toLocaleDateString("en-US", { weekday: "long" }),
        $activeDateRelativeLabel: _relLabel,
        $activeDatePossessive: _possessive,
      };
    })(),
    // Built-in arrays — loop-ready collections of everything in the system.
    // Every placement (merged with its template: label/name/role/kind/meta) is
    // exposed under three names so authors can write what reads naturally:
    //   $allItems / $allOccurrences   — everything
    //   $allPanels / $allPages / $allContainers / $allInstances — role-filtered
    //   $allTemplates                 — template-level records
    //   $allFields                    — every field record
    // NOTE: $allPages filters role:"page" (the grid's named pages — Schedule,
    // Daily Toolkit, etc.). $allPanels filters role:"panel" (the grid-cell
    // shells that hold pages). These were conflated previously — $allPages
    // was incorrectly filtering "panel", missing every page-role module.
    $allItems: allItems,
    $allOccurrences: allItems,
    $allContainers: allItems.filter(i => i.role === "container"),
    $allPages: allItems.filter(i => i.role === "page"),
    $allPanels: allItems.filter(i => i.role === "panel"),
    $allInstances: allItems.filter(i => i.role === "instance"),
    // Id-keyed lookup maps — let an op resolve a known occurrence id
    // without LOOPing or FINDing. Path resolver splits on "." only, so
    // UUIDs with dashes work as keys: `$allItemsById.<uuid>` walks to the
    // value directly. Lets DrilldownPicker emit stable id paths
    // (e.g. for tracker `$goalItem = $allItemsById.<goalId>`) without
    // bottling the id into the predicate's right side.
    $allItemsById: Object.fromEntries(allItems.map(i => [i.id, i])),
    $allOccurrencesById: Object.fromEntries(allItems.map(i => [i.id, i])),
    $allTemplates: allTemplates,
    $allFields: Object.values(fieldsById),
    $allOperations: (() => {
      // Each entry is the raw op merged with its introspection record so
      // authors can drill `$op.fields_written`, `$op.triggered_by_fields`,
      // etc. in predicates. `analyzeAllOperations` memoizes per-op analysis
      // via a WeakMap keyed on the op object identity, so this only
      // recomputes for ops the user has edited since the previous run.
      const opsById = operationsById || {};
      const opsByName = {};
      for (const id in opsById) {
        if (opsById[id]?.name) opsByName[opsById[id].name] = opsById[id];
      }
      const records = analyzeAllOperations(opsById, { fieldsById, occurrencesById, operationsById: opsById, operationsByName: opsByName });
      const out = [];
      for (const id in opsById) {
        const op = opsById[id];
        if (!op) continue;
        out.push({ ...op, ...(records[id] || {}) });
      }
      return out;
    })(),
    $grid: state?.grid ?? {},
  };
  // Always set $trigger so pipeline steps can check $trigger.type without null guards.
  $vars["$trigger"] = { type: transaction?.type || "onLoad" };
  if (transaction && typeof transaction === "object") {
    // Enrich $trigger with the full occurrence when the transaction references one.
    // This makes $trigger.occurrence.fields.water.value work in stamp/onAdd operations
    // without requiring the user to configure a separate source.
    // type is explicitly seeded first so it's always present even when transaction is empty.
    // Iteration keys are stripped — the iteration system was retired in favor of named
    // filters; legacy transactions may still carry them.
    const enriched = { type: transaction?.type || "onLoad" };
    for (const [k, v] of Object.entries(transaction)) {
      if (k.startsWith("iteration") || k === "_iterationTimeValue" || k === "_iterationCategoryValue") continue;
      if (k === "_occurrenceSnapshot") continue; // consumed below, not a $trigger key
      enriched[k] = v;
    }
    const occId = transaction.occurrenceId;
    // Live occurrence wins; a DELETED occurrence resolves from the snapshot the
    // delete transaction carries (transaction._occurrenceSnapshot). The snapshot
    // is TRIGGER CONTEXT only — it never re-enters occurrencesById, so tracker
    // recounts correctly exclude the deleted item while gates like
    // `$trigger.occurrence.fields.<date> DATE_IN_PERIOD $goalPeriod` still pass.
    // (Previously deletes injected the snapshot into the whole executor overlay
    // via occurrencesOverride — the recount then still counted the deleted item,
    // so deleting a completed task never decremented Tasks Completed.)
    const liveOcc = occId ? occurrencesById[occId] : null;
    const occSource = liveOcc || transaction._occurrenceSnapshot || null;
    if (occId && occSource) {
      const fields = {};
      for (const [fid, fdata] of Object.entries(occSource.fields || {})) {
        fields[fid] = {
          value: fdata?.value !== undefined ? fdata.value : fdata,
          flow: fdata?.flow ?? null,
        };
      }
      enriched.occurrence = {
        id: occSource.id,
        moduleId: occSource.moduleId,
        parentId: occSource.parentId,
        fields,
        // Ordered ancestor occurrence IDs (closest first). Lets a rebuild op
        // tell "the Schedule source changed" apart from "I just deleted my own
        // derived copy" via `$trigger.occurrence._ancestors HAS_ANCESTOR <ownPageId>`.
        // Post-eviction the tree walk is dead — use the chain the delete
        // transaction captured before evicting.
        _ancestors: liveOcc ? ancestorsFor(occId) : (transaction._ancestorIds || []),
      };
    }
    $vars["$trigger"] = enriched;
  }

  // ---- $parentFilter: effective filter values at the trigger occurrence ----
  // Walks the chain via parentByChildId (parent.occurrences[] is authoritative)
  // STARTING AT THE TRIGGER ITSELF, so the trigger's own filterOverride is honoured.
  // Merges each occurrence's `filterOverride` on top of grid.activeFilterValues
  // top-down so closer occurrences win. `.date` is a convenience accessor
  // returning the first YYYY-MM-DD value found in the merged map.
  //
  // Why include the trigger itself: when a page-level filter changes, the source
  // NavigationOp's `transaction.occurrenceId` is the page. If we skipped the page,
  // its NEW override would be invisible to `$parentFilter`, so the source fire
  // would compute against grid filters while the descendant cascade fires
  // computed against the new override — producing two conflicting writes per
  // filter change.
  $vars["$parentFilter"] = (() => {
    const triggerOccId = transaction?.occurrenceId;
    const gridFilters = state?.grid?.activeFilterValues || {};
    let effective = { ...gridFilters };
    if (triggerOccId) {
      const chain = [];
      let cur = triggerOccId;
      while (cur) {
        const occ = occurrencesById[cur];
        if (!occ) break;
        chain.push(occ);
        cur = parentByChildId[cur];
      }
      // Merge top-down so closer occurrences win over distant ones
      for (let i = chain.length - 1; i >= 0; i--) {
        const override = chain[i].filterOverride;
        if (override == null) continue;
        effective = { ...effective, ...override };
      }
      for (const [k, v] of Object.entries(effective)) {
        if (v === null) delete effective[k];
      }
    }
    const dateVal = Object.values(effective).find(v => v && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v));
    return { ...effective, date: dateVal ? dateVal.slice(0, 10) : null };
  })();

  // Fold caller-supplied vars (from POST /api/v1/operations/:id/run's
  // `vars` body) directly into $vars. Accepts both "$foo" and "foo"
  // keys; the leading "$" is stripped if present and re-added to the
  // pipeline var name. Source rows declared on the op can still
  // overwrite these with proper-typed values.
  if (extraVars && typeof extraVars === "object") {
    for (const [k, v] of Object.entries(extraVars)) {
      const name = k.startsWith("$") ? k : `$${k}`;
      $vars[name] = v;
    }
  }

  for (const source of sources) {
    const { variableName, entityType, entityId, nodeInput, triggerProp } = source;
    if (!variableName) continue;
    const varKey = `$${variableName}`;

    if (entityType === "grid") {
      // $var = { gridId, currentIterationValue, currentCategoryValue, selectedIterationId }
      $vars[varKey] = {
        gridId: state?.gridId,
        currentIterationValue: state?.grid?.currentIterationValue,
        currentCategoryValue: state?.grid?.currentCategoryValue,
        selectedIterationId: state?.grid?.selectedIterationId,
      };
    } else if (entityType === "panel") {
      // $var = panel module properties
      const mod = (state?.modules || []).find(m => m.id === entityId && m.role === "panel");
      $vars[varKey] = mod ? {
        id: mod.id,
        label: mod.label,
        kind: mod.kind,
        defaultDragMode: mod.defaultDragMode,
      } : {};
    } else if (entityType === "occurrence") {
      const occ = occurrencesById[entityId];
      if (occ) {
        const fields = {};
        for (const [fid, fdata] of Object.entries(occ.fields || {})) {
          fields[fid] = {
            value: fdata?.value !== undefined ? fdata.value : fdata,
            flow: fdata?.flow ?? null,
          };
        }
        const fieldValues = {
          id: occ.id,
          moduleId: occ.moduleId,
          parentId: occ.parentId,
          fields,
          _ancestors: [],  // will be populated below
        };
        // Back-compat: flat field values (old expressions keep working)
        for (const [fid, fdata] of Object.entries(occ.fields || {})) {
          fieldValues[fid] = fdata?.value !== undefined ? fdata.value : fdata;
          fieldValues[`${fid}_flow`] = fdata?.flow;
        }
        $vars[varKey] = fieldValues;
      } else {
        $vars[varKey] = {};
      }
    } else if (entityType === "field") {
      // $var = { value (aggregated across all occurrences), name, type, unit }
      const field = fieldsById[entityId];
      const allOccs = Object.values(occurrencesById);
      const fvEntry = allOccs.map(o => o.fields?.[entityId]).find(fv => fv != null);
      $vars[varKey] = field ? {
        id: field.id,
        name: field.name,
        type: field.type,
        unit: field.unit,
        value: fvEntry?.value !== undefined ? fvEntry.value : fvEntry,
        flow: fvEntry?.flow,
        inputEnabled: field.inputEnabled,
        displayEnabled: field.displayEnabled,
      } : {};
    } else if (entityType === "template") {
      // $var = { id, name, items: [{instanceId, fieldDefaults}] }
      const tpl = (state?.grid?.templates ?? []).find(t => t.id === entityId);
      $vars[varKey] = tpl ? { id: tpl.id, name: tpl.name, items: tpl.items || [] } : {};
    } else if (entityType === "iteration") {
      // $var = the iteration definition (from grid.iterations)
      const iter = (state?.grid?.iterations ?? []).find(i => i.id === entityId);
      $vars[varKey] = iter ? { ...iter } : {};
    } else if (entityType === "localField") {
      // localField — value entered manually on the operation node (transient, not from DB)
      // extraVars is keyed by variableName (without $)
      $vars[varKey] = (extraVars && extraVars[variableName] !== undefined) ? extraVars[variableName] : null;
    } else if (entityType === "trigger" && triggerProp) {
      // trigger — maps a named property from $trigger into a pipeline var
      $vars[varKey] = $vars["$trigger"]?.[triggerProp] ?? null;
    } else if (entityType === "allOccurrences") {
      $vars[varKey] = allItems;
    } else if (entityType === "allContainers") {
      $vars[varKey] = allItems.filter(i => i.role === "container");
    } else if (entityType === "allPages") {
      $vars[varKey] = allItems.filter(i => i.role === "panel");
    } else if (entityType === "allInstances") {
      $vars[varKey] = allItems.filter(i => i.role === "instance");
    } else if (entityType === "allTemplates") {
      $vars[varKey] = allTemplates;
    } else if (entityType === "parentFilter") {
      $vars[varKey] = $vars["$parentFilter"];
    } else if (entityType === "effectiveFilter") {
      // Walk ancestor chain from a chosen occurrence (by id or by label) and
      // return the merged effective filter map. Binding by id is preferred
      // (stable across renames); label-based binding is offered for ops that
      // genuinely want a label match.
      const targetId = source.targetId;
      const targetLabel = source.targetLabel;
      let target = null;
      if (targetId && occurrencesById[targetId]) {
        target = allItems.find(i => i.id === targetId) || null;
      }
      if (!target && targetLabel) {
        target = allItems.find(i => i.label === targetLabel) || null;
      }
      $vars[varKey] = target?._effectiveFilter || {};
    } else {
      // instance / container — aggregate field values across occurrences targeting this entity
      const occs = Object.values(occurrencesById).filter(o => o.moduleId === entityId);
      const fieldValues = {};
      for (const occ of occs) {
        for (const [fid, fdata] of Object.entries(occ.fields || {})) {
          fieldValues[fid] = fdata?.value !== undefined ? fdata.value : fdata;
          fieldValues[`${fid}_flow`] = fdata?.flow;
        }
      }
      $vars[varKey] = fieldValues;
    }
  }

  // ---- Inject _executors, _extraVars, and _parentByChildId for ancestry checks ----
  const contextWithExecutors = { ...context, _executors: { executePipeline, executeOperation }, _extraVars: extraVars, _parentByChildId: parentByChildId };

  // Log a snapshot of the resolved source vars (skip internals starting with _).
  // Pass raw values through — the renderer (OperationLogPanel.JsonNode) makes
  // every array/object expandable, so coercing to "[Array(N)]" strings here
  // would defeat that.
  const sourceSummary = {};
  for (const [k, v] of Object.entries($vars)) {
    if (k.startsWith("_")) continue;
    sourceSummary[k] = v;
  }
  logger.add("sources", { vars: sourceSummary });

  // ---- Execute steps (top-down code flow) ----
  const result = executeSteps(steps, $vars, contextWithExecutors, transaction);

  // ---- Apply $displayRules ----
  // The pipeline opts in to rule-driven display by INIT_VAR'ing a
  // `$displayRules` object keyed by occurrence label. Each entry is an
  // array of `{ when, color?, icon?, suffix?, replaceValue?, ... }`
  // rules; the first match wins. We post-process two kinds of writes:
  //
  // (a) Computed-value updates (no `_effect`, has `fieldId` +
  //     `occurrenceId`) — merge the matched rule body in-place so the
  //     bridge / reducer / Field.jsx see the resolved
  //     `{ color, icon, suffix, replaceValue }` alongside the raw value.
  //
  // (b) `UPDATE_ITEM_FIELD` value effects — trackers/goal ops write
  //     directly to the occurrence's field via `applyUpdate`. Field.jsx
  //     reads computedValues FIRST and falls back to occurrence.fields,
  //     so if a rule matches we also emit a parallel computed-value
  //     update carrying the value + rule outputs. The persistent write
  //     still lands on the occurrence; the computed-value just decorates
  //     the display path with the rule outputs.
  //
  // Updates / effects with no rule match pass through untouched —
  // legacy ops that don't author $displayRules see no change.
  const displayRules = $vars["$displayRules"];
  if (displayRules && Array.isArray(result)) {
    const occsForRules = context.occurrencesById || {};
    const fieldsForRules = context.fieldsById || {};
    // Resolve a field's static target shape from its displayConfig so
    // rules with `when: { target: "met" }` can evaluate against the
    // configured target value. Returns null when the field has no
    // numeric target (rules referencing target collapse to "none").
    const targetForField = (fieldId, explicit) => {
      if (explicit != null) return explicit;
      const tv = fieldsForRules[fieldId]?.displayConfig?.targetValue;
      return typeof tv === "number" ? { value: tv } : null;
    };
    const extraUpdates = [];
    for (let i = 0; i < result.length; i++) {
      const u = result[i];
      if (!u) continue;
      // (a) inline-decorate computed-value updates
      if (!u._effect && u.occurrenceId && u.fieldId) {
        const occ = occsForRules[u.occurrenceId];
        if (!occ) continue;
        const body = applyDisplayRules({
          displayRules,
          value: u.value,
          target: targetForField(u.fieldId, u.target),
          occurrence: occ,
          fieldsById: fieldsForRules,
        });
        if (body) result[i] = { ...u, ...body };
        continue;
      }
      // (b) shadow-decorate UPDATE_ITEM_FIELD value writes
      if (u._effect === "UPDATE_ITEM_FIELD" && u.subKind === "value" && u.itemId && u.fieldId) {
        const occ = occsForRules[u.itemId];
        if (!occ) continue;
        const body = applyDisplayRules({
          displayRules,
          value: u.value,
          target: targetForField(u.fieldId, null),
          occurrence: occ,
          fieldsById: fieldsForRules,
        });
        if (body) {
          extraUpdates.push({
            fieldId: u.fieldId,
            occurrenceId: u.itemId,
            value: u.value,
            ...body,
          });
        }
      }
    }
    if (extraUpdates.length) result.push(...extraUpdates);
  }

  // _onPipelineDone callback (used by the /api/v1/operations/:id/run
  // bridge) fires once the pipeline truly finishes — for suspending
  // pipelines that means after every CALL_API / GET_USER_INPUT resume
  // has run. For synchronous pipelines the caller already has all
  // effects, so the callback fires immediately with the same array.
  const onPipelineDone = contextWithExecutors._onPipelineDone;
  return _handleSuspend(result, { onPipelineDone, accumulated: [] });
}

// If the steps returned a suspend continuation as the LAST entry, hand the
// request to operationsBridge.requestUserInput (or await the CALL_API fetch)
// and re-enter the executor on resolve. Pre-suspend effects (`pre`) are
// returned to the caller and applied through the normal path. Post-resume
// effects are applied via operationsBridge.applyEffect since they
// materialize after the original fireOperations call already returned.
//
// `onPipelineDone(allEffects)` fires once when the WHOLE pipeline finishes
// (no more suspends in the chain). `accumulated` is the effects-so-far
// passed down the resume chain.
function _handleSuspend(result, { onPipelineDone, accumulated = [] } = {}) {
  if (!Array.isArray(result) || result.length === 0) {
    if (onPipelineDone) onPipelineDone(accumulated);
    return result;
  }
  const last = result[result.length - 1];
  if (!last || last._suspend !== true) {
    if (onPipelineDone) onPipelineDone([...accumulated, ...result]);
    return result;
  }
  const pre = result.slice(0, -1);
  const nextAccumulated = [...accumulated, ...pre];

  // CALL_API path: the action attached a ready Promise via request.fetch.
  // No external bridge needed; we just await it and resume.
  if (last._callApi && last.request?.fetch) {
    Promise.resolve(last.request.fetch).then((value) => {
      // onError === "continue" smuggles an error envelope; route it to errorVar.
      if (value && value.__apiError) {
        const errVarName = last.errorVar || "$apiError";
        const errPayload = { status: value.status, message: value.message || null, body: value.body ?? null };
        resumeContinuation(last.continuation, errVarName, errPayload, { onPipelineDone, accumulated: nextAccumulated });
      } else {
        resumeContinuation(last.continuation, last.resultVar || "$apiResponse", value, { onPipelineDone, accumulated: nextAccumulated });
      }
    }).catch((err) => {
      console.warn("[CALL_API] request failed:", err);
      if (onPipelineDone) onPipelineDone(nextAccumulated);
    });
    return pre;
  }

  // IMPORT_HTML / IMPORT_MARKDOWN path: emit the import_text socket
  // event via the bridge, await `import_text_result`, bind the
  // { rootOccurrenceId, stats, detectedFormat } result to resultVar
  // (or smuggle the error envelope to errorVar when onError === "continue").
  if (last._importText) {
    const importFn = operationsBridge.importText;
    if (typeof importFn !== "function") {
      console.warn("[IMPORT_*] operationsBridge.importText not set — dropping the rest of the pipeline.");
      if (onPipelineDone) onPipelineDone(nextAccumulated);
      return pre;
    }
    Promise.resolve(importFn(last.request)).then((value) => {
      resumeContinuation(last.continuation, last.resultVar || "$importResult", value, { onPipelineDone, accumulated: nextAccumulated });
    }).catch((err) => {
      if (last.onError === "continue") {
        const errVarName = last.errorVar || "$importError";
        const errPayload = { status: 0, message: String(err?.message || err) };
        resumeContinuation(last.continuation, errVarName, errPayload, { onPipelineDone, accumulated: nextAccumulated });
      } else {
        console.warn("[IMPORT_*] request failed:", err);
        if (onPipelineDone) onPipelineDone(nextAccumulated);
      }
    });
    return pre;
  }

  // GET_USER_INPUT path: modal-based suspend that needs the
  // operationsBridge.requestUserInput function to ferry the question to
  // the UI.
  const ask = operationsBridge.requestUserInput;
  if (typeof ask !== "function") {
    console.warn("[GET_USER_INPUT] operationsBridge.requestUserInput not set — dropping the rest of the pipeline.");
    if (onPipelineDone) onPipelineDone(nextAccumulated);
    return pre;
  }
  Promise.resolve(ask(last.request)).then((value) => {
    resumeContinuation(last.continuation, last.resultVar || "$userInput", value, { onPipelineDone, accumulated: nextAccumulated });
  }).catch((err) => {
    // Cancellation is the common case (user closed the modal) and should
    // stay silent. Anything else is a real bug we'd want to see.
    if (err && err.message && !/cancel/i.test(err.message)) {
      console.warn("[GET_USER_INPUT] continuation failed:", err);
    }
    if (onPipelineDone) onPipelineDone(nextAccumulated);
  });
  return pre;
}

/**
 * Resume a suspended pipeline with the user's input value. Merges value into
 * the captured $vars under resultVar, runs the remaining top-level steps,
 * then applies any new effects via operationsBridge.applyEffect. If the
 * resumed steps suspend again (chained suspends), the handler recurses
 * — each step's value lands in $vars for downstream steps as designed.
 */
export function resumeContinuation(continuation, resultVar, value, { onPipelineDone, accumulated = [] } = {}) {
  if (!continuation) {
    if (onPipelineDone) onPipelineDone(accumulated);
    return [];
  }
  continuation.$vars[resultVar] = value;
  const next = executeSteps(
    continuation.remainingSteps,
    continuation.$vars,
    continuation.context,
    continuation.transaction,
  );
  const handled = _handleSuspend(next, { onPipelineDone, accumulated });
  // Effects already applied during fireOperations for the pre-suspend chunk;
  // these are the post-resume effects so apply them now.
  const apply = operationsBridge.applyEffect;
  if (typeof apply === "function") {
    for (const eff of handled) {
      if (eff && eff._suspend) continue;
      apply(eff);
    }
  }
  return handled;
}

// ============================================================
// STEPS & ACTIONS (top-down code-flow execution model)
// ============================================================

/**
 * Execute a steps array in order.
 * Step types: "action", "if", "loop"
 * $vars is shared by reference — INIT_VAR/ADD_TO_VAR mutate it in-place.
 */
function executeSteps(steps, $vars, context, transaction) {
  // Re-read the mute state at every entry — loop bodies re-enter here per
  // iteration, so once the owning loop mutes past LOOP_LOG_ITER_CAP, body
  // frames skip ALL log computation (snapshotVars/resolveGroupForLog/etc.),
  // not just the add() calls.
  const rawLog = $vars._log;
  const log = rawLog && !(rawLog._mute > 0) ? rawLog : null;
  const updates = [];
  const stepsArr = steps || [];
  for (let stepIdx = 0; stepIdx < stepsArr.length; stepIdx++) {
    const step = stepsArr[stepIdx];
    if (step.type === "action") {
      const actionType = step.config?.type || step.actionType || step.action;
      const cfg = step.config || step.cfg || {};
      // Snapshot vars + resolve any predicate / config exprs BEFORE the action mutates state.
      const varsBefore = log ? snapshotVars($vars) : null;
      const resolvedConfig = log ? resolveConfigForLog(cfg, $vars) : null;
      let resolvedPredicate = log && cfg.predicate ? resolveGroupForLog(cfg.predicate, $vars) : null;
      const result = executeActionItem(actionType, cfg, $vars, context, transaction);
      // For FIND, recompute the predicate's resolved values against the matched
      // record. Without this, bare record paths on the left side (`templateId`,
      // `_ancestors`, `fields.<fid>.value`, `meta.scheduleSlot`) display as the
      // literal path string because resolveExpr has no record context. With a
      // match, the log can now show "mod_dw IS mod_dw ✓" etc.
      let candidates = null;
      if (log && cfg.predicate && _isFindAction(actionType)) {
        let matched = cfg.itemVar ? $vars[cfg.itemVar] : null;
        // Fall back: seed pipelines often only pass `itemIdVar`. Look the
        // matched id up in the enriched $allItems collection (NOT raw
        // occurrencesById — raw occs lack templateId / _ancestors / merged
        // meta, so resolveRecordPath against them would miss the same fields
        // FIND was matching on).
        if ((!matched || typeof matched !== "object") && cfg.itemIdVar) {
          const matchedId = $vars[cfg.itemIdVar];
          const pool = $vars.$allItems || $vars.$allOccurrences;
          if (typeof matchedId === "string" && Array.isArray(pool)) {
            matched = pool.find(it => it && it.id === matchedId) || null;
          }
        }
        if (matched && typeof matched === "object" && !Array.isArray(matched)) {
          resolvedPredicate = resolveGroupForLog(cfg.predicate, $vars, matched);
        }
        // Per-record candidate evaluations — surface every record FIND
        // iterated, with each rule's leftValue from THAT record + a matched
        // bool. Lets the panel show "no match" callouts where the user can
        // see what each candidate's `templateId / fields.X.value / _ancestors`
        // actually held when compared to the right side.
        candidates = collectFindCandidates(cfg, $vars, matched?.id);
      }

      // FIND / INIT_VAR / *_VAR mutate $vars without pushing into `result`, so
      // the display panel previously had nothing to inspect — FIND always
      // rendered "(no match)" even when it bound a record. Snapshot the
      // assigned vars post-action so the log entry shows what was bound.
      // Sources are action-type specific:
      //   - itemVar / itemIdVar: FIND / FIND_OCCURRENCE / FIND_MODULE / CREATE
      //   - cfg.name: INIT_VAR / SET_VAR / ADD_TO_VAR / etc. (the target var)
      let boundVars = null;
      if (log) {
        const bindKeys = [];
        if (typeof cfg.itemVar === "string" && cfg.itemVar.startsWith("$")) bindKeys.push(cfg.itemVar);
        if (typeof cfg.itemIdVar === "string" && cfg.itemIdVar.startsWith("$")) bindKeys.push(cfg.itemIdVar);
        if (_VAR_TARGET_ACTIONS.has(actionType) && typeof cfg.name === "string" && cfg.name.startsWith("$")) {
          bindKeys.push(cfg.name);
        }
        if (bindKeys.length) {
          boundVars = {};
          for (const k of bindKeys) {
            if (k in $vars) boundVars[k] = $vars[k];
          }
        }
      }
      log?.add("action", {
        actionType,
        config: cfg,
        resolvedConfig,
        resolvedPredicate,
        varsBefore,
        resultCount: result.length,
        result,
        ...(boundVars ? { boundVars } : {}),
        ...(candidates ? { candidates } : {}),
      });
      // Suspend sentinel: an action (currently only GET_USER_INPUT) can return
      // [{ _suspend: true, request, resultVar }] to halt the pipeline. We
      // capture the remaining top-level steps + current $vars + executor
      // context as a continuation. The caller (executePipeline) detects the
      // suspend, invokes operationsBridge.requestUserInput(request), and on
      // resolve calls resumeContinuation(cont, value) to re-enter from here.
      // MVP limitation: only fires at the TOP level of pipeline.steps. Nested
      // suspends inside IF/LOOP bodies aren't supported yet — would need
      // bubbling through the recursive executeSteps calls below.
      if (result.length === 1 && result[0] && result[0]._suspend === true) {
        return [
          ...updates,
          {
            // Spread the action's sentinel so type discriminators
            // (_callApi / _importText) and Promise-error metadata
            // (errorVar / onError) survive into _handleSuspend's
            // branch selection. Was previously stripped to bare
            // {_suspend, request, resultVar} which dropped every
            // suspend through the GET_USER_INPUT branch by default.
            ...result[0],
            continuation: {
              remainingSteps: stepsArr.slice(stepIdx + 1),
              $vars,
              context,
              transaction,
            },
          },
        ];
      }
      updates.push(...result);
    } else if (step.type === "if") {
      const group = step.condition || { operator: "AND", rules: step.rules || [] };
      const resolvedGroup = log ? resolveGroupForLog(group, $vars) : null;
      const varsBefore = log ? snapshotVars($vars) : null;
      const branch = evalGroup(group, $vars);
      log?.add("if", {
        condition: group,
        resolvedCondition: resolvedGroup,
        branch: branch ? "then" : "else",
        varsBefore,
      });
      if (branch) {
        updates.push(...executeSteps(step.then || [], $vars, context, transaction));
      } else {
        updates.push(...executeSteps(step.else || [], $vars, context, transaction));
      }
    } else if (step.type === "loop") {
      // LOOP: iterate over any array expression or legacy typed collection.
      // step.overExpr = any expression resolving to an array (e.g. "$allItems", "$myArr")
      // step.over = legacy typed string (e.g. "field_occurrences") — still supported
      // $vars is shared so variable mutations (ADD_TO_VAR) accumulate across iterations
      const varName = step.as || "$item";
      let items;
      // `over` naming a COLLECTION or a var (`$allInstances`, `$dayCol.occurrences`)
      // is the FIND action's spelling, and authors reach for it here too. Resolve it
      // as an expression — a legacy typed collection is a bare word, never `$`-led,
      // so the two can't collide. Without this the step fell through gatherLoopItems'
      // branches to its every-occurrence default and silently iterated the whole grid.
      const overExpr = step.overExpr || (typeof step.over === "string" && step.over.startsWith("$") ? step.over : null);
      if (overExpr) {
        const resolved = resolveExpr(overExpr, $vars);
        items = Array.isArray(resolved) ? resolved : (resolved != null ? Object.values(resolved) : []);
      } else {
        items = gatherLoopItems(step, context, $vars);
      }
      // A predicate on the loop step filters the collection the same way FIND's
      // does — rule lefts are record paths (`parentId`, `fields.<id>.value`,
      // `_ancestors`), not `$var` expressions.
      if (step.predicate && Array.isArray(step.predicate.rules) && step.predicate.rules.length) {
        items = items.filter(it => evalGroupAgainstRecord(step.predicate, it, $vars));
      }
      log?.add("loop", { over: step.overExpr || step.over, as: varName, itemCount: items.length });
      let i = 0;
      let mutedHere = false;
      for (const item of items) {
        $vars[varName] = item;
        if (log) {
          if (i < LOOP_LOG_ITER_CAP) {
            log.add("loop_iter", { as: varName, index: i, total: items.length, item });
          } else if (i === LOOP_LOG_ITER_CAP) {
            log.add("loop_truncated", { as: varName, omitted: items.length - LOOP_LOG_ITER_CAP, total: items.length });
            log._mute += 1;
            mutedHere = true;
          }
        }
        updates.push(...executeSteps(step.body || [], $vars, context, transaction));
        i += 1;
      }
      if (mutedHere) log._mute -= 1;
      delete $vars[varName];
    }
  }
  return updates;
}

/**
 * Gather loop iteration items based on step config.
 * Returns array of { value, flow, occurrenceId, targetId, [fieldValues] }
 */
function gatherLoopItems(step, context, $vars) {
  const { over = "field_occurrences", fieldId, scopeContainerId, moduleId, timeFilter, flowFilter = "any" } = step;
  const { occurrencesById = {}, state, _parentByChildId = {} } = context;

  // Walk up the parent chain using _parentByChildId (from occurrences[] arrays) with
  // a parentId fallback. Returns ordered ancestor IDs, closest first.
  const getAncestors = (occId) => {
    const ancestors = [];
    const seen = new Set();
    let cur = _parentByChildId[occId] ?? occurrencesById[occId]?.parentId;
    while (cur && !seen.has(cur) && ancestors.length < 12) {
      ancestors.push(cur);
      seen.add(cur);
      cur = _parentByChildId[cur] ?? occurrencesById[cur]?.parentId;
    }
    return ancestors;
  };

  // ---- TEMPLATES: loop over grid templates ----
  if (over === "templates") {
    return (state?.grid?.templates ?? []).map(t => ({
      id: t.id,
      name: t.name,
      items: t.items || [],
      itemCount: (t.items || []).length,
    }));
  }

  // ---- ITERATION DEFINITIONS: loop over grid iteration definitions ----
  if (over === "iteration_definitions") {
    return (state?.grid?.iterations ?? []).map(i => ({ ...i }));
  }

  // ---- FIELDS: loop over all field definitions ----
  if (over === "fields") {
    return Object.values(context.fieldsById || {}).map(f => ({ ...f }));
  }

  // ---- MODULES (any role) with optional role/kind/label filters ----
  if (over === "modules" || over === "panels" || over === "containers" || over === "instances") {
    let mods = state?.modules || [];
    if (over === "panels")     mods = mods.filter(m => m.role === "panel");
    if (over === "containers") mods = mods.filter(m => m.role === "container");
    if (over === "instances")  mods = mods.filter(m => m.role === "instance");
    if (step.role)  mods = mods.filter(m => m.role === step.role);
    if (step.kind)  mods = mods.filter(m => m.kind === step.kind);
    if (step.label) mods = mods.filter(m => m.label?.toLowerCase().includes(step.label.toLowerCase()));
    return mods.map(m => ({
      id: m.id,
      label: m.label,
      role: m.role,
      kind: m.kind,
      fieldBindings: m.fieldBindings || [],
      iterationMode: m.iteration?.mode ?? null,
    }));
  }

  // ---- OCCURRENCES: all occurrences with flexible filters ----
  if (over === "occurrences") {
    let occsAll = Object.values(occurrencesById);
    if (step.moduleId) {
      const resolvedModuleId = resolveExpr(step.moduleId, $vars) || step.moduleId;
      occsAll = occsAll.filter(o => o.moduleId === resolvedModuleId);
    }
    if (step.parentId) {
      const resolvedParentId = resolveExpr(step.parentId, $vars) || step.parentId;
      occsAll = occsAll.filter(o => o.parentId === resolvedParentId);
    }
    return occsAll.map(occ => {
      const item = { occurrenceId: occ.id, moduleId: occ.moduleId, parentId: occ.parentId,
        iterationValue: occ.iteration?.timeValue || occ.iteration?.value || null };
      for (const [fid, fdata] of Object.entries(occ.fields || {})) {
        item[fid] = fdata?.value !== undefined ? fdata.value : fdata;
      }
      return item;
    });
  }

  let occs = Object.values(occurrencesById);

  // ---- OCCURRENCE HISTORY: all occurrences of a single module (different iteration dates) ----
  if (over === "occurrence_history") {
    const resolvedModuleId = resolveExpr(moduleId, $vars) || moduleId;
    if (!resolvedModuleId) return [];
    occs = occs.filter(o => o.moduleId === resolvedModuleId);
    return occs
      .sort((a, b) => {
        const aTime = new Date(a.iteration?.timeValue || a.iteration?.value || 0).getTime();
        const bTime = new Date(b.iteration?.timeValue || b.iteration?.value || 0).getTime();
        return bTime - aTime; // newest first
      })
      .map(occ => ({
        occurrenceId: occ.id,
        moduleId: occ.moduleId,
        iterationValue: occ.iteration?.timeValue || occ.iteration?.value || null,
        iterationCategory: occ.iteration?.categoryValue || null,
        ...Object.fromEntries(
          Object.entries(occ.fields || {}).map(([fid, fdata]) => [fid, fdata?.value !== undefined ? fdata.value : fdata])
        ),
      }));
  }

  // Scope loop to items within a specific container
  if (scopeContainerId) {
    const resolvedId = resolveExpr(scopeContainerId, $vars) || scopeContainerId;
    // Find occurrence(s) of this container module and collect their child IDs
    const scopeOccIds = new Set();
    for (const occ of Object.values(occurrencesById)) {
      if (occ.moduleId === resolvedId && Array.isArray(occ.occurrences)) {
        for (const childId of occ.occurrences) scopeOccIds.add(childId);
      }
    }
    occs = occs.filter(o => scopeOccIds.has(o.id));
  }

  // ---- CONTAINER_ITEMS: all occurrences in container, exposing instance label + fields ----
  if (over === "container_items") {
    const modulesById = Object.fromEntries((state?.modules || []).map(m => [m.id, m]));
    return occs.map(occ => {
      const inst = modulesById[occ.moduleId];
      const item = {
        occurrenceId: occ.id,
        instanceId: occ.moduleId,
        label: inst?.label ?? "",
        kind: inst?.kind ?? null,
        iterationValue: occ.iteration?.timeValue || occ.iteration?.value || null,
      };
      for (const [fid, fdata] of Object.entries(occ.fields || {})) {
        item[fid] = fdata?.value !== undefined ? fdata.value : fdata;
        item[`${fid}_flow`] = fdata?.flow ?? null;
      }
      return item;
    });
  }

  // Filter by field existence (field_occurrences mode)
  if (over === "field_occurrences" && fieldId) {
    occs = occs.filter(o => o.fields?.[fieldId] != null);
  }

  // Time filter — checks legacy iteration.timeValue, then date-type field
  // values on the occurrence OR its parent chain (date lives on the
  // container occurrence, not the instance occurrence inside it).
  if (timeFilter && timeFilter !== "all" && timeFilter !== "inherit") {
    // Use the active filter date as reference (falls back to today)
    const activeDate = $vars?.$activeDate
      ? new Date($vars.$activeDate + "T00:00:00")
      : new Date();
    // Collect date-type field IDs for fallback lookup
    const dateFieldIds = Object.values(context.fieldsById || {})
      .filter(f => f.type === "date")
      .map(f => f.id);

    // Walk up parent chain (using both parentId and the reverse _parentByChildId map)
    // to find a date field value.
    const findDateValue = (occ) => {
      let cur = occ;
      const seen = new Set();
      for (let depth = 0; depth < 6 && cur && !seen.has(cur.id); depth++) {
        seen.add(cur.id);
        for (const dfId of dateFieldIds) {
          const fv = cur.fields?.[dfId];
          const val = fv?.value !== undefined ? fv.value : fv;
          if (val) return val;
        }
        const nextId = _parentByChildId[cur.id] ?? cur.parentId;
        cur = nextId ? occurrencesById[nextId] : null;
      }
      return null;
    };

    occs = occs.filter(occ => {
      // 1) Legacy: iteration-based date
      let iterVal = occ.iteration?.timeValue || occ.iteration?.value;
      // 2) New filter system: walk up parent chain for date field
      if (!iterVal) iterVal = findDateValue(occ);
      // No date at all → treat as persistent (matches any time filter)
      if (!iterVal) return true;
      const d = new Date(iterVal);
      if (timeFilter === "daily") return d.toDateString() === activeDate.toDateString();
      if (timeFilter === "weekly") {
        const weekStart = new Date(activeDate);
        weekStart.setDate(activeDate.getDate() - activeDate.getDay());
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 7);
        return d >= weekStart && d < weekEnd;
      }
      if (timeFilter === "monthly") return d.getMonth() === activeDate.getMonth() && d.getFullYear() === activeDate.getFullYear();
      if (timeFilter === "yearly") return d.getFullYear() === activeDate.getFullYear();
      return true;
    });
  }

  // Flow filter
  if (fieldId && flowFilter !== "any") {
    occs = occs.filter(o => {
      const fv = o.fields?.[fieldId];
      return fv?.flow === flowFilter;
    });
  }

  // Map to iteration items — expose value, flow, all field values, and _ancestors
  // _ancestors is an ordered array of ancestor occurrence IDs (closest first),
  // derived from both parentId fields and the _parentByChildId reverse map.
  // Use $item._ancestors with HAS_ANCESTOR comparator in pipeline IF conditions.
  return occs.map(occ => {
    const fv = fieldId ? occ.fields?.[fieldId] : null;
    // Expose fields as a nested object so paths like $item.fields.water.value work.
    // Each entry keeps {value, flow} shape, matching the DB shape the user sees in UI.
    const fields = {};
    for (const [fid, fdata] of Object.entries(occ.fields || {})) {
      fields[fid] = {
        value: fdata?.value !== undefined ? fdata.value : fdata,
        flow: fdata?.flow ?? null,
      };
    }
    const item = {
      id: occ.id,
      occurrenceId: occ.id,
      moduleId: occ.moduleId,
      parentId: occ.parentId,
      value: fv?.value !== undefined ? fv.value : (fv ?? null),  // back-compat flat accessor
      flow: fv?.flow ?? null,
      _ancestors: getAncestors(occ.id),
      fields,
    };
    // Back-compat: also expose top-level field values for existing operations
    for (const [fid, fdata] of Object.entries(occ.fields || {})) {
      item[fid] = fdata?.value !== undefined ? fdata.value : fdata;
    }
    return item;
  });
}

export default { shouldTrigger, executeOperation, executePipeline, runMatchingOperations };
