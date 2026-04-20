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
 *
 * Supports:
 *  - op.triggerType (string) — single trigger, legacy
 *  - op.triggerTypes (string[]) — multiple triggers (any match fires)
 *  - op.triggerConfig — optional filter per trigger type:
 *      onChange:   { fieldId?, instanceId? }
 *      onDrop:     { targetContainerId?, targetPanelId?, fromContainerId? }
 *
 * @param {Object}      operation
 * @param {string|null} transactionType  — "MeasureOp"|"OccurrenceListOp"|"IterationOp"|null
 * @param {Object}      [transaction]    — the transaction object (optional, for triggerConfig checks)
 */
export function shouldTrigger(operation, transactionType, transaction) {
  if (!operation?.enabled) return false;

  const hasExplicitArray = Array.isArray(operation.triggerTypes);
  // Support both single string and array of trigger types
  const types = hasExplicitArray
    ? operation.triggerTypes
    : [operation.triggerType].filter(Boolean);

  if (types.length === 0) {
    // Fallback: fire on load if no trigger defined
    return transactionType == null;
  }

  const cfg = operation.triggerConfig || {};

  // Normal check — does any declared trigger match?
  if (types.some(t => matchesTrigger(t, cfg, transactionType, transaction))) {
    return true;
  }

  // Backward compat: old operations using legacy triggerType string (no
  // triggerTypes array) should still fire on load even though they don't
  // explicitly list "onLoad". New operations created via the UI always have
  // a triggerTypes array — respect those literally.
  // Exception: onChange-only operations must NOT fire on load — they have no
  // data to react to and would just run spuriously on every page load.
  if (transactionType == null && !hasExplicitArray && types[0] !== "manual" && types[0] !== "onChange") {
    return true;
  }

  return false;
}

/**
 * Check if a single trigger type matches the current transaction context.
 */
function matchesTrigger(t, cfg, transactionType, transaction) {
  switch (t) {
    case "onChange": {
      if (transactionType !== "MeasureOp") return false;
      // Support both singular fieldId and plural allowedFields array
      const fieldFilter = cfg.onChange?.fieldId || cfg.fieldId;
      if (fieldFilter && transaction?.fieldId !== fieldFilter) return false;
      const allowedFields = cfg.onChange?.allowedFields;
      if (allowedFields?.length > 0 && !allowedFields.includes(transaction?.fieldId)) return false;
      const instanceFilter = cfg.onChange?.instanceId || cfg.instanceId;
      if (instanceFilter && transaction?.instanceId !== instanceFilter) return false;
      return true;
    }
    case "onFieldChange": {
      // Alias of onChange with a clearer label. Falls back to onChange config if onFieldChange isn't set.
      if (transactionType !== "MeasureOp") return false;
      const fieldFilter = cfg.onFieldChange?.fieldId || cfg.onChange?.fieldId || cfg.fieldId;
      if (fieldFilter && transaction?.fieldId !== fieldFilter) return false;
      const allowedFields = cfg.onFieldChange?.allowedFields || cfg.onChange?.allowedFields;
      if (allowedFields?.length > 0 && !allowedFields.includes(transaction?.fieldId)) return false;
      const instanceFilter = cfg.onFieldChange?.instanceId || cfg.onChange?.instanceId || cfg.instanceId;
      if (instanceFilter && transaction?.instanceId !== instanceFilter) return false;
      return true;
    }
    case "onDrop": {
      if (transactionType !== "OccurrenceListOp") return false;
      const toContainer = cfg.onDrop?.targetContainerId || cfg.targetContainerId;
      if (toContainer && transaction?.toContainerId !== toContainer) return false;
      const toPanel = cfg.onDrop?.targetPanelId || cfg.targetPanelId;
      if (toPanel && transaction?.toPanelId !== toPanel) return false;
      const fromContainer = cfg.onDrop?.fromContainerId || cfg.fromContainerId;
      if (fromContainer && transaction?.fromContainerId !== fromContainer) return false;
      return true;
    }
    case "onCreate": {
      if (transactionType !== "OccurrenceCreateOp") return false;
      const containerFilter = cfg.onCreate?.containerId;
      if (containerFilter && transaction?.containerId !== containerFilter) return false;
      const panelFilter = cfg.onCreate?.panelId;
      if (panelFilter && transaction?.panelId !== panelFilter) return false;
      return true;
    }
    case "onDelete": {
      if (transactionType !== "OccurrenceDeleteOp") return false;
      const containerFilter = cfg.onDelete?.containerId;
      if (containerFilter && transaction?.containerId !== containerFilter) return false;
      return true;
    }
    case "onMove": {
      if (transactionType !== "OccurrenceMoveOp") return false;
      const toContainer = cfg.onMove?.toContainerId;
      if (toContainer && transaction?.toContainerId !== toContainer) return false;
      const fromContainer = cfg.onMove?.fromContainerId;
      if (fromContainer && transaction?.fromContainerId !== fromContainer) return false;
      const fromPanel = cfg.onMove?.fromPanelId;
      if (fromPanel && transaction?.fromPanelId !== fromPanel) return false;
      const toPanel = cfg.onMove?.toPanelId;
      if (toPanel && transaction?.toPanelId !== toPanel) return false;
      return true;
    }
    case "onComplete": {
      if (transactionType !== "MeasureOp") return false;
      // Only fire when value is truthy (checkbox checked, etc.)
      const val = transaction?.value;
      if (!val && val !== 1) return false;
      const fieldFilter = cfg.onComplete?.fieldId;
      if (fieldFilter && transaction?.fieldId !== fieldFilter) return false;
      return true;
    }
    case "onAdd": {
      // Synonym for onCreate — fires when an occurrence is added to a parent
      if (transactionType !== "OccurrenceCreateOp") return false;
      const containerFilter = cfg.onAdd?.containerId;
      if (containerFilter && transaction?.containerId !== containerFilter) return false;
      const panelFilter = cfg.onAdd?.panelId;
      if (panelFilter && transaction?.panelId !== panelFilter) return false;
      return true;
    }
    case "onRemove": {
      // Fires when an occurrence is removed from a parent (same event as delete in current arch)
      if (transactionType !== "OccurrenceDeleteOp") return false;
      const containerFilter = cfg.onRemove?.containerId;
      if (containerFilter && transaction?.containerId !== containerFilter) return false;
      return true;
    }
    case "onReorder": {
      // Fires when occurrences are reordered within the same container
      if (transactionType !== "OccurrenceListOp") return false;
      // Only match same-container reorder (from === to)
      if (transaction?.fromContainerId !== transaction?.toContainerId) return false;
      const containerFilter = cfg.onReorder?.containerId;
      if (containerFilter && transaction?.toContainerId !== containerFilter) return false;
      return true;
    }
    case "onUncomplete": {
      // Inverse of onComplete — fires when a value goes falsy
      if (transactionType !== "MeasureOp") return false;
      const val = transaction?.value;
      if (val) return false; // Only fire when value is falsy
      const fieldFilter = cfg.onUncomplete?.fieldId;
      if (fieldFilter && transaction?.fieldId !== fieldFilter) return false;
      return true;
    }
    case "onButton": {
      if (transactionType !== "ButtonOp") return false;
      const opFilter = cfg.onButton?.operationId;
      if (opFilter && transaction?.operationId !== opFilter) return false;
      const instanceFilter = cfg.onButton?.instanceId;
      if (instanceFilter && transaction?.instanceId !== instanceFilter) return false;
      return true;
    }
    case "onNodeInput":    return transactionType === "NodeInputOp";
    case "onModuleUpdate": return transactionType === "ModuleOp";
    case "onFilterChange": return transactionType === "NavigationOp";
    case "onNavigation":   return transactionType === "NavigationOp";
    case "onIteration":    return transactionType === "NavigationOp"; // legacy alias
    case "onLoad":         return transactionType == null;
    case "onWebhook":      return transactionType === "WebhookOp";
    case "onSchedule": {
      if (transactionType !== "ScheduleOp") return false;
      const sc = cfg.onSchedule ?? {};
      // No hour/minute = fire every tick
      if (sc.hour == null && sc.minute == null) return true;
      const now = new Date();
      const hourMatch = sc.hour == null || now.getHours() === sc.hour;
      const minuteMatch = sc.minute == null || now.getMinutes() === sc.minute;
      return hourMatch && minuteMatch;
    }
    case "manual":         return false;
    default:               return transactionType == null;
  }
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
  const ordered = [...operations].sort((a, b) => (a.sortOrder ?? 50) - (b.sortOrder ?? 50));
  for (const op of ordered) {
    if (!shouldTrigger(op, transactionType, transaction)) continue;
    const startedAt = Date.now();
    const logger = makeLogger();
    logger.add("start", { opId: op.id, opName: op.name, transactionType, trigger: transaction ? { ...transaction } : null });
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
    $allOccurrences: Object.values(occurrencesById),
    $allModules: state?.modules ?? [],
    $allFields: Object.values(fieldsById),
    $grid: state?.grid ?? {},
  };
  // Always set $trigger so pipeline steps can check $trigger.type without null guards.
  $vars["$trigger"] = { type: transactionType || "onLoad" };
  if (transaction && typeof transaction === "object") {
    // Enrich $trigger with the full occurrence when the transaction references one.
    // This makes $trigger.occurrence.fields.water.value work in stamp/onAdd operations
    // without requiring the user to configure a separate source.
    // type is explicitly seeded first so it's always present even when transaction is empty.
    const enriched = { type: transactionType || "onLoad", ...transaction };
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
    const { variableName, entityType, entityId, nodeInput } = source;
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
