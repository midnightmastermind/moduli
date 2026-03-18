// utils/occurrenceHelpers.js

/**
 * Autofills an occurrence with its target entity data
 * @param {Object} occurrence - The occurrence to autofill
 * @param {Object} uc - User cache containing all entities
 * @returns {Object} Occurrence with target entity autofilled
 */
export function autofillOccurrence(occurrence, uc) {
  if (!occurrence || !uc) return occurrence;

  const filled = { ...occurrence };

  // Module-based lookup (new unified model)
  if (occurrence.targetType === "module" || occurrence.targetType === "panel" || occurrence.targetType === "container" || occurrence.targetType === "instance") {
    const mod = occurrence.targetId && uc.modulesById?.[occurrence.targetId];
    if (mod) {
      filled.module = mod;
      // Backward-compat aliases
      if (mod.role === "panel") filled.panel = mod;
      else if (mod.role === "container") filled.container = mod;
      else if (mod.role === "instance") filled.instance = mod;
    }
  }

  return filled;
}

/**
 * Autofills multiple occurrences
 * @param {Array} occurrences - Array of occurrences to autofill
 * @param {Object} uc - User cache containing all entities
 * @returns {Array} Array of autofilled occurrences
 */
export function autofillOccurrences(occurrences, uc) {
  if (!Array.isArray(occurrences)) return [];
  return occurrences.map((occ) => autofillOccurrence(occ, uc));
}

/**
 * Gets occurrences for a specific grid (raw, no autofill)
 * @param {string} gridId - The grid ID
 * @param {Object} uc - User cache
 * @returns {Array} Array of raw occurrences for the grid
 */
export function getOccurrencesForGrid(gridId, uc) {
  return Object.values(uc.occurrencesById || {}).filter(
    (occ) => occ.gridId === gridId
  );
}

/**
 * Autofills grid with populated occurrences
 * @param {Object} grid - Grid object
 * @param {Object} uc - User cache
 * @returns {Object} Grid with occurrences array populated and autofilled
 */
export function autofillGrid(grid, uc) {
  if (!grid || !uc) return grid;

  const occurrences = (grid.occurrences || [])
    .map(occId => uc.occurrencesById[occId])
    .filter(Boolean)
    .map(occ => autofillOccurrence(occ, uc));

  return { ...grid, occurrences };
}

/**
 * Autofills panel with populated occurrences
 * @param {Object} panel - Panel object
 * @param {Object} uc - User cache
 * @returns {Object} Panel with occurrences array populated and autofilled
 */
export function autofillPanel(panel, uc) {
  if (!panel || !uc) return panel;

  const occurrences = (panel.occurrences || [])
    .map(occId => uc.occurrencesById[occId])
    .filter(Boolean)
    .map(occ => autofillOccurrence(occ, uc));

  return { ...panel, occurrences };
}

/**
 * Autofills container with populated occurrences
 * @param {Object} container - Container object
 * @param {Object} uc - User cache
 * @returns {Object} Container with occurrences array populated and autofilled
 */
export function autofillContainer(container, uc) {
  if (!container || !uc) return container;

  const occurrences = (container.occurrences || [])
    .map(occId => uc.occurrencesById[occId])
    .filter(Boolean)
    .map(occ => autofillOccurrence(occ, uc));

  return { ...container, occurrences };
}

/**
 * Creates an occurrence wrapper for an entity
 * @param {Object} params - Parameters
 * @param {string} params.id - Occurrence ID
 * @param {string} params.userId - User ID
 * @param {string} params.targetType - "panel" | "container" | "instance"
 * @param {string} params.targetId - The entity ID
 * @param {string} params.gridId - Grid ID
 * @param {Object} params.placement - Optional placement (for panels)
 * @param {Object} params.fields - Optional field values
 * @param {Object} params.meta - Optional metadata
 * @param {Object|null} params.filterOverride - Optional filter override (null = inherit)
 * @returns {Object} Occurrence object
 */
export function createOccurrenceData(params) {
  const {
    id,
    userId,
    targetType,
    targetId,
    gridId,
    placement,
    fields = {},
    meta = {},
    linkedGroupId = null,
    filterOverride = null,
  } = params;

  return {
    id,
    userId,
    targetType,
    targetId,
    gridId,
    timestamp: new Date(),
    ...(placement && { placement }),
    fields,
    meta,
    filterOverride,
    hidden: false,
    ...(linkedGroupId && { linkedGroupId }),
  };
}
