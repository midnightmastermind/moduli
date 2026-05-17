// client/src/ui/FiltersSection.jsx
// HeaderDropdown filter section. Top: nav widgets for visible filters.
// Two sub-sections: Ancestor Filters (inherited from the active grid filter)
// and Local Filters (this occurrence's filterOverride entries).
//
// Each row: field-name label + current value + Active switch + Nav switch.
// Ancestor rows get a Lock/Unlock indicator showing whether nav follows parent.
// Local rows get a cog for single-filter edit.

import React, { useState, useContext, useMemo } from "react";
import { Plus, Lock, Unlock, Settings, X } from "lucide-react";
import { GridActionsContext } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import FilterNavWidget from "./FilterNavWidgets";
import FilterEditor from "./FilterEditor";
import { getEffectiveFilterForOccurrence, getParentOccurrence } from "../state/selectors";
import { buildParentMap } from "../helpers/dragHitTesting";

function Switch({ checked, onChange, label, title }) {
  const button = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title || label}
      onClick={() => onChange(!checked)}
      style={{
        width: 26, height: 14, padding: 0,
        border: "1px solid var(--border-default, #374151)",
        borderRadius: 999,
        background: checked ? "var(--accent-blue, #14b8a6)" : "transparent",
        position: "relative", cursor: "pointer",
        flexShrink: 0,
      }}
    >
      <span style={{
        position: "absolute", top: 1, left: checked ? 13 : 1,
        width: 10, height: 10, borderRadius: "50%",
        background: checked ? "white" : "var(--text-muted, #888)",
        transition: "left 0.12s",
      }} />
    </button>
  );
  if (!label) return button;
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, opacity: 0.75, cursor: "pointer", flexShrink: 0 }}>
      <span>{label}</span>
      {button}
    </label>
  );
}

// Local-tz YYYY-MM-DD — matches the format LocalFilterNav / FilterNavWidget /
// bindSocketToStore.onFullState produce. `new Date()` for current local-day.
function localDayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatValue(v) {
  if (v == null || v === "") return "—";
  if (v instanceof Date) return v.toLocaleDateString();
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    // `new Date("2026-05-15")` parses as UTC midnight; `toLocaleDateString` then
    // renders in local tz, which drops back a calendar day for any tz west of
    // UTC. Parse the YYYY-MM-DD digits as local-tz components instead — same
    // pattern operationExecutor.js $today / App.jsx handleFilterNav use.
    const [y, m, d] = v.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString();
  }
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

// Mirrors the nav-widget value-resolution chain so the ancestor-row Date
// readout matches the visible widget. own (filterOverride) → inherited
// (grid.activeFilterValues) → today (only when field is a date and nothing
// else resolved). Without the today fallback the ancestor row reads
// "Date = —" while the widget next to it reads today's date — the user
// complaint in screenshot 2026-05-14 164846.
function resolveFilterDisplayValue({ own, inherited, fieldType }) {
  let value = own !== undefined ? own : inherited;
  if (value == null && fieldType === "date") value = localDayISO();
  return value;
}

export default function FiltersSection({ occurrence }) {
  const ctx = useContext(GridActionsContext);
  const { dispatch, socket, fieldsById, occurrencesById, modulesById, foldersById, state } = ctx;
  const grid = state?.grid;
  const filters = grid?.namedFilters || [];
  const activeFilter = filters.find(f => f.id === grid?.activeFilterId);

  const overrides = occurrence?.filterOverride || {};
  const navConfig = occurrence?.filterNavConfig || {};
  const navValues = grid?.activeFilterValues || {};

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingFilterId, setEditingFilterId] = useState(null);

  // Walk from THIS occurrence's parent upward, collecting every filter that
  // affects this occurrence from above:
  //   - Each ancestor's declared `filters[]` entries (e.g. Schedule's date
  //     filter cascades down to slot containers and instances under it).
  //   - The grid's active named-filter conditions (top of the chain).
  //
  // Each row's display value is resolved via the SAME cascade
  // isOccurrenceVisible uses: nearest non-null filterOverride wins, with
  // grid.activeFilterValues as the floor. This is the parent's effective
  // filter (we start from the parent, NOT self, so the row reflects what
  // we'd inherit if our own override didn't exist).
  // Authoritative parent linkage is parent.occurrences[], not parentId
  // (see selectors.getParentOccurrence). One reverse map shared by both
  // the parent-effective-filter and the ancestor-row walk below so they
  // can never disagree about who an occurrence's parent is.
  const parentByChildId = useMemo(
    () => buildParentMap(occurrencesById || {}),
    [occurrencesById],
  );

  const parentEffectiveFilter = useMemo(() => {
    const parent = getParentOccurrence(occurrence, { occurrencesById, parentByChildId });
    if (!parent) return grid?.activeFilterValues || {};
    return getEffectiveFilterForOccurrence(parent, { grid, occurrencesById, parentByChildId });
  }, [occurrence, occurrencesById, grid, parentByChildId]);

  // THIS occurrence's own effective filter — what the cascade actually
  // applies AT THIS LEVEL (including this occurrence's own filterOverride).
  // Used to drive the Active toggle's effective state. Catches all clear
  // paths: own `filterOverride: {}` (page-wide clear), own
  // `filterOverride[fid] = null` (per-field mute), AND any ancestor that
  // cleared the field above us. If the field is missing from this map,
  // the date filter is NOT active here regardless of why — so the toggle
  // should reflect that.
  const ownEffectiveFilter = useMemo(() => {
    if (!occurrence) return grid?.activeFilterValues || {};
    return getEffectiveFilterForOccurrence(occurrence, { grid, occurrencesById, parentByChildId });
  }, [occurrence, occurrencesById, grid, parentByChildId]);

  const ancestorRows = useMemo(() => {
    const out = [];
    const seen = new Set();

    // 1. Walk parent chain (skip self). Each ancestor's declared filters[]
    //    becomes a row, attributed to that ancestor.
    let cur = getParentOccurrence(occurrence, { occurrencesById, parentByChildId });
    const guard = new Set();
    let depth = 0;
    while (cur && !guard.has(cur.id) && depth++ < 30) {
      guard.add(cur.id);
      const mod = modulesById?.[cur.moduleId];
      const ancestorLabel = mod?.label || cur.label || cur.id;
      for (const f of (cur.filters || [])) {
        if (!f?.fieldId || seen.has(f.fieldId)) continue;
        seen.add(f.fieldId);
        const fld = fieldsById?.[f.fieldId];
        const name = fld?.name || fld?.label || f.fieldId;
        const value = parentEffectiveFilter[f.fieldId];
        out.push({
          kind: "ancestor",
          id: `anc-${cur.id}-${f.fieldId}`,
          fieldId: f.fieldId,
          fieldName: name,
          ancestorId: cur.id,
          ancestorLabel,
          filter: f,
          value,
        });
      }
      const nextId = parentByChildId[cur.id] ?? cur.parentId;
      cur = nextId ? (occurrencesById?.[nextId] || null) : null;
    }

    // 2. Grid's active named filter conditions (top of the chain).
    if (activeFilter) {
      for (const c of (activeFilter.conditions || [])) {
        if (!c?.fieldId || seen.has(c.fieldId)) continue;
        seen.add(c.fieldId);
        const fld = fieldsById?.[c.fieldId];
        const name = fld?.name || fld?.label || c.fieldId;
        const value = parentEffectiveFilter[c.fieldId] ?? c.value;
        out.push({
          kind: "ancestor",
          id: `anc-grid-${c.fieldId}`,
          fieldId: c.fieldId,
          fieldName: name,
          ancestorLabel: "Grid",
          condition: c,
          value,
        });
      }
    }

    return out;
  }, [occurrence, occurrencesById, modulesById, fieldsById, activeFilter, parentEffectiveFilter, parentByChildId]);

  // Set of fieldIds covered by ancestor rows — overrides on these are nav-value
  // adjustments of inherited filters (shown in Ancestor Filters section),
  // NOT new local filters.
  const ancestorFieldIds = useMemo(() => {
    const s = new Set();
    for (const r of ancestorRows) s.add(r.fieldId);
    return s;
  }, [ancestorRows]);

  // Local rows: per-occurrence local filters. Two sources:
  //   1. occurrence.filters[] — declared filters (e.g. schedule page's Time Slot
  //      select). Always shown so the user can see/manage them even before any
  //      override is set. Each row carries `filter` so toggles can patch it.
  //   2. occurrence.filterOverride entries with a non-null value that don't
  //      already correspond to a declared filter or an ancestor. Ad-hoc local
  //      constraints created by nav writes on fields the ancestor isn't filtering.
  const localRows = useMemo(() => {
    const out = [];
    const seen = new Set();
    for (const f of (occurrence?.filters || [])) {
      if (!f?.fieldId) continue;
      if (ancestorFieldIds.has(f.fieldId)) continue;
      if (seen.has(f.fieldId)) continue;
      seen.add(f.fieldId);
      const fld = fieldsById?.[f.fieldId];
      const name = fld?.name || fld?.label || f.fieldId;
      const overrideVal = overrides[f.fieldId];
      out.push({
        kind: "declared",
        id: `loc-${f.fieldId}`,
        fieldId: f.fieldId,
        fieldName: name,
        filter: f,
        value: overrideVal !== undefined ? overrideVal : null,
      });
    }
    for (const [fid, val] of Object.entries(overrides)) {
      if (val == null) continue;
      if (ancestorFieldIds.has(fid)) continue;
      if (seen.has(fid)) continue;
      seen.add(fid);
      const fld = fieldsById?.[fid];
      const name = fld?.name || fld?.label || fid;
      out.push({ kind: "override", id: `loc-${fid}`, fieldId: fid, fieldName: name, value: val });
    }
    return out;
  }, [occurrence?.filters, overrides, fieldsById, ancestorFieldIds]);

  const setMuted = (fieldId, muted) => {
    if (!fieldId) return;
    const next = { ...overrides };
    if (muted) next[fieldId] = null;
    else delete next[fieldId];
    CommitHelpers.updateOccurrenceFilterOverride({
      dispatch, socket, id: occurrence.id, filterOverride: next,
      occurrencesById, modulesById,
      navFieldId: fieldId, date: null,
    });
  };

  const setNavVisible = (filterKey, visible) => {
    const next = { ...navConfig, [filterKey]: { ...(navConfig[filterKey] || {}), visible } };
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrence.id, filterNavConfig: next },
      emit: true,
    });
  };

  const removeLocal = (fieldId) => {
    const next = { ...overrides };
    delete next[fieldId];
    CommitHelpers.updateOccurrenceFilterOverride({
      dispatch, socket, id: occurrence.id, filterOverride: next,
      occurrencesById, modulesById,
      navFieldId: fieldId, date: null,
    });
  };

  // Remove a declared filter entirely from occurrence.filters[] AND clear any
  // override that may have been set on it. Used by the X button on declared
  // local-filter rows.
  const removeDeclaredFilter = (fieldId) => {
    const nextFilters = (occurrence?.filters || []).filter(f => f.fieldId !== fieldId);
    const nextOverrides = { ...overrides };
    delete nextOverrides[fieldId];
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrence.id, filters: nextFilters, filterOverride: nextOverrides },
      emit: true,
    });
  };

  // Toggle .active on a declared filter entry without removing the row.
  const setDeclaredActive = (fieldId, active) => {
    const nextFilters = (occurrence?.filters || []).map(f =>
      f.fieldId === fieldId ? { ...f, active } : f
    );
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrence.id, filters: nextFilters },
      emit: true,
    });
  };

  // Toggle .showNav on a declared filter entry.
  const setDeclaredShowNav = (fieldId, showNav) => {
    const nextFilters = (occurrence?.filters || []).map(f =>
      f.fieldId === fieldId ? { ...f, showNav } : f
    );
    CommitHelpers.updateOccurrence({
      dispatch, socket,
      occurrence: { id: occurrence.id, filters: nextFilters },
      emit: true,
    });
  };

  // Top nav widgets: any visible-nav filter gets a widget.
  // Default visibility: ancestor isNav conditions are visible by default;
  // filterNavConfig.visible: true forces on; visible: false forces off.
  // Two sources contribute:
  //   1. grid.namedFilters — inherited / grid-wide filters
  //   2. occurrence.filters[] — per-occurrence local filters (active && showNav)
  const navItems = useMemo(() => {
    const items = [];
    // (1) Grid namedFilters
    for (const f of filters) {
      const cfg = navConfig[f.id];
      const explicitOff = cfg && cfg.visible === false;
      if (explicitOff) continue;
      const explicitOn = cfg && cfg.visible === true;
      const isActiveDefault = f.id === grid?.activeFilterId
        && Array.isArray(f.conditions)
        && f.conditions.some(c => c?.isNav);
      if (!explicitOn && !isActiveDefault) continue;
      const navCondition = (f.conditions || []).find(c => c?.isNav && c.fieldId);
      const fieldId = navCondition?.fieldId || f.primaryDateFieldId || null;
      // Auto-hide: same rule as LocalFilterNav — if the filter's field
      // isn't applied at this level (own override / ancestor cleared), the
      // filter is deactivated and the widget is suppressed.
      if (fieldId && !(fieldId in ownEffectiveFilter)) continue;
      items.push({ filter: f, fieldId, cfg, source: "grid" });
    }
    // (2) occurrence.filters[] entries — local filters defined on this
    // occurrence. style/options on the entry itself drive the widget; we
    // synthesize a navConfig from those so FilterNavWidget reads them.
    // Dedupe by fieldId: if a grid widget is already rendering for this field
    // (e.g. schedule page's local schedFilterId on dateFieldId vs grid
    // filter_daily on the same dateFieldId), skip the local one to avoid two
    // Date widgets side-by-side.
    const seenFieldIds = new Set(items.map(it => it.fieldId).filter(Boolean));
    for (const f of (occurrence?.filters || [])) {
      if (!f?.fieldId || !f.active || !f.showNav) continue;
      if (seenFieldIds.has(f.fieldId)) continue;
      const cfg = {
        visible: true,
        style: f.style,     // optional — falls back to defaultStyleForFilter
        options: f.options, // optional — falls back to derivedOptionsForFilter
      };
      items.push({
        filter: { ...f, primaryDateFieldId: f.fieldId, timeUnit: f.timeUnit },
        fieldId: f.fieldId,
        cfg,
        source: "local",
      });
      seenFieldIds.add(f.fieldId);
    }
    return items;
  }, [filters, navConfig, grid?.activeFilterId, occurrence?.filters, ownEffectiveFilter]);

  const rowStyle = { display: "flex", alignItems: "center", gap: 8, padding: "4px 0" };
  const labelStyle = { flex: 1, fontSize: 11, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const sectionHeader = { fontSize: 9, opacity: 0.55, textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 8, marginBottom: 4 };

  return (
    <section style={{ marginBottom: 8 }}>
      {/* ── Top: nav widgets ─────────────────────────── */}
      {navItems.length > 0 && (
        <div style={{
          display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8,
          paddingBottom: 8, borderBottom: "1px solid var(--panel-border, #374151)",
          marginBottom: 4,
        }}>
          {navItems.map(({ filter, fieldId, cfg }) => {
            const own = fieldId ? overrides[fieldId] : undefined;
            // Cascade-resolved value from the parent chain (Schedule's override
            // → ... → grid). Falls back to raw grid value if the field isn't
            // touched anywhere above. parentEffectiveFilter is computed in the
            // same `getEffectiveFilterForOccurrence` walk ancestorRows uses, so
            // the widget value here matches the ancestor row readout below.
            const inherited = fieldId
              ? (parentEffectiveFilter[fieldId] ?? navValues[fieldId])
              : undefined;
            const fld = fieldId ? fieldsById?.[fieldId] : null;
            // For a date field with no value set anywhere in the cascade, fall
            // back to local-tz today so the nav widget shows a meaningful
            // value out of the box — it should be locked to the ancestor
            // start (today by default), not blank.
            const value = resolveFilterDisplayValue({ own, inherited, fieldType: fld?.type });
            const navLabel = fld?.name || fld?.label || filter.name;
            // Auto-unlock LOCALLY: write to occurrence.filterOverride[fieldId]
            // so this module navigates independently of the grid + parents.
            // We use plain updateOccurrence (NOT updateOccurrenceFilterOverride)
            // so we don't trigger the descendant-cascade NavigationOp burst
            // that crashed the app — the filter cascade resolves at render
            // time from state, so visibility updates automatically. Ancestor-
            // fieldId overrides are filtered out of the Local Filters list
            // (see ancestorFieldIds Set above) so they don't double-show.
            // Route through updateOccurrenceFilterOverride (not plain
            // updateOccurrence) so onFilterChange-triggered ops fire — that
            // helper updates the executor's localOccsById cache before
            // emitting NavigationOp with the source's ancestor chain, which
            // is what triggers like Build Day's `ancestorLabel: "Schedule"`
            // match against.
            const handleNav = fieldId
              ? (v) => {
                  const next = { ...overrides, [fieldId]: v };
                  CommitHelpers.updateOccurrenceFilterOverride({
                    dispatch, socket,
                    id: occurrence.id,
                    filterOverride: next,
                    occurrencesById, modulesById,
                    navFieldId: fieldId,
                    date: v,
                  });
                }
              : undefined;
            return (
              <div key={filter.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                {navLabel && <span style={{ fontSize: 10, opacity: 0.7 }}>{navLabel}:</span>}
                <FilterNavWidget
                  filter={fieldId && !filter.primaryDateFieldId ? { ...filter, primaryDateFieldId: fieldId } : filter}
                  navConfig={cfg}
                  value={value}
                  fieldsById={fieldsById}
                  occurrencesById={occurrencesById}
                  modulesById={modulesById}
                  foldersById={foldersById}
                  dispatch={dispatch}
                  onNav={handleNav}
                />
              </div>
            );
          })}
        </div>
      )}

      {/* ── Ancestor filters ─────────────────────────── */}
      {ancestorRows.length > 0 && (
        <>
          <div style={sectionHeader}>Ancestor Filters</div>
          {ancestorRows.map(row => {
            const muted = overrides[row.fieldId] === null;
            // Active toggle reflects whether the field is in THIS occurrence's
            // OWN effective filter — collapses every "off" path into one
            // signal: own `filterOverride: {}` (page clears all), own
            // `filterOverride[fid] = null` (per-field mute), OR any ancestor
            // that cleared above. If the field isn't in ownEffectiveFilter,
            // the cascade isn't using it here, so Active should be OFF.
            // Distinguish parentClears separately because the toggle's "ON"
            // path needs to know whether the cascade was muted by US (drop
            // the local null) vs by an ancestor (force-add a today value).
            const parentClears = !(row.fieldId in parentEffectiveFilter);
            const effectivelyActive = row.fieldId in ownEffectiveFilter;
            // Each ancestor row tracks its own filter id — either an ancestor
            // occurrence's declared filter (row.filter.id) or the grid's
            // active named filter (when row is a grid condition). The nav
            // visibility config is keyed by THAT filter id, not always the
            // grid's. Defaults: declared filter with showNav:true → on by
            // default; grid condition with isNav:true → on by default.
            const navFilterId = row.filter?.id || activeFilter?.id;
            const navFilterCfg = navFilterId ? (navConfig[navFilterId] || {}) : {};
            // Inherited filters (row.filter from an ancestor's filters[]) default
            // to OFF — the parent's `showNav` describes whether the SOURCE shows
            // the nav, not whether descendants render their own widget. Grid-
            // namedFilter conditions still default to ON when isNav. Either can
            // be overridden per-occurrence via filterNavConfig[filterId].visible.
            const navOnByDefault = row.filter
              ? false
              : !!row.condition?.isNav;
            const navOnRaw = navFilterCfg.visible === true
              || (navFilterCfg.visible !== false && navOnByDefault);
            // Nav switch reflects the same effectively-active rule the widget
            // rendering uses — a deactivated filter shows Nav=OFF here even if
            // the underlying filterNavConfig hasn't been written yet.
            const navOn = navOnRaw && effectivelyActive;
            const ownValue = overrides[row.fieldId];
            // Use the same resolver the nav widget uses so the readout matches
            // what the widget shows above. Without this the ancestor row reads
            // null/— while the widget renders today.
            const fld = fieldsById?.[row.fieldId];
            const resolved = resolveFilterDisplayValue({
              own: ownValue !== null ? ownValue : undefined, // null = muted; treat as no own
              inherited: row.value,
              fieldType: fld?.type,
            });
            // When parent clears the field AND user hasn't set a local
            // override, show "—" rather than falling back to today — the
            // resolveFilterDisplayValue date-fallback would otherwise lie
            // about there being a value.
            const valueShown = (parentClears && ownValue === undefined)
              ? "—"
              : formatValue(resolved);
            const followsParent = ownValue === undefined; // not overridden = inheriting
            // Click the unlock icon to drop the local override and re-inherit
            // from the ancestor. Locked icon is inert (already inheriting).
            const relock = () => {
              const next = { ...overrides };
              delete next[row.fieldId];
              CommitHelpers.updateOccurrenceFilterOverride({
                dispatch, socket, id: occurrence.id, filterOverride: next,
                occurrencesById, modulesById,
                navFieldId: row.fieldId, date: null,
              });
            };
            return (
              <div key={row.id} style={rowStyle}>
                <button
                  type="button"
                  onClick={followsParent ? undefined : relock}
                  disabled={followsParent}
                  title={followsParent
                    ? "Inheriting from parent — nav changes with parent"
                    : "Overridden locally — click to relock and follow parent"}
                  style={{
                    background: "transparent", border: 0, padding: 2,
                    cursor: followsParent ? "default" : "pointer",
                    color: followsParent ? "var(--text-muted, #888)" : "var(--accent-blue, #14b8a6)",
                    flexShrink: 0, display: "inline-flex", alignItems: "center",
                  }}
                >
                  {followsParent ? <Lock size={11} /> : <Unlock size={11} />}
                </button>
                <span style={labelStyle} title={row.fieldName}>
                  <strong>{row.fieldName}</strong>
                  <span style={{ opacity: 0.6 }}> = {valueShown}</span>
                </span>
                <Switch
                  label="Active"
                  checked={effectivelyActive}
                  onChange={(v) => {
                    if (v) {
                      // Toggle ON. Three sub-cases:
                      //   a) Locally muted (overrides[fid] === null) → drop
                      //      the null entry; cascade flows again.
                      //   b) Page-wide cleared (filterOverride === {}) or
                      //      ancestor clears the field → write today as a
                      //      positive value to force-re-enable the filter
                      //      on THIS occurrence. localDayISO() matches the
                      //      format LocalFilterNav/handleFilterNav use.
                      if (muted) {
                        setMuted(row.fieldId, false);
                      } else {
                        const today = localDayISO();
                        const next = { ...overrides, [row.fieldId]: today };
                        CommitHelpers.updateOccurrenceFilterOverride({
                          dispatch, socket, id: occurrence.id, filterOverride: next,
                          occurrencesById, modulesById,
                          navFieldId: row.fieldId, date: today,
                        });
                      }
                    } else {
                      // Toggle OFF: mute via null, AND auto-hide the nav
                      // widget for this filter (per user: "if its
                      // deactivated, dont show the nav at all"). Keeps the
                      // two switches semantically linked — Nav can't be
                      // visible for a filter that isn't active. User can
                      // re-show Nav independently after re-activating.
                      setMuted(row.fieldId, true);
                      if (navFilterId && navOn) {
                        setNavVisible(navFilterId, false);
                      }
                    }
                  }}
                />
                <Switch
                  label="Nav"
                  checked={navOn}
                  onChange={(v) => navFilterId && setNavVisible(navFilterId, v)}
                />
              </div>
            );
          })}
        </>
      )}

      {/* ── Local filters ────────────────────────────── */}
      <div style={sectionHeader}>Local Filters</div>
      {localRows.length === 0 && (
        <div style={{ fontSize: 11, opacity: 0.5, padding: "4px 0" }}>No local filters set.</div>
      )}
      {localRows.map(row => {
        const isDeclared = row.kind === "declared";
        const navKey = `local-${row.fieldId}`;
        const cfg = navConfig[navKey] || {};
        // Declared filters: nav visibility comes from the filter entry's
        // showNav flag. Ad-hoc overrides: from filterNavConfig[local-fid].
        const navOn = isDeclared ? !!row.filter?.showNav : !!cfg.visible;
        const active = isDeclared ? row.filter?.active !== false : true;
        const valueLabel = row.value != null ? formatValue(row.value) : (isDeclared ? "—" : formatValue(row.value));
        const onActive = isDeclared
          ? (v) => setDeclaredActive(row.fieldId, v)
          : () => removeLocal(row.fieldId);
        const onNav = isDeclared
          ? (v) => setDeclaredShowNav(row.fieldId, v)
          : (v) => setNavVisible(navKey, v);
        const onRemove = isDeclared
          ? () => removeDeclaredFilter(row.fieldId)
          : () => removeLocal(row.fieldId);
        return (
          <div key={row.id} style={rowStyle}>
            <span style={labelStyle} title={row.fieldName}>
              <strong>{row.fieldName}</strong>
              <span style={{ opacity: 0.6 }}> = {valueLabel}</span>
            </span>
            <Switch label="Active" checked={active} onChange={onActive} title={isDeclared ? "Toggle to enable/disable this filter" : "Toggle off to remove this local filter"} />
            <Switch label="Nav" checked={navOn} onChange={onNav} />
            <button
              type="button"
              title="Edit this filter"
              onClick={() => { setEditingFilterId(row.fieldId); setEditorOpen(true); }}
              style={{ background: "transparent", border: 0, padding: 2, cursor: "pointer", color: "var(--text-muted, #888)", flexShrink: 0 }}
            >
              <Settings size={11} />
            </button>
            <button
              type="button"
              title="Remove this filter"
              onClick={onRemove}
              style={{ background: "transparent", border: 0, padding: 2, cursor: "pointer", color: "var(--text-muted, #888)", flexShrink: 0 }}
            >
              <X size={11} />
            </button>
          </div>
        );
      })}

      <button
        onClick={() => { setEditingFilterId(null); setEditorOpen(true); }}
        style={{
          marginTop: 6, fontSize: 11, padding: "3px 8px",
          background: "transparent", color: "inherit",
          border: "1px dashed var(--panel-border, #374151)",
          borderRadius: 4, cursor: "pointer",
          display: "inline-flex", alignItems: "center", gap: 4,
        }}
      >
        <Plus size={12} /> Add local filter
      </button>

      {editorOpen && (
        <FilterEditor
          occurrence={occurrence}
          dispatch={dispatch}
          socket={socket}
          focusFieldId={editingFilterId}
          onClose={() => { setEditorOpen(false); setEditingFilterId(null); }}
        />
      )}
    </section>
  );
}
