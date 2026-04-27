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
import { applyAggregation, extractFieldValues } from "./CalculationHelpers";
import { toast } from "sonner";
import { resolveExpr, evalRule, evalGroup, extractFieldValuesFiltered, executeActionItem } from "./operationActions";
import { getEffectiveFilterForOccurrence } from "../state/selectors";

// ============================================================
// RUN LOG — per-operation run history for the editor's log panel
// ============================================================
// Module-level store: each op keeps a capped history of its recent runs
// (live-run from the Run button OR trigger-fired). Subscribers (OperationEditor)
// get notified when a new run is appended.

const RUN_HISTORY_LIMIT = 20;            // newest first; oldest evicted past cap
const runHistory = new Map();            // Map<opId, RunLog[]>
const logSubscribers = new Map();        // Map<opId, Set<fn>>

export function getOpRunHistory(opId) {
  return runHistory.get(opId) || [];
}

// Back-compat: returns the most recent run (or null)
export function getLastOpLog(opId) {
  const list = runHistory.get(opId);
  return list && list.length ? list[0] : null;
}

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
  return { entries: [], add(kind, data) { this.entries.push({ kind, t: Date.now(), ...data }); } };
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

  const types = Array.isArray(operation.triggerTypes)
    ? operation.triggerTypes
    : [operation.triggerType].filter(Boolean);

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
    if (matchSubjectFilter(to, t, transaction)) {
      return { matched: true, triggerObject: to };
    }
  }
  return false;
}

/**
 * Gate an event name against the current transaction type and payload semantics.
 * Pure type/shape check — no subject/target filtering.
 */
function isEventCompatible(eventType, transactionType, transaction) {
  switch (eventType) {
    case "onChange":
    case "onFieldChange":
      return transactionType === "MeasureOp";
    case "onComplete": {
      if (transactionType !== "MeasureOp") return false;
      const v = transaction?.value;
      return Boolean(v) || v === 1;
    }
    case "onUncomplete":
      return transactionType === "MeasureOp" && !transaction?.value;
    case "onAdd":
    case "onCreate":
      return transactionType === "OccurrenceCreateOp";
    case "onRemove":
    case "onDelete":
      return transactionType === "OccurrenceDeleteOp";
    case "onMove":
      return transactionType === "OccurrenceMoveOp" || transactionType === "OccurrenceListOp";
    case "onReorder":
      return transactionType === "OccurrenceListOp" && transaction?.fromContainerId === transaction?.toContainerId;
    case "onDrop":
      return transactionType === "OccurrenceListOp";
    case "onFilterChange":
    case "onNavigation":
      return transactionType === "NavigationOp";
    case "onLoad":
      return transactionType == null;
    case "onButton":
      return transactionType === "ButtonOp";
    case "onNodeInput":
      return transactionType === "NodeInputOp";
    case "onModuleUpdate":
      return transactionType === "ModuleOp";
    case "onWebhook":
      return transactionType === "WebhookOp";
    case "onSchedule":
      return transactionType === "ScheduleOp";
    case "manual":
      return false;
    default:
      return false;
  }
}

/**
 * Evaluate a triggerObject's subject/target filter against the transaction.
 * Empty targetId ("") means "no filter — match any".
 *
 * See docs/superpowers/specs/2026-04-24-operations-editor-fix-design.md §1 for
 * the full subject → filter mapping table.
 */
function matchSubjectFilter(to, eventType, transaction) {
  const { subjectType, subjectRole, targetId } = to || {};
  if (!targetId) return true;

  if (subjectType === "field") return transaction?.fieldId === targetId;
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
export function runMatchingOperations(operations, transactionType, transaction, context, { onError } = {}) {
  const updates = [];
  // Priority (1–10, default 5) wins over sortOrder so a high-priority op like the
  // schedule auto-build runs to completion before downstream ops (field stamp,
  // aggregations) read its newly-created occurrences.
  const ordered = [...operations].sort((a, b) => {
    const pa = a.priority ?? 5;
    const pb = b.priority ?? 5;
    if (pa !== pb) return pa - pb;
    return (a.sortOrder ?? 50) - (b.sortOrder ?? 50);
  });
  for (const op of ordered) {
    const match = computeTriggerMatch(op, transactionType, transaction);
    if (!match) continue;
    const startedAt = Date.now();
    const logger = makeLogger();
    logger.add("start", {
      opId: op.id,
      opName: op.name,
      transactionType,
      trigger: transaction ? { ...transaction } : null,
      matchedTriggerObject: match.triggerObject,
    });
    try {
      let results;
      if (op.pipeline) {
        results = executePipeline(op, context, transaction, undefined, logger);
      } else {
        results = executeOperation(op, transactionType, transaction, context);
      }
      updates.push(...results);
      logger.add("end", { updates: results, durationMs: Date.now() - startedAt });
    } catch (err) {
      console.warn(`[operationExecutor] error in operation "${op.name}":`, err);
      logger.add("error", { message: String(err?.message || err), stack: err?.stack });
      onError?.(op.name, err);
    }
    recordRunLog(op.id, { runAt: startedAt, durationMs: Date.now() - startedAt, entries: logger.entries });
  }
  return updates;
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

  // Build reverse parent map from occurrences[] arrays.
  // parentId on the occurrence itself is not always set — the authoritative ordering
  // is maintained via parent.occurrences[] — so we derive the parent from those arrays.
  const parentByChildId = {};
  for (const occ of Object.values(occurrencesById)) {
    for (const childId of (occ.occurrences || [])) {
      parentByChildId[childId] = occ.id;
    }
  }

  // Resolve an ancestor chain (closest ancestor first, capped at depth 12).
  // Used to enrich $allOccurrences items so HAS_ANCESTOR rules in $allOccurrences-driven
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

  // Pre-enrich every occurrence so $allOccurrences-driven loops can see _ancestors
  // without needing to convert them through gatherLoopItems first. Spread leaves the
  // original Redux-state object untouched.
  const allOccurrencesEnriched = Object.values(occurrencesById).map(occ => ({
    ...occ,
    _ancestors: ancestorsFor(occ.id),
  }));

  // ---- Build $vars ----
  const _nowDate = new Date();
  const _activeIteration = (state?.grid?.iterations ?? []).find(i => i.id === state?.grid?.selectedIterationId);
  const $vars = {
    _log: logger,
    _occurrencesById: occurrencesById,
    _fieldsById: fieldsById,
    $now: _nowDate.toISOString(),
    $today: _nowDate.toISOString().slice(0, 10),
    $currentDate: _nowDate.toISOString().slice(0, 10),
    $currentHour: _nowDate.getHours(),
    $currentTime: _nowDate.toTimeString().slice(0, 5),
    $iterationId: state?.grid?.selectedIterationId ?? null,
    $iterationValue: state?.grid?.currentIterationValue ?? null,
    $iterationFilter: _activeIteration?.timeFilter ?? null,
    // Active filter date — scoped to the operation's target occurrence (not grid-global).
    // Walks the parent chain via filterOverride so each panel/container sees its own date.
    // Returns null when no date filter active (callers wanting today should use $today).
    $activeDate: (() => {
      const targetOccId = operation.targetOccurrenceId;
      const targetOcc = targetOccId ? occurrencesById[targetOccId] : null;
      const efv = getEffectiveFilterForOccurrence(targetOcc, { grid: state?.grid, occurrencesById });
      const dateVal = Object.values(efv).find(v => v && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v));
      return dateVal ? dateVal.slice(0, 10) : null;
    })(),
    // Alias for legacy callers. Same scoped semantics as $activeDate.
    $filterDate: (() => {
      const targetOccId = operation.targetOccurrenceId;
      const targetOcc = targetOccId ? occurrencesById[targetOccId] : null;
      const efv = getEffectiveFilterForOccurrence(targetOcc, { grid: state?.grid, occurrencesById });
      const dateVal = Object.values(efv).find(v => v && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v));
      return dateVal ? dateVal.slice(0, 10) : null;
    })(),
    // Formatted labels for the active date — used in COMPUTE_TEXTMAP_FROM_TEMPLATE tokens
    $activeDateLabel: (() => {
      const targetOccId = operation.targetOccurrenceId;
      const targetOcc = targetOccId ? occurrencesById[targetOccId] : null;
      const efv = getEffectiveFilterForOccurrence(targetOcc, { grid: state?.grid, occurrencesById });
      const dateVal = Object.values(efv).find(v => v && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v));
      const d = dateVal ? new Date(dateVal + "T00:00:00") : _nowDate;
      return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    })(),
    $activeDayOfWeek: (() => {
      const targetOccId = operation.targetOccurrenceId;
      const targetOcc = targetOccId ? occurrencesById[targetOccId] : null;
      const efv = getEffectiveFilterForOccurrence(targetOcc, { grid: state?.grid, occurrencesById });
      const dateVal = Object.values(efv).find(v => v && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v));
      const d = dateVal ? new Date(dateVal + "T00:00:00") : _nowDate;
      return d.toLocaleDateString("en-US", { weekday: "long" });
    })(),
    // Templates + iteration definitions
    $templates: state?.grid?.templates ?? [],
    $iterationDefinitions: state?.grid?.iterations ?? [],
    // Built-in arrays — loop-ready collections of everything in the system
    $allOccurrences: allOccurrencesEnriched,
    $allModules: state?.modules ?? [],
    $allFields: Object.values(fieldsById),
    $grid: state?.grid ?? {},
  };
  // Always set $trigger so pipeline steps can check $trigger.type without null guards.
  $vars["$trigger"] = { type: transaction?.type || "onLoad" };
  if (transaction && typeof transaction === "object") {
    // Enrich $trigger with the full occurrence when the transaction references one.
    // This makes $trigger.occurrence.fields.water.value work in stamp/onAdd operations
    // without requiring the user to configure a separate source.
    // type is explicitly seeded first so it's always present even when transaction is empty.
    const enriched = { type: transaction?.type || "onLoad", ...transaction };
    const occId = transaction.occurrenceId;
    if (occId && occurrencesById[occId]) {
      const occ = occurrencesById[occId];
      const fields = {};
      for (const [fid, fdata] of Object.entries(occ.fields || {})) {
        fields[fid] = {
          value: fdata?.value !== undefined ? fdata.value : fdata,
          flow: fdata?.flow ?? null,
        };
      }
      enriched.occurrence = {
        id: occ.id,
        targetId: occ.targetId,
        parentId: occ.parentId,
        fields,
      };
    }
    $vars["$trigger"] = enriched;
  }

  // ---- $parentFilter: effective filter values applied to the trigger occurrence's parent ----
  // Walks the parent chain via parentByChildId (parent.occurrences[] is authoritative)
  // and merges each ancestor's `filterOverride` on top of grid.activeFilterValues.
  // `.date` is a convenience accessor returning the first YYYY-MM-DD value found in the merged map.
  $vars["$parentFilter"] = (() => {
    const triggerOccId = transaction?.occurrenceId;
    const gridFilters = state?.grid?.activeFilterValues || {};
    let effective = { ...gridFilters };
    if (triggerOccId) {
      // Collect ancestors from immediate parent upward
      const chain = [];
      let cur = parentByChildId[triggerOccId];
      while (cur) {
        const occ = occurrencesById[cur];
        if (!occ) break;
        chain.push(occ);
        cur = parentByChildId[cur];
      }
      // Merge top-down so closer ancestors win over distant ones
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
        iterationTimeValue: mod.placement?.iterationTimeValue,
        iterationCategoryValue: mod.placement?.iterationCategoryValue,
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
          targetId: occ.targetId,
          parentId: occ.parentId,
          fields,
          _ancestors: [],  // will be populated below
          _iterationTimeValue: occ.iteration?.timeValue || occ.iteration?.value,
          _iterationCategoryValue: occ.iteration?.categoryValue,
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
    } else {
      // instance / container — aggregate field values across occurrences targeting this entity
      const occs = Object.values(occurrencesById).filter(o => o.targetId === entityId);
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
  const sourceSummary = {};
  for (const [k, v] of Object.entries($vars)) {
    if (k.startsWith("_")) continue;
    if (k.startsWith("$all") || k === "$grid" || k === "$templates" || k === "$iterationDefinitions") {
      sourceSummary[k] = Array.isArray(v) ? `[Array(${v.length})]` : "[Object]";
    } else {
      sourceSummary[k] = v;
    }
  }
  logger.add("sources", { vars: sourceSummary });

  // ---- Execute steps (top-down code flow) ----
  return executeSteps(steps, $vars, contextWithExecutors, transaction);
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
  const log = $vars._log;
  const updates = [];
  for (const step of steps || []) {
    if (step.type === "action") {
      const actionType = step.config?.type || step.actionType;
      const result = executeActionItem(actionType, step.config || {}, $vars, context, transaction);
      log?.add("action", { actionType, config: step.config, resultCount: result.length, result });
      updates.push(...result);
    } else if (step.type === "if") {
      const group = step.condition || { operator: "AND", rules: step.rules || [] };
      const branch = evalGroup(group, $vars);
      log?.add("if", { condition: group, branch: branch ? "then" : "else" });
      if (branch) {
        updates.push(...executeSteps(step.then || [], $vars, context, transaction));
      } else {
        updates.push(...executeSteps(step.else || [], $vars, context, transaction));
      }
    } else if (step.type === "loop") {
      // LOOP: iterate over any array expression or legacy typed collection.
      // step.overExpr = any expression resolving to an array (e.g. "$allOccurrences", "$myArr")
      // step.over = legacy typed string (e.g. "field_occurrences") — still supported
      // $vars is shared so variable mutations (ADD_TO_VAR) accumulate across iterations
      const varName = step.as || "$item";
      let items;
      if (step.overExpr) {
        const resolved = resolveExpr(step.overExpr, $vars);
        items = Array.isArray(resolved) ? resolved : (resolved != null ? Object.values(resolved) : []);
      } else {
        items = gatherLoopItems(step, context, $vars);
      }
      log?.add("loop", { over: step.overExpr || step.over, as: varName, itemCount: items.length });
      for (const item of items) {
        $vars[varName] = item;
        updates.push(...executeSteps(step.body || [], $vars, context, transaction));
      }
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
    if (step.targetId) {
      const resolvedTargetId = resolveExpr(step.targetId, $vars) || step.targetId;
      occsAll = occsAll.filter(o => o.targetId === resolvedTargetId);
    }
    if (step.parentId) {
      const resolvedParentId = resolveExpr(step.parentId, $vars) || step.parentId;
      occsAll = occsAll.filter(o => o.parentId === resolvedParentId);
    }
    return occsAll.map(occ => {
      const item = { occurrenceId: occ.id, targetId: occ.targetId, parentId: occ.parentId,
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
    occs = occs.filter(o => o.targetId === resolvedModuleId);
    return occs
      .sort((a, b) => {
        const aTime = new Date(a.iteration?.timeValue || a.iteration?.value || 0).getTime();
        const bTime = new Date(b.iteration?.timeValue || b.iteration?.value || 0).getTime();
        return bTime - aTime; // newest first
      })
      .map(occ => ({
        occurrenceId: occ.id,
        targetId: occ.targetId,
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
      if (occ.targetId === resolvedId && Array.isArray(occ.occurrences)) {
        for (const childId of occ.occurrences) scopeOccIds.add(childId);
      }
    }
    occs = occs.filter(o => scopeOccIds.has(o.id));
  }

  // ---- CONTAINER_ITEMS: all occurrences in container, exposing instance label + fields ----
  if (over === "container_items") {
    const modulesById = Object.fromEntries((state?.modules || []).map(m => [m.id, m]));
    return occs.map(occ => {
      const inst = modulesById[occ.targetId];
      const item = {
        occurrenceId: occ.id,
        instanceId: occ.targetId,
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
      targetId: occ.targetId,
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
