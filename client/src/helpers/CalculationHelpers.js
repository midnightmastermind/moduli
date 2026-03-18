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
      const containerId = current.meta?.containerId || current.containerId;
      current = containersById[containerId];
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
        occ.gridId === gridId && occ.meta?.containerId === containerId
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
 * Get the cache key for a derived field calculation
 * Used to determine if recalculation is needed
 *
 * Includes iteration context so calculations are recalculated when:
 * - The grid's selected iteration changes
 * - The viewing time filter changes
 * - Parent iteration settings change
 */
export function getDerivedFieldCacheKey(state, field, context = {}) {
  if (!field || field.mode !== "derived" || !field.metric) {
    return null;
  }

  const { metric } = field;
  const {
    fieldId: sourceFieldId,
    scope = "container",
    timeFilter = "all",
  } = metric;

  // Get relevant occurrences based on scope
  const allOccurrences = state.occurrences || [];
  const scopedOccurrences = filterOccurrencesByScope(allOccurrences, scope, context);
  const filteredOccurrences = filterOccurrencesByTime(scopedOccurrences, timeFilter);

  // Create a hash of only the relevant field values
  // This ensures we only recalculate when those specific values change
  const relevantValues = filteredOccurrences
    .map(occ => `${occ.id}:${occ.fields?.[sourceFieldId] ?? "null"}`)
    .join("|");

  // Include iteration context in cache key
  // This ensures recalculation when viewing period changes
  const { currentIteration, iterationDate } = context;
  const iterationKey = currentIteration || "default";
  const dateKey = iterationDate ? new Date(iterationDate).toISOString().split("T")[0] : "all";

  return `${field.id}:${scope}:${timeFilter}:${iterationKey}:${dateKey}:${relevantValues}`;
}

/**
 * Get only the relevant occurrences for a derived field calculation
 * Useful for memoization - only depends on specific occurrences
 */
export function getRelevantOccurrences(state, field, context = {}) {
  if (!field || field.mode !== "derived" || !field.metric) {
    return [];
  }

  const { metric } = field;
  const { scope = "container", timeFilter = "all" } = metric;

  const allOccurrences = state.occurrences || [];
  const scopedOccurrences = filterOccurrencesByScope(allOccurrences, scope, context);
  return filterOccurrencesByTime(scopedOccurrences, timeFilter);
}

/**
 * Calculate a derived field value
 *
 * @param {Object} state - Full app state (including selectedIterationId, currentIterationValue, grid.iterations)
 * @param {Object} field - Field definition with metric config
 * @param {Object} context - { gridId, panelId, containerId, instanceId }
 * @returns {any} Calculated value
 */
export function calculateDerivedField(state, field, context = {}) {
  if (!field || field.mode !== "derived" || !field.metric) {
    return null;
  }

  const { metric } = field;
  const {
    source = "occurrences",
    allowedFields = [],
    aggregation = "sum",
    options = {},
    // Legacy single field support
    fieldId: legacyFieldId,
  } = metric;

  // Only occurrence-based calculations for now
  if (source !== "occurrences") {
    console.warn(`Unknown metric source: ${source}`);
    return null;
  }

  // Get time iteration context from state
  const iterations = state.grid?.iterations || [];
  const selectedIterationId = state.selectedIterationId || "default";
  const currentIterationValue = state.currentIterationValue;
  const selectedIteration = iterations.find(i => i.id === selectedIterationId) || iterations[0];
  const iterationTimeFilter = selectedIteration?.timeFilter;

  // Get category iteration context from state (for compound filtering)
  const categoryDimensions = state.grid?.categoryDimensions || [];
  const selectedCategoryId = state.selectedCategoryId || state.grid?.selectedCategoryId;
  const currentCategoryValue = state.currentCategoryValue || state.grid?.currentCategoryValue;
  const selectedCategory = categoryDimensions.find(c => c.id === selectedCategoryId);

  // Get all occurrences in the grid
  let allOccurrences = state.occurrences || [];

  // Create byId lookups - use provided maps or build from arrays
  const containersById = state.containersById || buildLookupFromArray(state.containers);

  // Apply compound iteration filter (time + category)
  const iterationOptions = {
    categoryKey: selectedCategory?.id,
    categoryValue: currentCategoryValue,
  };

  if (iterationTimeFilter && currentIterationValue) {
    allOccurrences = filterOccurrencesByIteration(allOccurrences, iterationTimeFilter, currentIterationValue, iterationOptions);
  } else if (selectedCategory && currentCategoryValue) {
    // Category filter only (no time filter)
    allOccurrences = filterOccurrencesByIteration(allOccurrences, "all", null, iterationOptions);
  }

  let allValues = [];

  // If using new allowedFields format
  if (allowedFields.length > 0) {
    for (const allowedField of allowedFields) {
      const { fieldId, destinations = [], flowFilter = "any" } = allowedField;

      // Filter occurrences by destination (if specified)
      let filteredOccs = allOccurrences;

      if (destinations.length > 0) {
        filteredOccs = allOccurrences.filter(occ => {
          const occContainerId = occ.meta?.containerId;
          const occPanelId = containersById[occContainerId]?.panelId;

          for (const dest of destinations) {
            // Check if destination matches
            if (dest.id.startsWith("container:")) {
              const containerId = dest.id.replace("container:", "");
              if (occContainerId !== containerId) continue;
            } else if (dest.id.startsWith("panel:")) {
              const panelId = dest.id.replace("panel:", "");
              if (occPanelId !== panelId) continue;
            }

            // Apply time filter for this destination
            const timeFilter = dest.timeFilter || "all";
            if (timeFilter !== "all") {
              const filter = TIME_FILTERS[timeFilter];
              if (filter && !filter.fn(occ)) continue;
            }

            return true;
          }
          return false;
        });
      }

      // Extract values with flow filter
      const values = extractFieldValues(filteredOccs, fieldId, { flowFilter });
      allValues = allValues.concat(values);
    }
  } else if (legacyFieldId) {
    // Legacy single field support
    const relevantOccurrences = getRelevantOccurrences(state, field, context);
    allValues = extractFieldValues(relevantOccurrences, legacyFieldId);
  }

  // ── Sibling-linked question cycling ──
  // When a derived field uses `first` or `random` aggregation AND has
  // siblingLinks pointing to a select field with options, use those
  // options as the value pool instead of occurrence-extracted values.
  if (
    (aggregation === "first" || aggregation === "random") &&
    field.siblingLinks &&
    field.siblingLinks.length > 0
  ) {
    const fieldsById = {};
    (state.fields || []).forEach(f => { if (f?.id) fieldsById[f.id] = f; });

    // Find the first sibling that is a select field with options
    for (const siblingId of field.siblingLinks) {
      const sibling = fieldsById[siblingId];
      const siblingOptions = sibling?.meta?.options;
      if (sibling?.type === "select" && Array.isArray(siblingOptions) && siblingOptions.length > 0) {
        // Use the iteration date (or today) as the cycling key
        const iterDate = currentIterationValue
          ? new Date(currentIterationValue)
          : new Date();

        if (aggregation === "first") {
          // Deterministic cycle: index = dayOfYear % options.length
          const dayIdx = getDayOfYear(iterDate);
          const idx = dayIdx % siblingOptions.length;
          return siblingOptions[idx].label ?? siblingOptions[idx].value;
        }

        if (aggregation === "random") {
          // Seeded random: same day always gives the same question
          const seed = dateSeed(iterDate);
          const r = seededRandom(seed);
          const idx = Math.floor(r * siblingOptions.length);
          return siblingOptions[idx].label ?? siblingOptions[idx].value;
        }
      }
    }
  }

  // Apply aggregation
  return applyAggregation(allValues, aggregation, options);
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
 * Get aggregation symbol for display
 */
export function getAggregationSymbol(aggregation) {
  return AGGREGATIONS[aggregation]?.symbol || "=";
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

/**
 * Calculate a value from transactions instead of occurrences
 * Used when field.metric.source === "transactions"
 *
 * @param {Array} transactions - Array of Transaction objects from server
 * @param {Object} options - Configuration options
 * @param {string} options.aggregation - Aggregation function to apply
 * @param {string} options.flowFilter - "any" | "in" | "out"
 * @param {Array<string>} options.fieldIds - Field IDs to include
 * @param {string} options.timeFilter - Time filter to apply
 * @returns {any} Calculated value
 */
export function calculateFromTransactions(transactions, options = {}) {
  const {
    aggregation = "sum",
    flowFilter = "any",
    fieldIds = [],
    timeFilter = "all",
  } = options;

  // Filter transactions by time if needed
  let filteredTransactions = transactions;
  if (timeFilter && timeFilter !== "all" && TIME_FILTERS[timeFilter]) {
    const filter = TIME_FILTERS[timeFilter];
    filteredTransactions = transactions.filter(tx => {
      // Use transaction timestamp for filtering
      const mockOcc = { createdAt: tx.timestamp };
      return filter.fn(mockOcc);
    });
  }

  // Extract values from transaction operations
  const values = filteredTransactions
    .flatMap(tx => tx.operations || [])
    .filter(op => op.type === "measure")
    .filter(op => {
      // Filter by field IDs if specified
      if (fieldIds.length > 0 && !fieldIds.includes(op.measure.fieldId)) {
        return false;
      }
      // Filter by flow
      if (flowFilter !== "any" && op.measure.flow !== flowFilter) {
        return false;
      }
      return true;
    })
    .map(op => {
      const value = op.measure.value;
      const flow = op.measure.flow || "in";

      // Apply sign based on flow
      if (typeof value === "number") {
        return flow === "out" ? -value : value;
      }
      return value;
    })
    .filter(v => v !== null && v !== undefined);

  // Apply aggregation
  return applyAggregation(values, aggregation);
}

/**
 * Aggregate values from transaction history for a derived field
 * This is the transaction-based version of calculateDerivedField
 *
 * @param {Object} field - Field definition with metric config
 * @param {Array} transactions - Transactions from server
 * @param {Object} context - Additional context
 * @returns {any} Calculated value
 */
export function calculateDerivedFieldFromTransactions(field, transactions, context = {}) {
  if (!field || field.mode !== "derived" || !field.metric) {
    return null;
  }

  const { metric } = field;
  const {
    allowedFields = [],
    aggregation = "sum",
    timeFilter = "all",
  } = metric;

  // Build list of field IDs and their flow filters
  const fieldConfigs = allowedFields.map(af => ({
    fieldId: af.fieldId,
    flowFilter: af.flowFilter || "any",
  }));

  if (fieldConfigs.length === 0) {
    return null;
  }

  // For now, we aggregate all allowed fields together
  // Future: could support per-field aggregation then combine
  const fieldIds = fieldConfigs.map(fc => fc.fieldId);
  const flowFilter = fieldConfigs[0]?.flowFilter || "any"; // Use first field's flow filter

  return calculateFromTransactions(transactions, {
    aggregation,
    flowFilter,
    fieldIds,
    timeFilter,
  });
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
  calculateDerivedField,
  calculateFromTransactions,
  calculateDerivedFieldFromTransactions,
  getAggregationsForType,
  getAggregationSymbol,
  getAggregationLabel,
  calculateStreak,
  calculateRollingAverage,
  formatValue,
};
