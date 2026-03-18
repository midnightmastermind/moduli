// state/selectors.js
// Selectors for working with occurrences and entities in the state
import * as CalcHelpers from "../helpers/CalculationHelpers";

/**
 * Creates lookup maps from state arrays.
 * Role buckets (panelsById/containersById/instancesById) are populated by hierarchy inference,
 * with module.role as fallback for unplaced modules.
 */
export function createLookupsFromState(state) {
  const panelsById = {};
  const containersById = {};
  const instancesById = {};
  const occurrencesById = {};
  const fieldsById = {};
  const modulesById = {};

  (state.occurrences || []).forEach(o => { if (o.id) occurrencesById[o.id] = o; });
  (state.fields || []).forEach(f => { if (f.id) fieldsById[f.id] = f; });

  // Build modulesById from all modules
  (state.modules || []).forEach(m => { if (m.id) modulesById[m.id] = m; });

  // Populate role buckets from occurrence hierarchy (canonical)
  const panelOccIds = state.grid?.occurrences || [];
  for (const panelOccId of panelOccIds) {
    const panelOcc = occurrencesById[panelOccId];
    if (!panelOcc) continue;
    const panel = modulesById[panelOcc.targetId];
    if (panel) panelsById[panel.id] = panel;
    for (const containerOccId of panelOcc.occurrences || []) {
      const containerOcc = occurrencesById[containerOccId];
      if (!containerOcc) continue;
      const container = modulesById[containerOcc.targetId];
      if (container) containersById[container.id] = container;
      for (const instanceOccId of containerOcc.occurrences || []) {
        const instanceOcc = occurrencesById[instanceOccId];
        if (!instanceOcc) continue;
        const instance = modulesById[instanceOcc.targetId];
        if (instance) instancesById[instance.id] = instance;
      }
    }
  }

  // Fallback: use module.role for unplaced modules (templates, new items not yet in hierarchy)
  (state.modules || []).forEach(m => {
    if (!m.id) return;
    if (m.role === "panel" && !panelsById[m.id]) panelsById[m.id] = m;
    else if (m.role === "container" && !containersById[m.id]) containersById[m.id] = m;
    else if (m.role === "instance" && !instancesById[m.id]) instancesById[m.id] = m;
  });

  // Legacy role arrays (backward compat)
  (state.panels || []).forEach(p => { if (p.id && !panelsById[p.id]) panelsById[p.id] = p; });
  (state.containers || []).forEach(c => { if (c.id && !containersById[c.id]) containersById[c.id] = c; });
  (state.instances || []).forEach(i => { if (i.id && !instancesById[i.id]) instancesById[i.id] = i; });

  return {
    panelsById,
    containersById,
    instancesById,
    occurrencesById,
    fieldsById,
  };
}

/**
 * Computes a { [moduleId]: "panel"|"container"|"instance" } map from occurrence hierarchy.
 * This is the canonical role source — replaces module.role.
 * Falls back to module.role for modules not yet placed in the hierarchy.
 */
export function computeRoleByModuleId(grid, occurrencesById, modulesById) {
  const map = {};
  const panelOccIds = grid?.occurrences || [];
  for (const panelOccId of panelOccIds) {
    const panelOcc = occurrencesById[panelOccId];
    if (!panelOcc) continue;
    if (panelOcc.targetId) map[panelOcc.targetId] = "panel";
    for (const containerOccId of panelOcc.occurrences || []) {
      const containerOcc = occurrencesById[containerOccId];
      if (!containerOcc) continue;
      if (containerOcc.targetId) map[containerOcc.targetId] = "container";
      for (const instanceOccId of containerOcc.occurrences || []) {
        const instanceOcc = occurrencesById[instanceOccId];
        if (!instanceOcc) continue;
        if (instanceOcc.targetId) map[instanceOcc.targetId] = "instance";
      }
    }
  }
  // Fallback: use module.role for unplaced modules (e.g. templates, unplaced CC items)
  if (modulesById) {
    for (const [id, mod] of Object.entries(modulesById)) {
      if (!map[id] && mod.role) map[id] = mod.role;
    }
  }
  return map;
}

/**
 * Autofills an occurrence with its target entity
 */
export function autofillOccurrence(occurrence, lookups) {
  if (!occurrence) return occurrence;

  const filled = { ...occurrence };

  const fillFromModule = (mod) => {
    if (!mod) return;
    filled.module = mod;
    // Use lookups (hierarchy-based) as canonical role source; module.role as fallback
    if (lookups.panelsById?.[mod.id] || mod.role === "panel") filled.panel = mod;
    else if (lookups.containersById?.[mod.id] || mod.role === "container") filled.container = mod;
    else if (lookups.instancesById?.[mod.id] || mod.role === "instance") filled.instance = mod;
  };

  switch (occurrence.targetType) {
    case "module": {
      // Unified module — look up in any role bucket
      const mod = occurrence.targetId && (
        lookups.panelsById[occurrence.targetId] ||
        lookups.containersById[occurrence.targetId] ||
        lookups.instancesById[occurrence.targetId]
      );
      fillFromModule(mod);
      break;
    }

    case "panel":
      if (occurrence.targetId && lookups.panelsById[occurrence.targetId]) {
        filled.panel = lookups.panelsById[occurrence.targetId];
        filled.module = lookups.panelsById[occurrence.targetId];
      }
      break;

    case "container":
      if (occurrence.targetId && lookups.containersById[occurrence.targetId]) {
        filled.container = lookups.containersById[occurrence.targetId];
        filled.module = lookups.containersById[occurrence.targetId];
      }
      break;

    case "instance":
      if (occurrence.targetId && lookups.instancesById[occurrence.targetId]) {
        filled.instance = lookups.instancesById[occurrence.targetId];
        filled.module = lookups.instancesById[occurrence.targetId];
      }
      break;
  }

  return filled;
}

/**
 * Gets the grid's panel occurrences, autofilled
 */
export function getGridPanels(state) {
  if (!state.grid) return [];

  const lookups = createLookupsFromState(state);

  return (state.grid.occurrences || [])
    .map(occId => lookups.occurrencesById[occId])
    .filter(Boolean)
    .map(occ => autofillOccurrence(occ, lookups));
}


/**
 * Calculates a derived field value
 * Delegates to CalculationHelpers for the actual computation
 */
export function calculateDerivedField(state, field, context = {}) {
  return CalcHelpers.calculateDerivedField(state, field, context);
}

// ============================================================
// FILTER SYSTEM (Phase 0)
// ============================================================

/**
 * Compute effective filter values for an occurrence, applying parent override chain.
 * parentFilterValues = the effective filters from the parent (grid or panel/container).
 * occurrence.filterOverride:
 *   null/undefined = inherit parent's filters (default)
 *   {}             = clear all filters (show everything)
 *   { fieldId: v } = merge: parent filters + these overrides
 */
export function resolveEffectiveFilters(occurrence, parentFilterValues) {
  if (!occurrence) return parentFilterValues || {};
  const override = occurrence.filterOverride;
  if (override == null) return parentFilterValues || {};
  // Merge parent + override (override wins, null values remove that filter key)
  const merged = { ...(parentFilterValues || {}), ...override };
  for (const [k, v] of Object.entries(merged)) {
    if (v === null) delete merged[k];
  }
  return merged;
}

/**
 * Determine if an instance occurrence is visible given the effective filter values.
 * Visibility rule:
 *   - occurrence.hidden = true → always hidden
 *   - For each [fieldId, required] in effectiveFilters:
 *       If occurrence has NO value for fieldId → PASS (persistent/universal item)
 *       If occurrence value matches required → PASS
 *       If occurrence value does NOT match → HIDDEN
 *   - All filters must pass (AND logic)
 *
 * @param {Object} occurrence - The instance occurrence
 * @param {Object} effectiveFilters - { [fieldId]: value | value[] }
 * @returns {boolean}
 */
function isSameDayStr(a, b) {
  try {
    const da = new Date(a); const db = new Date(b);
    return da.getFullYear() === db.getFullYear() &&
           da.getMonth() === db.getMonth() &&
           da.getDate() === db.getDate();
  } catch { return false; }
}

export function isOccurrenceVisible(occurrence, effectiveFilters) {
  if (!occurrence) return false;
  if (occurrence.hidden) return false;
  if (!effectiveFilters || !Object.keys(effectiveFilters).length) return true;

  for (const [fieldId, required] of Object.entries(effectiveFilters)) {
    if (required === null || required === undefined) continue;
    const fieldVal = occurrence.fields?.[fieldId];
    // No value for this field → treat as persistent (always pass)
    if (fieldVal == null) continue;
    const val = fieldVal?.value !== undefined ? fieldVal.value : fieldVal;
    if (val == null) continue;
    // Array requirement → value must be included
    if (Array.isArray(required)) {
      if (!required.includes(val)) return false;
    } else if (typeof val === "string" && typeof required === "string") {
      // Try date comparison first (same calendar day)
      const da = new Date(val); const db = new Date(required);
      if (!isNaN(da) && !isNaN(db)) {
        if (!isSameDayStr(val, required)) return false;
      } else {
        if (val !== required) return false;
      }
    } else {
      if (val !== required) return false;
    }
  }
  return true;
}
