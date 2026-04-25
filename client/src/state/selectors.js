// state/selectors.js
// Selectors for working with occurrences and entities in the state
import * as CalcHelpers from "../helpers/CalculationHelpers";
import { evalRule, evalGroup } from "../helpers/operationActions";

/**
 * Creates lookup maps from state arrays.
 * Role buckets (panelsById/containersById/instancesById) are populated by hierarchy inference,
 * with module.role as fallback for unplaced modules.
 */
export function createLookupsFromState(state) {
  const panelsById = {};
  const containersById = {};
  const instancesById = {};
  const artifactsById = {};
  const textblocksById = {};
  const pagesById = {};
  const occurrencesById = {};
  const fieldsById = {};
  const modulesById = {};

  (state.occurrences || []).forEach(o => { if (o.id) occurrencesById[o.id] = o; });
  (state.fields || []).forEach(f => { if (f.id) fieldsById[f.id] = f; });

  // Build modulesById from all modules
  (state.modules || []).forEach(m => { if (m.id) modulesById[m.id] = m; });

  // Helper: traverse container → leaf-placeable children (instance | artifact | textblock)
  function traverseContainerChildren(containerOcc) {
    for (const childOccId of containerOcc.occurrences || []) {
      const childOcc = occurrencesById[childOccId];
      if (!childOcc) continue;
      const childMod = modulesById[childOcc.targetId];
      if (!childMod) continue;
      if (childMod.role === "artifact") artifactsById[childMod.id] = childMod;
      else if (childMod.role === "textblock") textblocksById[childMod.id] = childMod;
      else instancesById[childMod.id] = childMod;
    }
  }

  // Populate role buckets from occurrence hierarchy (canonical)
  // Supports both legacy (panel → container → instance) and new (panel → page → container → instance)
  const panelOccIds = state.grid?.occurrences || [];
  for (const panelOccId of panelOccIds) {
    const panelOcc = occurrencesById[panelOccId];
    if (!panelOcc) continue;
    const panel = modulesById[panelOcc.targetId];
    if (panel) panelsById[panel.id] = panel;
    for (const childOccId of panelOcc.occurrences || []) {
      const childOcc = occurrencesById[childOccId];
      if (!childOcc) continue;
      const childMod = modulesById[childOcc.targetId];
      if (!childMod) continue;

      if (childMod.role === "page") {
        // New hierarchy: panel → page → container → instance
        pagesById[childMod.id] = childMod;
        for (const containerOccId of childOcc.occurrences || []) {
          const containerOcc = occurrencesById[containerOccId];
          if (!containerOcc) continue;
          const container = modulesById[containerOcc.targetId];
          if (container) containersById[container.id] = container;
          traverseContainerChildren(containerOcc);
        }
      } else {
        // Legacy hierarchy: panel → container → instance
        containersById[childMod.id] = childMod;
        traverseContainerChildren(childOcc);
      }
    }
  }

  // Fallback: use module.role for unplaced modules (templates, new items not yet in hierarchy)
  (state.modules || []).forEach(m => {
    if (!m.id || m.trashed) return;
    if (m.role === "panel" && !panelsById[m.id]) panelsById[m.id] = m;
    else if (m.role === "page" && !pagesById[m.id]) pagesById[m.id] = m;
    else if (m.role === "container" && !containersById[m.id]) containersById[m.id] = m;
    else if (m.role === "instance" && !instancesById[m.id]) instancesById[m.id] = m;
    else if (m.role === "artifact" && !artifactsById[m.id]) artifactsById[m.id] = m;
    else if (m.role === "textblock" && !textblocksById[m.id]) textblocksById[m.id] = m;
  });

  // Legacy role arrays (backward compat)
  (state.panels || []).forEach(p => { if (p.id && !panelsById[p.id]) panelsById[p.id] = p; });
  (state.containers || []).forEach(c => { if (c.id && !containersById[c.id]) containersById[c.id] = c; });
  (state.instances || []).forEach(i => { if (i.id && !instancesById[i.id]) instancesById[i.id] = i; });
  (state.artifacts || []).forEach(a => { if (a.id && !artifactsById[a.id]) artifactsById[a.id] = a; });
  (state.textblocks || []).forEach(t => { if (t.id && !textblocksById[t.id]) textblocksById[t.id] = t; });

  return {
    panelsById,
    containersById,
    instancesById,
    artifactsById,
    textblocksById,
    pagesById,
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

  function traverseContainerChildren(containerOcc) {
    for (const childOccId of containerOcc.occurrences || []) {
      const childOcc = occurrencesById[childOccId];
      if (!childOcc?.targetId) continue;
      const childMod = modulesById?.[childOcc.targetId];
      if (childMod?.role === "artifact") map[childOcc.targetId] = "artifact";
      else if (childMod?.role === "textblock") map[childOcc.targetId] = "textblock";
      else map[childOcc.targetId] = "instance";
    }
  }

  const panelOccIds = grid?.occurrences || [];
  for (const panelOccId of panelOccIds) {
    const panelOcc = occurrencesById[panelOccId];
    if (!panelOcc) continue;
    if (panelOcc.targetId) map[panelOcc.targetId] = "panel";
    for (const childOccId of panelOcc.occurrences || []) {
      const childOcc = occurrencesById[childOccId];
      if (!childOcc) continue;
      const childMod = modulesById?.[childOcc.targetId];

      if (childMod?.role === "page") {
        // New hierarchy: panel → page → container → instance
        map[childOcc.targetId] = "page";
        for (const containerOccId of childOcc.occurrences || []) {
          const containerOcc = occurrencesById[containerOccId];
          if (!containerOcc) continue;
          if (containerOcc.targetId) map[containerOcc.targetId] = "container";
          traverseContainerChildren(containerOcc);
        }
      } else {
        // Legacy hierarchy: panel → container → instance
        if (childOcc.targetId) map[childOcc.targetId] = "container";
        traverseContainerChildren(childOcc);
      }
    }
  }
  // Fallback: use module.role for unplaced modules (e.g. templates, unplaced CC items)
  if (modulesById) {
    for (const [id, mod] of Object.entries(modulesById)) {
      if (!map[id] && mod.role && !mod.trashed) map[id] = mod.role;
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
    else if (lookups.pagesById?.[mod.id] || mod.role === "page") filled.page = mod;
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
 *
 * If the active named filter is locked, downstream overrides are ignored entirely —
 * parent values cascade unchanged.
 */
export function resolveEffectiveFilters(occurrence, parentFilterValues, activeFilterLocked = false) {
  if (!occurrence) return parentFilterValues || {};
  if (activeFilterLocked) return parentFilterValues || {};
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

/**
 * Find all other occurrences of the same module (excluding the current one).
 * Returns [{ occurrence, parentLabel }] for display in settings forms.
 */
export function getOtherOccurrences(occurrencesById, modulesById, moduleId, excludeOccId) {
  if (!occurrencesById || !moduleId) return [];
  return Object.values(occurrencesById)
    .filter(o => o.targetId === moduleId && o.id !== excludeOccId)
    .map(o => {
      const parent = o.parentId ? occurrencesById[o.parentId] : null;
      const parentMod = parent?.targetId ? modulesById?.[parent.targetId] : null;
      return { occurrence: o, parentLabel: parentMod?.label || parent?.id || "root" };
    });
}

/**
 * Walks the parentId chain applying filterOverride at each level, returning the effective
 * filter values for this occurrence. Root falls back to grid.activeFilterValues.
 *   null/undefined override = inherit parent
 *   {}                      = clear all (show everything)
 *   { fieldId: value }      = merge/override specific fields
 */
export function getEffectiveFilterForOccurrence(occ, { grid, occurrencesById }) {
  if (!occ) return grid?.activeFilterValues || {};
  const chain = [];
  let cur = occ;
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    chain.push(cur);
    cur = cur.parentId ? (occurrencesById?.[cur.parentId] || null) : null;
  }
  let effective = { ...(grid?.activeFilterValues || {}) };
  for (let i = chain.length - 1; i >= 0; i--) {
    const override = chain[i].filterOverride;
    if (override == null) continue;
    if (Object.keys(override).length === 0) { effective = {}; continue; }
    effective = { ...effective, ...override };
  }
  return effective;
}

export function isOccurrenceVisible(occurrence, effectiveFilters, filterConditions = null) {
  if (!occurrence) return false;
  if (occurrence.hidden) return false;

  // Condition-based path: when the active filter has explicit conditions, evaluate each one.
  // A condition can either reference a literal `value` or fall back to the live filter value
  // (effectiveFilters[fieldId]) — that's what the nav arrows mutate.
  if (Array.isArray(filterConditions) && filterConditions.length) {
    for (const cond of filterConditions) {
      if (!cond) continue;
      // Nested groups: AND/OR of sub-rules. Build a $vars carrying the occurrence's field map
      // so left-paths like `$occ.fields.<fid>.value` can resolve.
      if (Array.isArray(cond.rules)) {
        const $vars = { $occ: occurrence, $occurrence: occurrence };
        if (!evalGroup(cond, $vars)) return false;
        continue;
      }
      const fieldId = cond.fieldId;
      if (!fieldId) continue;
      const fieldVal = occurrence.fields?.[fieldId];
      const leftVal = fieldVal?.value !== undefined ? fieldVal.value : fieldVal;
      // Persistent semantics: occurrence with no value for this field passes (e.g. recurring habits).
      if (leftVal == null) continue;
      const rightVal = cond.value !== undefined && cond.value !== null && cond.value !== ""
        ? cond.value
        : effectiveFilters?.[fieldId];
      const comparator = String(cond.comparator || "IS").toUpperCase();
      const ok = evalRule({ left: leftVal, comparator, right: rightVal }, {});
      if (!ok) return false;
    }
    return true;
  }

  // Legacy path: no conditions provided — fall back to direct field/value equality.
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
