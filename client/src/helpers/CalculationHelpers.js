// helpers/CalculationHelpers.js
// ============================================================
// Calculation helpers for derived fields
// Supports aggregations, targets, conditions, and complex rules
// Constants (AGGREGATIONS, COMPARISONS, etc.) are in calculationConstants.js
// ============================================================

// Re-export all constants for backwards compatibility — importers don't need to change
export {
  AGGREGATIONS,
  COMPARISONS,
  INPUT_FLOWS,
  DERIVED_FLOWS,
  PERSISTENCE_MODES,
  SCOPES,
  TIME_FILTERS,
  TIME_FILTER_MULTIPLIERS,
} from "./calculationConstants.js";
import { AGGREGATIONS, COMPARISONS, INPUT_FLOWS, DERIVED_FLOWS, PERSISTENCE_MODES, SCOPES, TIME_FILTERS, TIME_FILTER_MULTIPLIERS } from "./calculationConstants.js";

/**
 * Build a lookup map from an array of items with .id property
 * Used to normalize state arrays into byId maps for efficient lookups
 */
function buildLookupFromArray(items = []) {
  const map = {};
  for (const item of items) {
    if (item?.id) map[item.id] = item;
  }
  return map;
}

/**
 * Get the day-of-year for a given date (1-366)
 */
function getDayOfYear(date) {
  const d = new Date(date);
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d - start;
  const oneDay = 1000 * 60 * 60 * 24;
  return Math.floor(diff / oneDay);
}

/**
 * Simple seeded random number generator (mulberry32)
 * Returns a function that produces deterministic values 0-1 for a given seed
 */
function seededRandom(seed) {
  let t = seed | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Build a numeric seed from a date string (YYYY-MM-DD)
 * Same date always produces the same seed
 */
function dateSeed(date) {
  const d = new Date(date);
  // Combine year, month, day into a single integer
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/**
 * Scale a target value from its base time filter to the current viewing time filter
 *
 * @param {number} targetValue - The base target value
 * @param {string} targetTimeFilter - The time filter the target was set for ('daily', 'weekly', etc.)
 * @param {string} currentTimeFilter - The time filter we're currently viewing
 * @returns {number} The scaled target value
 *
 * @example
 * // If target is "3 per day" and we're viewing weekly:
 * scaleTarget(3, "daily", "weekly") // => 21
 *
 * // If target is "100 per month" and we're viewing daily:
 * scaleTarget(100, "monthly", "daily") // => 3.33
 */
export function scaleTarget(targetValue, targetTimeFilter, currentTimeFilter) {
  if (targetValue === null || targetValue === undefined) return null;
  if (!targetTimeFilter || !currentTimeFilter) return targetValue;
  if (targetTimeFilter === currentTimeFilter) return targetValue;
  if (targetTimeFilter === "inherit" || targetTimeFilter === "all") return targetValue;
  if (currentTimeFilter === "inherit" || currentTimeFilter === "all") return targetValue;

  const targetMultiplier = TIME_FILTER_MULTIPLIERS[targetTimeFilter] || 1;
  const currentMultiplier = TIME_FILTER_MULTIPLIERS[currentTimeFilter] || 1;

  // Scale from target's base period to current viewing period
  // e.g., 3 per day × (7 days / 1 day) = 21 per week
  return targetValue * (currentMultiplier / targetMultiplier);
}

/**
 * Get the effective time filter for a derived field source
 * Handles "inherit" by using the parent iteration
 *
 * @param {string} sourceTimeFilter - The time filter from the derived field source ('daily', 'inherit', etc.)
 * @param {string} parentTimeFilter - The resolved parent iteration time filter
 * @returns {string} The effective time filter to use
 */
export function resolveSourceTimeFilter(sourceTimeFilter, parentTimeFilter) {
  if (!sourceTimeFilter || sourceTimeFilter === "inherit") {
    return parentTimeFilter || "daily";
  }
  return sourceTimeFilter;
}

/**
 * Resolve the effective iteration for an item by walking up the parent chain
 * Hierarchy: Instance → Container → Panel → Grid
 *
 * @param {Object} item - The item (instance, container, or panel)
 * @param {string} itemType - 'instance', 'container', or 'panel'
 * @param {Object} lookups - { containersById, panelsById, grid }
 * @returns {Object} { timeFilter, source } - resolved iteration and where it came from
 */
export function resolveEffectiveIteration(item, itemType, lookups = {}) {
  const { containersById = {}, panelsById = {}, grid } = lookups;

  // Get the grid's current iteration timeFilter as the fallback
  const iterations = grid?.iterations || [];
  const selectedIterationId = grid?.selectedIterationId || "default";
  const gridIteration = iterations.find(i => i.id === selectedIterationId) || iterations[0];
  const gridTimeFilter = gridIteration?.timeFilter || "daily";

  // Walk up the chain based on item type
  let current = item;
  let currentType = itemType;
  let source = "grid";

  while (current) {
    const iteration = current.iteration;

    // If this item has mode: "own", use its timeFilter
    if (iteration?.mode === "own") {
      return {
        timeFilter: iteration.timeFilter || "daily",
        source: currentType,
      };
    }

    // Otherwise, walk up to parent
    if (currentType === "instance") {
      // Instance → Container
      current = containersById[current.parentId];
      currentType = "container";
    } else if (currentType === "container") {
      // Container → Panel
      const panelId = current.panelId;
      current = panelsById[panelId];
      currentType = "panel";
    } else if (currentType === "panel") {
      // Panel → Grid (end of chain)
      break;
    } else {
      break;
    }
  }

  // Fallback to grid's iteration
  return { timeFilter: gridTimeFilter, source };
}

/**
 * Check if a date falls within a time period
 */
function dateMatchesPeriod(occDate, targetDate, timeFilter) {
  if (!occDate || !targetDate) return false;

  const oDate = new Date(occDate);
  oDate.setHours(0, 0, 0, 0);
  const tDate = new Date(targetDate);
  tDate.setHours(0, 0, 0, 0);

  switch (timeFilter) {
    case "daily":
      return oDate.getTime() === tDate.getTime();

    case "weekly": {
      const targetWeekStart = new Date(tDate);
      targetWeekStart.setDate(tDate.getDate() - tDate.getDay());
      const targetWeekEnd = new Date(targetWeekStart);
      targetWeekEnd.setDate(targetWeekStart.getDate() + 7);
      return oDate >= targetWeekStart && oDate < targetWeekEnd;
    }

    case "monthly":
      return oDate.getFullYear() === tDate.getFullYear() &&
             oDate.getMonth() === tDate.getMonth();

    case "yearly":
      return oDate.getFullYear() === tDate.getFullYear();

    default:
      return true;
  }
}

/**
 * Filter occurrences for VISIBILITY (what to show in UI)
 * Handles persistence modes:
 * - persistent: Always show
 * - specific: Only show on matching iteration date
 * - untilDone: Show until completed, then only on completion date
 *
 * @param {Array} occurrences - Array of occurrences
 * @param {string} timeFilter - 'daily', 'weekly', 'monthly', 'yearly'
 * @param {Date|string} currentDate - The date being viewed
 * @param {Object} options - { fieldsById } for checking completion status
 * @returns {Array} Filtered occurrences
 */
export function filterOccurrencesForVisibility(occurrences, timeFilter, currentDate, options = {}) {
  const { categoryKey = null, categoryValue = null } = options;

  let filtered = occurrences;

  // Apply category filter if specified
  if (categoryKey && categoryValue) {
    filtered = filtered.filter(occ => {
      const occCategory = occ.iteration?.categoryValue;
      // Show if no category set (applies to all) or matches
      return !occCategory || occCategory === categoryValue;
    });
  }

  // Apply time filter if specified
  if (!timeFilter || timeFilter === "all" || !currentDate) {
    return filtered;
  }

  const targetDate = new Date(currentDate);
  targetDate.setHours(0, 0, 0, 0);

  return filtered.filter(occ => {
    const mode = occ.iteration?.mode || "specific";

    // Persistent occurrences always show
    if (mode === "persistent") {
      return true;
    }

    // "untilDone" mode: show if not completed, or if completed on this iteration
    if (mode === "untilDone") {
      const completedOn = occ.iteration?.completedOn;

      // Not completed yet - show on all iterations
      if (!completedOn) {
        return true;
      }

      // Completed - only show on the iteration it was completed
      return dateMatchesPeriod(completedOn, targetDate, timeFilter);
    }

    // "specific" mode: only show if iteration.value matches current date
    // Use timeValue if set (compound iterations), else fall back to legacy value/createdAt
    const occIterationDate = occ.iteration?.timeValue || occ.iteration?.value || occ.createdAt || occ.meta?.createdAt;
    return dateMatchesPeriod(occIterationDate, targetDate, timeFilter);
  });
}

/**
 * Filter occurrences for CALCULATIONS (what to aggregate)
 * Only includes non-persistent occurrences that match the iteration
 * Persistent items are templates - their copies get aggregated, not the templates
 * Supports compound iterations (time + category)
 *
 * @param {Array} occurrences - Array of occurrences
 * @param {string} timeFilter - 'daily', 'weekly', 'monthly', 'yearly'
 * @param {Date|string} currentDate - The date being viewed
 * @param {Object} options - { categoryKey, categoryValue } for compound filtering
 * @returns {Array} Filtered occurrences for calculation
 */
export function filterOccurrencesForCalculation(occurrences, timeFilter, currentDate, options = {}) {
  const { categoryKey = null, categoryValue = null } = options;

  let filtered = occurrences;

  // Apply category filter if specified
  if (categoryKey && categoryValue) {
    filtered = filtered.filter(occ => {
      const occCategory = occ.iteration?.categoryValue;
      // Only include if category matches (null category = all categories, so include)
      return !occCategory || occCategory === categoryValue;
    });
  }

  // Exclude persistent templates from calculations
  filtered = filtered.filter(occ => occ.iteration?.mode !== "persistent");

  if (!timeFilter || timeFilter === "all" || !currentDate) {
    return filtered;
  }

  const targetDate = new Date(currentDate);
  targetDate.setHours(0, 0, 0, 0);

  return filtered.filter(occ => {
    const mode = occ.iteration?.mode || "specific";

    // "untilDone" mode: only count if completed on this iteration
    if (mode === "untilDone") {
      const completedOn = occ.iteration?.completedOn;

      // Not completed - don't count yet
      if (!completedOn) {
        return false;
      }

      // Completed - count on the iteration it was completed
      return dateMatchesPeriod(completedOn, targetDate, timeFilter);
    }

    // "specific" mode: count if iteration date matches current date
    // Use timeValue if set (compound iterations), else fall back to legacy value/createdAt
    const occIterationDate = occ.iteration?.timeValue || occ.iteration?.value || occ.createdAt || occ.meta?.createdAt;
    return dateMatchesPeriod(occIterationDate, targetDate, timeFilter);
  });
}

/**
 * Filter occurrences by iteration (timeFilter + currentDate + optional category)
 * This is the legacy function - now calls filterOccurrencesForCalculation
 *
 * @param {Array} occurrences - Array of occurrences
 * @param {string} timeFilter - 'daily', 'weekly', 'monthly', 'yearly'
 * @param {Date|string} currentDate - The date being viewed (center of the period)
 * @param {Object} options - { categoryKey, categoryValue } for compound filtering
 * @returns {Array} Filtered occurrences
 */
export function filterOccurrencesByIteration(occurrences, timeFilter, currentDate, options = {}) {
  return filterOccurrencesForCalculation(occurrences, timeFilter, currentDate, options);
}

/**
 * Filter occurrences by scope
 */
export function filterOccurrencesByScope(occurrences, scope, context = {}) {
  const { gridId, panelId, containerId, instanceId } = context;

  switch (scope) {
    case "grid":
      return occurrences.filter(occ => occ.gridId === gridId);

    case "panel":
      return occurrences.filter(occ =>
        occ.gridId === gridId && occ.meta?.panelId === panelId
      );

    case "container":
      return occurrences.filter(occ =>
        occ.gridId === gridId && occ.parentId === containerId
      );

    case "instance":
      return occurrences.filter(occ =>
        occ.gridId === gridId && occ.targetId === instanceId
      );

    default:
      return occurrences;
  }
}

/**
 * Filter occurrences by time
 */
export function filterOccurrencesByTime(occurrences, timeFilter = "all") {
  const filter = TIME_FILTERS[timeFilter];
  if (!filter || timeFilter === "all") return occurrences;
  return occurrences.filter(filter.fn);
}

/**
 * Extract field values from occurrences
 *
 * @param {Array} occurrences - Array of occurrences
 * @param {string} fieldId - Field ID to extract values from
 * @param {Object} options - Options for extraction
 * @param {string} options.flowFilter - 'any', 'in', or 'out' - which flows to include
 * @returns {Array} Array of values (with sign applied based on flow)
 */
export function extractFieldValues(occurrences, fieldId, options = {}) {
  const { flowFilter = "any" } = options;

  // Normalize flowFilter: "any" = all flows, string = single flow, array = multiple flows
  const allowedFlows = flowFilter === "any"
    ? null // null means accept all
    : Array.isArray(flowFilter)
      ? flowFilter
      : [flowFilter];

  return occurrences
    .map(occ => {
      const fieldData = occ.fields?.[fieldId];
      if (fieldData === undefined || fieldData === null) return null;

      // Handle simple values (backwards compatibility — treated as "in" flow)
      if (typeof fieldData !== "object") {
        if (allowedFlows && !allowedFlows.includes("in")) return null;
        return fieldData;
      }

      // Handle { value, flow } format
      const { value, flow = "in" } = fieldData;
      if (value === undefined || value === null) return null;

      // Filter by flow type (null = accept all)
      if (allowedFlows && !allowedFlows.includes(flow)) {
        return null;
      }

      // Apply sign based on flow
      if (typeof value === "number") {
        return flow === "out" ? -value : value;
      }

      return value;
    })
    .filter(v => v !== null);
}

/**
 * Apply aggregation to values
 */
export function applyAggregation(values, aggregation, options = {}) {
  const agg = AGGREGATIONS[aggregation];
  if (!agg) {
    console.warn(`Unknown aggregation: ${aggregation}`);
    return null;
  }
  return agg.fn(values, options);
}

/**
 * Check if a value meets a target condition
 *
 * @param {number} value - The calculated value
 * @param {Object} target - Target config { value, op, timeFilter }
 * @param {string} currentTimeFilter - The current viewing time filter (for scaling)
 * @returns {boolean|null} Whether target is met, or null if no target
 */
export function checkTarget(value, target, currentTimeFilter = null) {
  if (!target || target.value === undefined) return null;

  const comparison = COMPARISONS[target.op || ">="];
  if (!comparison) return false;

  // Scale the target if viewing in a different time period
  let scaledTarget = target.value;
  if (currentTimeFilter && target.timeFilter && target.timeFilter !== "inherit") {
    scaledTarget = scaleTarget(target.value, target.timeFilter, currentTimeFilter);
  }

  return comparison.fn(value, scaledTarget);
}

/**
 * Get the scaled target value for display
 *
 * @param {Object} target - Target config { value, op, timeFilter }
 * @param {string} currentTimeFilter - The current viewing time filter
 * @returns {number|null} The scaled target value
 */
export function getScaledTargetValue(target, currentTimeFilter) {
  if (!target || target.value === undefined) return null;

  if (currentTimeFilter && target.timeFilter && target.timeFilter !== "inherit") {
    return scaleTarget(target.value, target.timeFilter, currentTimeFilter);
  }

  return target.value;
}

/**
 * Calculate progress towards a target (0-100%)
 *
 * @param {number} value - The calculated value
 * @param {Object} target - Target config { value, op, timeFilter }
 * @param {string} currentTimeFilter - The current viewing time filter (for scaling)
 * @returns {number|null} Progress percentage, or null if no target
 */
export function calculateProgress(value, target, currentTimeFilter = null) {
  if (!target || target.value === undefined || target.value === 0) return null;

  // Scale the target if viewing in a different time period
  let scaledTarget = target.value;
  if (currentTimeFilter && target.timeFilter && target.timeFilter !== "inherit") {
    scaledTarget = scaleTarget(target.value, target.timeFilter, currentTimeFilter);
  }

  if (scaledTarget === 0) return null;

  const progress = (value / scaledTarget) * 100;
  return Math.min(Math.max(progress, 0), 100);
}


/**
 * Get aggregation options for a given field type
 */
export function getAggregationsForType(fieldType) {
  return Object.entries(AGGREGATIONS)
    .filter(([, config]) => config.types.includes(fieldType))
    .map(([value, config]) => ({
      value,
      label: config.label,
      symbol: config.symbol,
      description: config.description,
    }));
}

/**
 * Get aggregation label for display
 */
export function getAggregationLabel(aggregation) {
  return AGGREGATIONS[aggregation]?.label || aggregation;
}

/**
 * Calculate streak (consecutive occurrences meeting a condition)
 * Useful for habit tracking
 */
export function calculateStreak(occurrences, fieldId, condition = Boolean) {
  // Sort by date descending (most recent first)
  const sorted = [...occurrences].sort((a, b) => {
    const dateA = new Date(a.createdAt || a.meta?.createdAt || 0);
    const dateB = new Date(b.createdAt || b.meta?.createdAt || 0);
    return dateB - dateA;
  });

  let streak = 0;
  for (const occ of sorted) {
    const value = occ.fields?.[fieldId];
    if (condition(value)) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/**
 * Calculate rolling average over N most recent occurrences
 */
export function calculateRollingAverage(occurrences, fieldId, windowSize = 7) {
  // Sort by date descending
  const sorted = [...occurrences].sort((a, b) => {
    const dateA = new Date(a.createdAt || a.meta?.createdAt || 0);
    const dateB = new Date(b.createdAt || b.meta?.createdAt || 0);
    return dateB - dateA;
  });

  const window = sorted.slice(0, windowSize);
  const values = extractFieldValues(window, fieldId);

  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Format a calculated value with prefix/postfix
 */
export function formatValue(value, meta = {}) {
  const { prefix = "", postfix = "", precision = 2 } = meta;

  if (value === null || value === undefined) {
    return `${prefix}-${postfix}`;
  }

  let formatted = value;
  if (typeof value === "number") {
    formatted = Number.isInteger(value) ? value : value.toFixed(precision);
  }

  return `${prefix}${formatted}${postfix}`;
}

export default {
  AGGREGATIONS,
  COMPARISONS,
  SCOPES,
  TIME_FILTERS,
  TIME_FILTER_MULTIPLIERS,
  INPUT_FLOWS,
  DERIVED_FLOWS,
  PERSISTENCE_MODES,
  scaleTarget,
  resolveSourceTimeFilter,
  resolveEffectiveIteration,
  filterOccurrencesByScope,
  filterOccurrencesByTime,
  filterOccurrencesByIteration,
  filterOccurrencesForVisibility,
  filterOccurrencesForCalculation,
  extractFieldValues,
  applyAggregation,
  checkTarget,
  getScaledTargetValue,
  calculateProgress,
  getAggregationsForType,
  getAggregationLabel,
  calculateStreak,
  calculateRollingAverage,
  formatValue,
};
