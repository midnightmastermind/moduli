// state/selectors.js
// Selectors for working with occurrences and entities in the state
import { evalRule, evalGroup } from "../helpers/operationActions";
import { buildParentMap } from "../helpers/dragHitTesting";

/**
 * The single authoritative "who is this occurrence's parent" answer.
 *
 * Parent linkage is authoritative via `parent.occurrences[]` — `parentId` is
 * only reliably set on leaf instances in seeded data; containers and pages
 * track children via `occurrences[]` and frequently have NO `parentId`. Every
 * ancestor walk in the app (effective filters, ancestor scoping, NavigationOp
 * cascade) MUST resolve the parent through this helper so they all agree.
 *
 * Pass a prebuilt `parentByChildId` (from helpers/dragHitTesting.buildParentMap)
 * when walking many occurrences to avoid rebuilding the map per call.
 */
export function getParentOccurrence(occ, { occurrencesById, parentByChildId } = {}) {
  if (!occ || !occurrencesById) return null;
  const pbc = parentByChildId || buildParentMap(occurrencesById);
  const parentId = pbc[occ.id] ?? occ.parentId;
  return parentId ? (occurrencesById[parentId] || null) : null;
}

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
      const childMod = modulesById[childOcc.moduleId];
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
    const panel = modulesById[panelOcc.moduleId];
    if (panel) panelsById[panel.id] = panel;
    for (const childOccId of panelOcc.occurrences || []) {
      const childOcc = occurrencesById[childOccId];
      if (!childOcc) continue;
      const childMod = modulesById[childOcc.moduleId];
      if (!childMod) continue;

      if (childMod.role === "page") {
        // New hierarchy: panel → page → container → instance
        pagesById[childMod.id] = childMod;
        for (const containerOccId of childOcc.occurrences || []) {
          const containerOcc = occurrencesById[containerOccId];
          if (!containerOcc) continue;
          const container = modulesById[containerOcc.moduleId];
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
      if (!childOcc?.moduleId) continue;
      const childMod = modulesById?.[childOcc.moduleId];
      if (childMod?.role === "artifact") map[childOcc.moduleId] = "artifact";
      else if (childMod?.role === "textblock") map[childOcc.moduleId] = "textblock";
      else map[childOcc.moduleId] = "instance";
    }
  }

  const panelOccIds = grid?.occurrences || [];
  for (const panelOccId of panelOccIds) {
    const panelOcc = occurrencesById[panelOccId];
    if (!panelOcc) continue;
    if (panelOcc.moduleId) map[panelOcc.moduleId] = "panel";
    for (const childOccId of panelOcc.occurrences || []) {
      const childOcc = occurrencesById[childOccId];
      if (!childOcc) continue;
      const childMod = modulesById?.[childOcc.moduleId];

      if (childMod?.role === "page") {
        // New hierarchy: panel → page → container → instance
        map[childOcc.moduleId] = "page";
        for (const containerOccId of childOcc.occurrences || []) {
          const containerOcc = occurrencesById[containerOccId];
          if (!containerOcc) continue;
          if (containerOcc.moduleId) map[containerOcc.moduleId] = "container";
          traverseContainerChildren(containerOcc);
        }
      } else {
        // Legacy hierarchy: panel → container → instance
        if (childOcc.moduleId) map[childOcc.moduleId] = "container";
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

  // Look up the module in any role bucket
  const mod = occurrence.moduleId && (
    lookups.panelsById?.[occurrence.moduleId] ||
    lookups.pagesById?.[occurrence.moduleId] ||
    lookups.containersById?.[occurrence.moduleId] ||
    lookups.instancesById?.[occurrence.moduleId] ||
    lookups.artifactsById?.[occurrence.moduleId] ||
    lookups.textblocksById?.[occurrence.moduleId]
  );
  fillFromModule(mod);

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
    .filter(o => o.moduleId === moduleId && o.id !== excludeOccId)
    .map(o => {
      const parent = o.parentId ? occurrencesById[o.parentId] : null;
      const parentMod = parent?.moduleId ? modulesById?.[parent.moduleId] : null;
      return { occurrence: o, parentLabel: parentMod?.label || parent?.id || "root" };
    });
}

/**
 * Walks the parentId chain applying filterOverride at each level, returning the effective
 * filter values for this occurrence. Root falls back to grid.activeFilterValues.
 *   null/undefined override = inherit parent
 *   {}                      = clear all (show everything)
 *   { fieldId: value }      = merge/override specific fields
 *
 * Null-mute scoping rule (per-leaf):
 *   A `filterOverride[fieldId] = null` cascades to descendants ONLY when that
 *   ancestor also declares the same fieldId in its local `filters[]` (so the
 *   mute is acting on the ancestor's OWN filter — meaning "I declared this
 *   filter, and I'm turning it off for me + everyone below").
 *   When the ancestor doesn't own the filter (it's inherited from grid or a
 *   higher ancestor), the null only applies to that ancestor's own visibility
 *   — descendants continue inheriting the filter from above as if the
 *   intermediate mute didn't exist.
 *   The leaf (the occurrence we're computing for) always applies its own
 *   nulls — that's the user "muting this filter on this occurrence".
 */
function _ownsLocalFilter(occ, fieldId) {
  if (!occ || !Array.isArray(occ.filters)) return false;
  return occ.filters.some(f => f?.fieldId === fieldId);
}

// One override application — shared by the iterative walker below and the
// memoized resolver. Returns the PARENT object untouched when the occurrence
// has no override (callers treat results as read-only).
function _applyFilterOverride(parentEffective, occ, isLeaf) {
  const override = occ.filterOverride;
  if (override == null) return parentEffective;
  if (Object.keys(override).length === 0) return {};
  const out = { ...parentEffective };
  for (const [k, v] of Object.entries(override)) {
    if (v === null) {
      if (isLeaf || _ownsLocalFilter(occ, k)) delete out[k];
      // else: ancestor muting an inherited filter — local-only.
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Batch variant: returns an `eff(occ)` resolver that memoizes each ancestor's
 * "context" filter (the occurrence treated as a NON-leaf) so resolving the
 * effective filter for N occurrences costs O(N) instead of O(N × depth).
 * Same semantics as getEffectiveFilterForOccurrence — the leaf application
 * (own nulls always mute) happens fresh per call on top of the memoized
 * parent context. Used by the operation executor's per-item enrichment.
 */
export function makeEffectiveFilterResolver({ grid, occurrencesById, parentByChildId } = {}) {
  const pbc = parentByChildId || buildParentMap(occurrencesById || {});
  const base = grid?.activeFilterValues || {};
  const ctxCache = new Map(); // occId → effective filter treating occ as non-leaf
  const ctxEff = (occ, guard) => {
    if (!occ) return base;
    const hit = ctxCache.get(occ.id);
    if (hit !== undefined) return hit;
    if (guard.has(occ.id)) return base; // cycle — mirror the walker's guard stop
    guard.add(occ.id);
    const pid = pbc[occ.id] ?? occ.parentId;
    const parent = pid ? (occurrencesById?.[pid] || null) : null;
    const eff = _applyFilterOverride(ctxEff(parent, guard), occ, false);
    ctxCache.set(occ.id, eff);
    return eff;
  };
  return (occ) => {
    if (!occ) return { ...base };
    const pid = pbc[occ.id] ?? occ.parentId;
    const parent = pid ? (occurrencesById?.[pid] || null) : null;
    return _applyFilterOverride(ctxEff(parent, new Set([occ.id])), occ, true);
  };
}

export function getEffectiveFilterForOccurrence(occ, { grid, occurrencesById, parentByChildId } = {}) {
  if (!occ) return grid?.activeFilterValues || {};
  // Parent linkage is authoritative via parent.occurrences[] (see
  // getParentOccurrence). Use the one shared reverse-map builder; callers
  // walking many occurrences pass a prebuilt map to avoid O(N²).
  const pbc = parentByChildId || buildParentMap(occurrencesById || {});
  const chain = [];
  let cur = occ;
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    chain.push(cur);
    const nextId = pbc[cur.id] ?? cur.parentId;
    cur = nextId ? (occurrencesById?.[nextId] || null) : null;
  }
  let effective = { ...(grid?.activeFilterValues || {}) };
  // Walk root → leaf so leaf wins. chain[0] is the leaf (occ itself).
  for (let i = chain.length - 1; i >= 0; i--) {
    const cur = chain[i];
    const isLeaf = i === 0;
    const override = cur.filterOverride;
    if (override == null) continue;
    if (Object.keys(override).length === 0) { effective = {}; continue; }
    for (const [k, v] of Object.entries(override)) {
      if (v === null) {
        // Null = mute. Cascades only when the muting occurrence owns the
        // local filter for that fieldId, OR when it's the leaf's own mute.
        if (isLeaf || _ownsLocalFilter(cur, k)) {
          delete effective[k];
        }
        // else: ancestor muting an inherited filter — local-only, descendants
        // ignore it.
      } else {
        effective[k] = v;
      }
    }
  }
  return effective;
}

// Resolve the effective field-visibility for an occurrence by walking its
// ancestor chain (same authoritative parent linkage as
// getEffectiveFilterForOccurrence — occurrences[] reverse map, parentId
// fallback). Field-visibility cascades top→down: a descendant inherits the
// nearest ancestor's setting unless it sets its own or explicitly turns it
// off.
//
// occurrence.fieldVisibility shapes:
//   - null / undefined        → no own setting; inherit from ancestors
//   - { mode: "off" }         → explicitly clear inherited visibility here
//                                (and for descendants, until one re-overrides)
//   - { mode: "show", fieldIds } → only those field IDs render (whitelist)
//   - { mode: "hide", fieldIds } → those field IDs are skipped (blacklist)
//
// Walk leaf→root; the FIRST occurrence with a non-null fieldVisibility wins
// (it is by construction the nearest setting in the chain). When that nearest
// setting is mode:"off" the function returns null — "show all fields here".
// Returns { mode: "show"|"hide", fieldIds: string[] } or null.
export function getEffectiveFieldVisibilityForOccurrence(occ, { occurrencesById, parentByChildId } = {}) {
  if (!occ) return null;
  const pbc = parentByChildId || buildParentMap(occurrencesById || {});
  let cur = occ;
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    const fv = cur.fieldVisibility;
    if (fv != null) {
      if (fv.mode === "off") return null;
      if (fv.mode === "show" || fv.mode === "hide") {
        return { mode: fv.mode, fieldIds: Array.isArray(fv.fieldIds) ? fv.fieldIds : [] };
      }
      // Unknown/empty mode — treat as no constraint, keep walking up.
    }
    const nextId = pbc[cur.id] ?? cur.parentId;
    cur = nextId ? (occurrencesById?.[nextId] || null) : null;
  }
  return null;
}

// Pure predicate: does fieldId pass the given resolved field-visibility?
// `fv` is the output of getEffectiveFieldVisibilityForOccurrence (or a table
// column's local fieldVisibility). null = no constraint, everything passes.
export function fieldPassesVisibility(fieldId, fv) {
  if (!fv || !fv.mode || fv.mode === "off") return true;
  const inList = Array.isArray(fv.fieldIds) && fv.fieldIds.includes(fieldId);
  if (fv.mode === "show") return inList;
  if (fv.mode === "hide") return !inList;
  return true;
}

// Returns synthesized IS-comparator conditions for an occurrence's local
// `filters[]` entries that opt into cascade-driven matching (active && fieldId
// && condition == null). The Time Slot select on the schedule page is the
// canonical example — its `condition: null` means "match strictly against
// whatever filterOverride writes for this fieldId". Entries with an explicit
// condition (e.g. the legacy schedFilterId OR-block) are NOT synthesized here;
// they're either evaluated through their own rule tree elsewhere or are dead
// code that the active grid filter already covers.
export function getLocalFilterConditions(occ) {
  const out = [];
  for (const f of (occ?.filters || [])) {
    if (!f?.active || !f.fieldId) continue;
    if (f.condition != null) continue;
    out.push({ fieldId: f.fieldId, comparator: f.comparator || "IS" });
  }
  return out;
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
      // No filter target resolved — treat as "no filter set" and skip rather than
      // fail. This is what makes the Time Slot dropdown's "— any —" reset restore
      // all slots: clearing writes filterOverride[fieldId] = null, the cascade
      // deletes the key, rightVal lands as undefined, and we should pass.
      if (rightVal == null) continue;
      // Period-shape `{value, unit, span?}` filter values broaden the match
      // window — route through DATE_IN_PERIOD regardless of the condition's
      // static comparator (e.g. SAME_DAY). Covers:
      //   - unit !== "day"  (week/month/year periods)
      //   - span  >  1      (consecutive multi-day picks, kind:"range")
      //   - kind === "multi" + dates[]  (non-consecutive multi-day picks)
      // Without span detection, kind:"range" (unit:"day", span:N) fell back
      // to SAME_DAY which can't compare a string to an object → every
      // schedule day-col was invisible on a multi-day filter.
      const hasPeriod = rightVal && typeof rightVal === "object" &&
        ((rightVal.unit && rightVal.unit !== "day") ||
         (Number(rightVal.span) > 1) ||
         (rightVal.kind === "multi" && Array.isArray(rightVal.dates)));
      const comparator = hasPeriod ? "DATE_IN_PERIOD" : String(cond.comparator || "IS").toUpperCase();
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
    // Period-shape `{value, unit}` filter values broaden the match window —
    // route through DATE_IN_PERIOD which handles week/month/year correctly.
    // Multi-shape `{kind:"multi", dates:[...]}` also routes through
    // DATE_IN_PERIOD for the OR-match across selected dates.
    if (required && typeof required === "object" &&
        (required.unit || (required.kind === "multi" && Array.isArray(required.dates)))) {
      if (!evalRule({ left: val, comparator: "DATE_IN_PERIOD", right: required }, {})) return false;
      continue;
    }
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
