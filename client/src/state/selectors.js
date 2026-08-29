// state/selectors.js
// Selectors for working with occurrences and entities in the state
import { evalRule, evalGroup, evalGroupAgainstRecord } from "../helpers/operationActions";
import { buildParentMap, cachedParentMap, cachedAncestorsOf } from "../helpers/dragHitTesting";
import { buildFeedPredicate } from "../helpers/feedPredicate";

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
// computeRoleByModuleId — DELETED 2026-07-29.
// It inferred a module's role from where its occurrences sit in the tree, as a
// second source of truth beside the stored `module.role`. Measured against the
// live grid it DISAGREED on 57 of 1002 modules: it has no notion of a container
// inside a container (which this app supports), so every Schedule slot container
// came back "instance". Only three Command Center tabs read it, and they were
// the only places showing those 48 slots with the wrong role. Every module in
// every grid carries a role, so the inference had no fallback purpose either.
// `module.role` is the source of truth.

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
  // The fallback is MEMOISED per occurrence-map identity (cachedParentMap):
  // this is a per-component useMemo in ModuleContainer/HeaderChevron, so a
  // render pass rebuilt the same full-grid index once per container (144ms
  // of the 2026-08-07 date-navigation profile). The executor passes an
  // explicit map and never reaches this line.
  const pbc = parentByChildId || cachedParentMap(occurrencesById || {});
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
export function getEffectiveFieldVisibilityForOccurrence(occ, { occurrencesById, parentByChildId, grid } = {}) {
  // THE GRID IS THE ROOT OF THIS CASCADE TOO, and it had none until 2026-08-11.
  // User: *"hide tags everywhere, and hide date everywhere thats not tasks,
  // schedule, trackers"* — a default with three exceptions, which is exactly a
  // cascade rooted somewhere. Without a root, "everywhere" would have to be
  // written onto all 71 pages and re-written for every page created afterwards.
  //
  // Same shape as `getEffectiveAutoAppliedFieldIds`: the grid states the
  // default, any occurrence overrides it for itself and everything under it.
  const gridDefault = (() => {
    const fv = grid?.meta?.fieldVisibility;
    if (!fv || fv.mode === "off") return null;
    if (fv.mode === "show" || fv.mode === "hide") {
      return { mode: fv.mode, fieldIds: Array.isArray(fv.fieldIds) ? fv.fieldIds : [] };
    }
    return null;
  })();
  if (!occ) return gridDefault;
  // Memoised fallback — ModuleInstance calls this per row inside its own
  // useMemo, so an unmemoised build is one full-grid scan per instance
  // (142ms of the 2026-08-07 date-navigation profile). See cachedParentMap.
  const pbc = parentByChildId || cachedParentMap(occurrencesById || {});
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
  // Nothing in the chain said anything — fall back to the grid's default.
  return gridDefault;
}

// WHEN an occurrence's own fields are shown — a SEPARATE cascade from WHICH.
//
//   occurrence.fieldReveal:
//     null / undefined   → inherit from ancestors
//     "always"           → shown at rest (the default, and an explicit stop:
//                          it re-enables here even if an ancestor said hover)
//     "hover"            → present but transparent until the card is hovered
//
// DELIBERATELY NOT A KEY ON `fieldVisibility`, for two reasons. The mechanical
// one: the resolver above returns `{mode, fieldIds}` and DROPS every other key,
// so a `reveal` smuggled in there would silently vanish. The design one: they
// answer different questions, so folding them together means setting WHICH
// fields show on a container would wipe WHEN they show, inherited from its page.
//
// Nearest-wins, same walk and the same memoised parent map.
export function getEffectiveFieldRevealForOccurrence(occ, { occurrencesById, parentByChildId } = {}) {
  if (!occ) return "always";
  const pbc = parentByChildId || cachedParentMap(occurrencesById || {});
  let cur = occ;
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    const r = cur.fieldReveal;
    if (r === "hover" || r === "always") return r;
    const nextId = pbc[cur.id] ?? cur.parentId;
    cur = nextId ? (occurrencesById?.[nextId] || null) : null;
  }
  return "always";
}

// ── AUTO-APPLIED FIELDS: the other half of the field cascade ────────────────
//
// USER, 2026-08-10: *"its a cascade of shown fields and auto applied fields."*
// Two questions, two cascades, sitting beside each other:
//
//   SHOWN fields        `fieldVisibility`        — of the fields this occurrence
//                                                  has, which ones render
//   AUTO-APPLIED fields `autoAppliedFieldIds`    — which fields it HAS without
//                                                  its module declaring them
//
// AND IT IS NOT A HARD-CODED CATEGORY. User, correcting the first name twice:
// *"universal fields arent anything hard coded, its just what the app sets at a
// grid level and passed down."* So nothing here knows which field is Tags, or
// that Date is special; a level names ids, and the levels below inherit them.
//
// A LIST, NOT AN ON/OFF FLAG — which is what makes *"turned off on occurances if
// i want"* fall out for free rather than needing a second switch: an occurrence
// overrides the list, and `[]` is how it carries none. Any level may also ADD
// its own (a page that wants a field on everything under it), because a cascade
// that only the grid can set is not a cascade.
//
// WHY THIS REPLACES THE FIRST DESIGN. Auto-applied fields used to be born hidden
// and revealed by naming them in a `show`-mode `fieldVisibility`. But show-mode
// is a WHITELIST — naming Tags there says "show Tags AND NOTHING ELSE". Migration
// 0064 did exactly that on the Trackers page and hid every tracker's own bound
// fields; the user saw the result: *"currently none of the trackers are showing
// their fields either… just the tags field."* Reusing the shown cascade as the
// applied cascade is precisely the confusion this split removes — the same
// reasoning that gave `fieldReveal` its own cascade, recorded directly above.
//
// Nearest-wins, same walk and the same memoised parent map as the two above,
// rooted at the grid so it is genuinely "set at a grid level and passed down".
/**
 * Which ROLES receive the grid's auto-applied fields. `null` = every role,
 * which is what every grid did before this existed, so an unset key changes
 * nothing.
 *
 * Grid-level ONLY, deliberately: this is a statement about what a KIND of
 * surface is for ("a page header is chrome, a row carries data"), not about
 * one page — and unlike the auto-applied LIST it must not cascade, or setting
 * it on a page would silence the instances beneath it.
 */
export function getAutoAppliedRoles(grid) {
  const v = grid?.meta?.autoAppliedRoles;
  return Array.isArray(v) ? v.filter((r) => typeof r === "string" && r) : null;
}

export function getEffectiveAutoAppliedFieldIds(
  occ, { occurrencesById, parentByChildId, grid } = {},
) {
  const clean = (v) => (Array.isArray(v) ? v.filter((id) => typeof id === "string" && id) : null);
  const gridIds = clean(grid?.meta?.autoAppliedFieldIds) || [];
  if (!occ) return gridIds;
  const pbc = parentByChildId || cachedParentMap(occurrencesById || {});
  let cur = occ;
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    // `null`/absent means "inherit"; `[]` means "none here or below" — the
    // distinction is the whole reason this is a list and not a flag, so it must
    // survive the walk rather than being coalesced away.
    const own = clean(cur.autoAppliedFieldIds);
    if (own) return own;
    const nextId = pbc[cur.id] ?? cur.parentId;
    cur = nextId ? (occurrencesById?.[nextId] || null) : null;
  }
  return gridIds;
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
// ── Feed resolution (2026-07-07) ───────────────────────────────────────────
// A feed is a MATERIALIZED FIND (per user): `occ.feed = { enabled, conditions,
// roles, scope, sort, limit }` selects source occurrences via filter-menu-
// shaped conditions; helpers/feedSync.js then mints COPY-LINKED children of
// the feed owner for each match (and sweeps copies whose source stops
// matching). Copies are marked `meta.feedSourceId` and locked to copy drag
// mode. This resolver answers only "which sources match right now" — the
// sync engine owns minting/sweeping. Sources that are themselves feed copies
// (meta.feedSourceId) are never pullable (no copy-of-copy cascades).

// ── OCCURRENCES BUCKETED BY ROLE, ONCE PER PASS ───────────────────────────
// A feed declares the roles it pulls, and `resolveFeedItems` walked EVERY
// occurrence to apply that filter — once per feed. Measured on poms grid:
//
//     occurrences   21,207   (artifact 15,708 · textblock 2,434 · container
//                             1,654 · instance 1,206 · page 202 · panel 3)
//     enabled feeds     46   of which 44 declare roles ["instance"]
//
// So 44 feeds each walked 21,207 rows to find the 1,206 that could possibly
// match — 94% of every walk rejected by one property read. Across a pass that
// is 975,522 candidate visits to evaluate 84,480 real ones.
//
// Bucketing once per pass makes the rejected 94% free. Memoised on the SAME
// key discipline as `cachedParentsMap` / `cachedAncestorsOf` — the map's
// identity — with `modulesById` checked too, because an occurrence with no
// `role` of its own inherits its MODULE's, so a module edit can change the
// answer without the occurrence map moving.
const _roleIndexCache = new WeakMap();
export function occurrencesByRole(occurrencesById, modulesById) {
  if (!occurrencesById || typeof occurrencesById !== "object") return new Map();
  const hit = _roleIndexCache.get(occurrencesById);
  if (hit && hit.mods === modulesById) return hit.byRole;
  const byRole = new Map();
  for (const occ of Object.values(occurrencesById)) {
    if (!occ?.id) continue;
    const role = occ.role ?? modulesById?.[occ.moduleId]?.role ?? null;
    if (role == null) continue;          // matches `roles.includes(null)` === false
    let arr = byRole.get(role);
    if (!arr) byRole.set(role, (arr = []));
    arr.push(occ);
  }
  _roleIndexCache.set(occurrencesById, { mods: modulesById, byRole });
  return byRole;
}

export function resolveFeedItems(feedOcc, { occurrencesById, modulesById } = {}) {
  const feed = feedOcc?.feed;
  if (!feed?.enabled || !occurrencesById) return [];
  const roles = Array.isArray(feed.roles) && feed.roles.length ? feed.roles : ["instance"];
  const limit = Number(feed.limit) > 0 ? Number(feed.limit) : 50;

  // EVERY parent, not just one. `buildParentMap` keys child -> ONE parent, last
  // writer wins — and this grid multi-parents on purpose (a task lives in its
  // Tasks container AND in each day's `Todo`). Walking up from an arbitrary one
  // of those made `feed.scope` answer by document order: measured on poms grid,
  // 9 of the 18 rows on the Tasks page resolved AWAY from it, so half the page
  // was invisible to the feed scoped to it — including tasks the user had
  // ticked and expected to see filed.
  //
  // Memoised per map identity, and per occurrence within the pass: the scope
  // test runs for every occurrence on the grid, so re-walking a shared ancestor
  // chain thousands of times is the thing `cachedParentMap` exists to avoid.
  // Memoised per MAP IDENTITY, not per call. It used to be per call, so each of
  // the grid's 37 feeds rebuilt the parents map (449ms) and redid all 21,207
  // ancestor walks (599ms) that the previous feed had just done — measured at
  // live-grid scale, ~1,014ms of a 3,083ms feedSync pass, for answers that
  // cannot differ between feeds. The comment here already claimed "memoised per
  // map identity"; only the code disagreed.
  const ancestorsOf = cachedAncestorsOf(occurrencesById);
  // The feed owner + its ancestors are never pullable (recursion), and
  // anything ALREADY under the owner is excluded — those render as the
  // occurrence's own children (per user: own children stay visible).
  const ownChain = new Set([feedOcc.id, ...ancestorsOf(feedOcc.id)]);

  // The predicate is built ONCE per pass, not once per occurrence. Two reasons,
  // and the first is correctness: a condition's value may name a date token
  // (`$today`), and a pass that straddles midnight must not classify two rows
  // against two different "todays". The second is that this lifts the tree
  // construction out of a loop over every occurrence on the grid.
  //
  // `null` = nothing usable to match on, so every candidate passes — which is
  // what the old inline loop did when it skipped every condition.
  const predicate = buildFeedPredicate(feed, { now: new Date() });

  // ORDER IS LOAD-BEARING: with no `feed.sort` the result is `out.slice(0,
  // limit)`, so which rows survive depends on the walk order. Bucketing keeps
  // insertion order WITHIN a role, so a single-role feed is byte-identical —
  // and every one of poms grid's 46 feeds is single-role. A MULTI-role feed
  // would be interleaved by insertion order in the full scan and grouped by
  // role in a concatenation, which is a different 50 rows, so it keeps the full
  // scan rather than being quietly re-ordered for a speed-up nothing is asking
  // for.
  const candidates = roles.length === 1
    ? (occurrencesByRole(occurrencesById, modulesById).get(roles[0]) || [])
    : Object.values(occurrencesById);
  const needsRoleCheck = roles.length !== 1;

  const out = [];
  for (const occ of candidates) {
    if (!occ?.id || ownChain.has(occ.id)) continue;
    if (occ.meta?.feedSourceId) continue; // feed copies are never sources
    const mod = modulesById?.[occ.moduleId];
    if (needsRoleCheck && !roles.includes(occ.role ?? mod?.role ?? null)) continue;
    const ancestors = ancestorsOf(occ.id);
    if (ancestors.includes(feedOcc.id)) continue; // already an owned descendant
    if (feed.scope && !ancestors.includes(feed.scope)) continue;
    // AND/OR + nesting, via the evaluator that has always supported both.
    if (predicate && !evalGroupAgainstRecord(predicate, { ...occ, _ancestors: ancestors }, {})) continue;
    out.push({ occurrence: occ, module: mod || null });
  }

  if (feed.sort?.fieldId) {
    const dir = feed.sort.dir === "desc" ? -1 : 1;
    const val = (o) => {
      const v = o.occurrence.fields?.[feed.sort.fieldId];
      return v && typeof v === "object" && "value" in v ? v.value : v;
    };
    out.sort((a, b) => compareFieldValues(val(a), val(b)) * dir);
  }
  return out.slice(0, limit);
}

// Type-aware compare for feed/table ordering. Lexical compare mis-sorts the
// two shapes this system is full of: time-slot labels ("10:00am" < "2:00am")
// and numeric strings. Order of coercion: 12h/24h time label → minutes since
// midnight, then Number, then Date-parseable string, else localeCompare.
// Nullish sorts last regardless of direction.
const _TIME_LABEL_RE = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i;
function _timeLabelToMinutes(v) {
  if (typeof v !== "string") return null;
  const m = v.match(_TIME_LABEL_RE);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = m[3]?.toLowerCase();
  if (!ap && !m[2]) return null; // bare number — treat as numeric, not time
  if (h > 23 || min > 59) return null;
  if (ap === "pm" && h !== 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  return h * 60 + min;
}
export function compareFieldValues(va, vb) {
  if (va == null && vb == null) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  const ta = _timeLabelToMinutes(va), tb = _timeLabelToMinutes(vb);
  if (ta != null && tb != null) return ta - tb;
  const na = typeof va === "number" ? va : (va !== "" && !isNaN(Number(va)) ? Number(va) : null);
  const nb = typeof vb === "number" ? vb : (vb !== "" && !isNaN(Number(vb)) ? Number(vb) : null);
  if (na != null && nb != null) return na - nb;
  const da = typeof va === "string" ? Date.parse(va) : NaN;
  const db = typeof vb === "string" ? Date.parse(vb) : NaN;
  if (!isNaN(da) && !isNaN(db)) return da - db;
  return String(va).localeCompare(String(vb));
}

/**
 * The visibility conditions a single occurrence's own `filters[]` contribute.
 *
 * A CONDITION-BEARING ENTRY DECLARES `hides` EXPLICITLY. There is no default and no fallback:
 * `0189` stamps the flag on every live entry, and `localFilterHidesDeclared.test.js` fails the
 * build if one ever lacks it. The user's rule, and it is the right one here — *"i dont want
 * backwards compatible. that creates bug"* — a flag whose ABSENCE means "the old behaviour" is
 * two behaviours wearing one name, which is the inert-token class this repo keeps paying for.
 *
 * WHY THE FLAG EXISTS AT ALL, rather than every condition simply hiding: the four live
 * condition entries do two genuinely different jobs. The Trackers page's `Tags` entry rescopes
 * the NUMBERS and must leave the screen alone — 2026-08-20 (5) measured that gating visibility
 * by it would EMPTY the page while the totals rescoped, because `Tags` is mixed (nine wellness
 * dimensions among 45 values in live use). The Tasks page's new entry does the opposite: its
 * whole purpose is to take a finished row off the board. One mechanism, two declared intents.
 *
 * `isOccurrenceVisible` already evaluates a nested group against `$occ`, so nothing new is
 * introduced — what was missing was a way for one container to ask for it.
 */
export function getLocalFilterConditions(occ) {
  const out = [];
  for (const f of (occ?.filters || [])) {
    if (!f?.active) continue;
    if (f.condition != null) {
      // Declared, never defaulted. `0189` stamps `hides` on every live entry and a guard
      // test fails the build if one lacks it, so this reads a value that is always present.
      if (f.hides === true) out.push(f.condition);
      continue;
    }
    if (!f.fieldId) continue;
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
      // ── EXPLICITLY CLEARED is not the same as NO FILTER SET ────────────────
      //
      // User, 2026-08-10: *"for the daypage, i currently have no date set and it
      // pops up with aug 6th and aug 10th"* — and, asked what clearing the date
      // should do: **show nothing dated**.
      //
      // Clearing a date leaves a period OBJECT whose value is null
      // (`{value: null, unit: "day", kind: "single"}` — that is exactly what the
      // Day Page carries today), which sails past the `rightVal == null` guard
      // above and lands in DATE_IN_PERIOD against an empty period. So a cleared
      // filter behaved like no filter at all and every dated row stayed on
      // screen.
      //
      // THE DISTINCTION IS WHY THIS IS SAFE, and it is the whole reason the
      // change is this narrow. Three states are structurally different:
      //
      //   key ABSENT / rightVal null   no filter target — the "— any —" reset,
      //                                and a filter that has not bootstrapped
      //                                yet. Still passes. Untouched.
      //   period object, value null    the user cleared it ON PURPOSE. Hide.
      //   a real value                 filter normally.
      //
      // Without that middle case being its own shape, "hide everything dated"
      // would also fire during a slow load and read as data loss.
      //
      // `dates[]` is checked because a non-consecutive multi-pick can carry a
      // null anchor while still naming real days — that is a selection, not a
      // clear. Reaching here means the occurrence HAS a value for this field
      // (the `leftVal == null` guard above already let persistent rows through),
      // so returning false hides exactly the dated ones and nothing else.
      if (typeof rightVal === "object" && !Array.isArray(rightVal)
          && rightVal.value == null
          && !(Array.isArray(rightVal.dates) && rightVal.dates.length)) {
        return false;
      }
      // Period-shape `{value, unit, span?}` filter values broaden the match
      // window — route through DATE_IN_PERIOD regardless of the condition's
      // static comparator (e.g. SAME_DAY). Covers:
      //   - unit !== "day"  (week/month/year periods)
      //   - span  >  1      (consecutive multi-day picks, kind:"range")
      //   - kind === "multi" + dates[]  (non-consecutive multi-day picks)
      // Without span detection, kind:"range" (unit:"day", span:N) fell back
      // to SAME_DAY which can't compare a string to an object → every
      // schedule day-col was invisible on a multi-day filter.
      //   - kind === "single"  (a single-day pick that still carries the OBJECT
      //     shape `{value, unit:"day", kind:"single"}` — see below)
      //
      // 2026-08-10: this list used to enumerate the period SHAPES, and
      // `kind:"single"` matched none of them — unit is "day", span is undefined,
      // kind is not "multi" — so a single-day pick fell back to SAME_DAY and
      // compared a STRING to an OBJECT. Every Schedule day column went invisible
      // the moment the user narrowed a multi-day range to one day (user: "i go
      // from aug 10th and 11th, to just the 10th and schedule disappears"). The
      // data was intact throughout; only the visibility test failed.
      //
      // So the rule is now the INVARIANT rather than a shape list: if the filter
      // value is an OBJECT, SAME_DAY can never work — it would compare a string
      // to an object and always return false. DATE_IN_PERIOD handles every
      // variant (day/week/month/year/span/multi) and treats `{value, unit:"day"}`
      // as exactly the single day SAME_DAY intended. Enumerating shapes is what
      // made this recur twice; `kind:"range"` was the first.
      const hasPeriod = !!rightVal && typeof rightVal === "object" && !Array.isArray(rightVal);
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
