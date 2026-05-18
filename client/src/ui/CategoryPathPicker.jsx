// CategoryPathPicker — config-driven, category-first path picker.
//
// Open state: each level renders rich tiles (icon block / title / sub / description)
// like PanelKindSelector. Items with children get a body click (drill in) and a
// dedicated "Pick this" chevron on the right (data-testid="pick-this-{value}")
// that commits the current chain up to and including that value — so every
// level is stoppable.
//
// Closed state: the chosen path renders as a fluffed-out chip chain joined
// with `›` separators (no dots). An × clears the value, returning to the
// placeholder pill.
//
// Config:
//   { placeholder?, categories? }   — overriding categories produces "entity mode"
//                                     (any list of categories; same row UX).
// Default: CATEGORIES from categoryRegistry.
//
// Props:
//   value: string                   — dot-joined chain (e.g. "$everyOcc.fields.water.value")
//   onChange: (string) => void
//   ctx:    { sources, fields, localVars, modulesById, occurrencesById, fieldsById }
//   config?: { placeholder, categories }
//   mode?: "path" | "entity"        — cosmetic only; the picker behaves the same.
//
// The picker is intentionally a single component used everywhere a path or an
// entity reference is selected, so the visual language is consistent.

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";
import { CATEGORIES, resolveCategoryItems } from "./categoryRegistry";

// Shape descriptors used when drilling past level 2 in path mode.
// Each entry is the set of keys exposed on that shape and what a follow-on
// drill should produce. Keeping these explicit makes the picker fully
// deterministic without poking at runtime data.
const SHAPES = {
  occurrence: {
    keys: (ctx) => [
      { value: "id",          title: "id",          sub: "string",   description: "Unique occurrence ID",                           hasChildren: false },
      { value: "moduleId",    title: "moduleId",    sub: "string",   description: "Module this occurrence renders",                  hasChildren: false },
      { value: "parentId",    title: "parentId",    sub: "string",   description: "Parent occurrence ID",                            hasChildren: false },
      { value: "_ancestors",  title: "_ancestors",  sub: "string[]", description: "Ancestor chain (closest first)",                  hasChildren: false },
      { value: "label",       title: "label",       sub: "string",   description: "Module label (resolved from template)",           hasChildren: false },
      { value: "templateId",  title: "templateId",  sub: "string",   description: "Same as moduleId — module template",              hasChildren: false },
      { value: "fields",      title: "fields",      sub: "object",   description: "Field values map keyed by field ID",              hasChildren: true,  childShape: "fieldsMap" },
      { value: "meta",        title: "meta",        sub: "object",   description: "Module/occurrence meta",                          hasChildren: false },
      // Table-container grid state lives under occurrence.meta.table but the
      // user shouldn't need to know that — surface columns / rowCount / cells
      // directly at the occurrence level. The `value` carries the literal
      // `meta.table.*` path so segments.join(".") still produces the address
      // applyUpdate routes through (UPDATE_ITEM_META → metaPath: [..]).
      { value: "meta.table.columns",  title: "columns",  sub: "table columns", description: "Column defs (title / width / displayFieldId / sort / filter / fieldFilter)", hasChildren: true, childShape: "tableColumn" },
      { value: "meta.table.rowCount", title: "rowCount", sub: "number",        description: "Total row count rendered by the table",                                       hasChildren: false },
      { value: "meta.table.cells",    title: "cells",    sub: "cell map",      description: "Per-cell TipTap doc keyed by \"r:c\"",                                          hasChildren: true, childShape: "tableCellsMap" },
      { value: "filterOverride",   title: "filterOverride",   sub: "object", description: "Per-occurrence filter override",                                       hasChildren: false },
      { value: "_effectiveFilter", title: "_effectiveFilter", sub: "object", description: "Effective filter merged from grid + ancestor chain (read-only)",      hasChildren: true, childShape: "filter" },
    ],
  },
  fieldValue: {
    keys: () => [
      { value: "value", title: "value", sub: "any",    description: "The aggregated or raw value",      hasChildren: false },
      { value: "flow",  title: "flow",  sub: "string", description: "in / out / replace",                 hasChildren: false },
    ],
  },
  filter: {
    // Per-field key drilling. The merged filter map is keyed by fieldId so
    // pipelines like `$page._effectiveFilter.<dateFieldId>` need to resolve to
    // a concrete field. Surface every grid date/text/number field from ctx.
    keys: (ctx) => {
      const list = ctx?.fields || [];
      const items = list.map(f => ({
        value: f.id,
        title: f.name || "(unnamed field)",
        sub: f.type || "field",
        description: `Filter value for ${f.name || "this field"} on the merged map`,
        hasChildren: false,
      }));
      // Convenience accessor returning the first YYYY-MM-DD value found.
      items.unshift({
        value: "date", title: "date", sub: "string",
        description: "First YYYY-MM-DD value in the merged map",
        hasChildren: false,
      });
      return items;
    },
  },
  grid: {
    keys: () => [
      { value: "activeFilterId",     title: "activeFilterId",     sub: "string", description: "Current filter preset",        hasChildren: false },
      { value: "activeFilterValues", title: "activeFilterValues", sub: "object", description: "Live filter values",            hasChildren: true, childShape: "filter" },
      { value: "namedFilters",       title: "namedFilters",       sub: "array",  description: "All named filters on the grid", hasChildren: false },
    ],
  },
  // Single column definition under meta.table.columns[i]. Drillable so writes
  // like `$item.meta.table.columns.0.sort = "asc"` are pickable.
  tableColumn: {
    keys: () => [
      { value: "id",              title: "id",              sub: "string", description: "Stable column id (tcol_<…>)",                                       hasChildren: false },
      { value: "title",           title: "title",           sub: "string", description: "Header label",                                                       hasChildren: false },
      { value: "width",           title: "width",           sub: "number", description: "Column width in px",                                                 hasChildren: false },
      { value: "displayFieldId",  title: "displayFieldId",  sub: "string", description: "Single-field projection: render only this field, compact",         hasChildren: false },
      { value: "sort",            title: "sort",            sub: "string", description: "View-only sort: null / \"asc\" / \"desc\"",                          hasChildren: false },
      { value: "filter",          title: "filter",          sub: "object", description: "View-only filter: { comparator, value } (compares against cell sort value)", hasChildren: false },
      { value: "fieldFilter",     title: "fieldFilter",     sub: "object", description: "Embed-render filter: { mode: \"show\"|\"hide\", fieldIds: [...] }", hasChildren: false },
    ],
  },
  // meta.table.cells is keyed by `"r:c"` — the picker can't enumerate every
  // r:c pair (rowCount × cols is unbounded), but we need the path to be
  // drill-stoppable so authors can WRITE specific cells by typing the key.
  // For now we surface a single "Pick this" leaf — the author commits at
  // .cells and types the final segment by hand, OR uses a template token.
  tableCellsMap: {
    keys: () => [
      { value: "<r:c>", title: "(cell by r:c)", sub: "any", description: "Pick the cells map; the leaf segment \"r:c\" identifies the cell", hasChildren: false },
    ],
  },
};

function shapeForSourceEntityType(entityType) {
  if (entityType === "allOccurrences" || entityType === "allContainers" || entityType === "allPages" || entityType === "allInstances") return "occurrenceArray";
  if (entityType === "allTemplates") return "templateArray";
  if (entityType === "occurrence" || entityType === "instance" || entityType === "container" || entityType === "panel") return "occurrence";
  if (entityType === "field" || entityType === "localField") return "fieldValue";
  if (entityType === "parentFilter" || entityType === "effectiveFilter") return "filter";
  if (entityType === "grid") return "grid";
  if (entityType === "trigger") return "occurrence"; // trigger props mostly resolve to occurrence-shaped data
  return null;
}

function arrayItemsAsKeys(arrayShape, ctx) {
  // For a collection (e.g. $allContainers), we surface the same keys as a single
  // occurrence — drilling into the array gives you the per-item shape.
  if (arrayShape === "occurrenceArray") return SHAPES.occurrence.keys(ctx);
  if (arrayShape === "templateArray") return [
    { value: "id",    title: "id",    sub: "string", description: "Module ID",         hasChildren: false },
    { value: "label", title: "label", sub: "string", description: "Module label",       hasChildren: false },
    { value: "name",  title: "name",  sub: "string", description: "Module internal name", hasChildren: false },
    { value: "role",  title: "role",  sub: "string", description: "panel / container / instance", hasChildren: false },
    { value: "kind",  title: "kind",  sub: "string", description: "list / doc / board / artifact", hasChildren: false },
    { value: "meta",  title: "meta",  sub: "object", description: "Module meta",        hasChildren: false },
  ];
  if (arrayShape === "fieldArray") return [
    { value: "id",    title: "id",    sub: "string", description: "Field ID",         hasChildren: false },
    { value: "name",  title: "name",  sub: "string", description: "Display name",      hasChildren: false },
    { value: "type",  title: "type",  sub: "string", description: "number / text / boolean / select / date / rating / duration", hasChildren: false },
    { value: "meta",  title: "meta",  sub: "object", description: "Field meta (unit, options, prefix, postfix, etc.)", hasChildren: false },
    { value: "folderId", title: "folderId", sub: "string", description: "Category folder ID", hasChildren: false },
  ];
  return [];
}

function fieldsMapItems(ctx) {
  const list = ctx.fields || [];
  return list.map(f => ({
    value: f.id,
    title: f.name || "(unnamed field)",
    sub: f.type || "field",
    description: `Per-occurrence value for ${f.name || "this field"}`,
    hasChildren: true,
    childShape: "fieldValue",
  }));
}

function descendShape(shape, ctx) {
  if (!shape) return [];
  if (shape === "occurrence") return SHAPES.occurrence.keys(ctx);
  if (shape === "fieldValue") return SHAPES.fieldValue.keys(ctx);
  if (shape === "filter") return SHAPES.filter.keys(ctx);
  if (shape === "grid") return SHAPES.grid.keys(ctx);
  if (shape === "fieldsMap") return fieldsMapItems(ctx);
  if (shape === "occurrenceArray" || shape === "templateArray" || shape === "fieldArray") return arrayItemsAsKeys(shape, ctx);
  return [];
}

// Built-in vars that the executor populates on every run, keyed to their shape.
// Used so $allItems / $parentFilter / $trigger drill correctly even without an
// explicit Source row.
const BUILTIN_VAR_SHAPES = {
  $allItems: "occurrenceArray",
  $allOccurrences: "occurrenceArray",
  $allContainers: "occurrenceArray",
  $allInstances: "occurrenceArray",
  $allPages: "occurrenceArray",
  $allPanels: "occurrenceArray",
  $allTemplates: "templateArray",
  $allFields: "fieldArray",
  $parentFilter: "filter",
  $trigger: "occurrence",
  $grid: "grid",
  $this: "occurrence",  // the current instance — the row whose field is being resolved
};

function findSourceForVarName(ctx, varName) {
  const stripped = varName.startsWith("$") ? varName.slice(1) : varName;
  return (ctx.sources || []).find(s => s.variableName === stripped);
}

// Resolve a single chip segment to a friendly display label. The picker stores
// raw values (`field:fieldId`, ids), but chips should read like names so the
// path is legible at a glance — `[Water] [value]` instead of `[field:abc123]
// [value]`. Anything that doesn't resolve falls back to the raw segment.
function segmentDisplay(seg, ctx) {
  if (!seg) return seg;
  if (seg.startsWith("field:")) {
    const fid = seg.slice(6);
    const f = ctx?.fieldsById?.[fid];
    if (f?.name) return f.name;
    return seg;
  }
  if (seg.startsWith("$")) return seg;
  // Filter maps key by fieldId, so a raw fieldId may appear as a chip segment
  // (e.g. `$parentFilter.<fieldId>` or `$page._effectiveFilter.<fieldId>`).
  if (ctx?.fieldsById?.[seg]) {
    return ctx.fieldsById[seg].name || seg;
  }
  if (ctx?.modulesById?.[seg]) {
    const m = ctx.modulesById[seg];
    return m.label || m.name || seg;
  }
  if (ctx?.occurrencesById?.[seg]) {
    const occ = ctx.occurrencesById[seg];
    const m = occ.moduleId && ctx.modulesById?.[occ.moduleId];
    return m?.label || m?.name || seg;
  }
  return seg;
}

// Given the chain so far (e.g. ["sources", "$everyOcc", "fields"]), return the
// items for the next level + a label describing what we're looking at.
//
// `recordShape` (optional): when set, the picker bypasses the category-picking
// step entirely. Level 0 lists the keys of that shape; subsequent levels drill
// via each item's `childShape`. The committed value is just the dotted record
// path (`label`, `fields.<fid>.value`) — no `$` prefix, no category id. Used by
// Find's predicate left-side, which iterates a chosen collection and evaluates
// each rule against the current record.
function itemsForLevel(chain, ctx, categories, recordShape) {
  if (recordShape) {
    let currentItems = descendShape(recordShape, ctx);
    if (chain.length === 0) {
      return { label: "Pick a record field", items: currentItems };
    }
    let currentLabel = "Record fields";
    for (let i = 0; i < chain.length; i++) {
      const seg = chain[i];
      const matchedItem = currentItems.find(it => it.value === seg);
      if (!matchedItem) { currentItems = []; currentLabel = seg; break; }
      currentLabel = matchedItem.title;
      if (matchedItem.childShape) currentItems = descendShape(matchedItem.childShape, ctx);
      else { currentItems = []; break; }
    }
    return { label: currentLabel, items: currentItems };
  }

  if (chain.length === 0) {
    return {
      label: "Where does this come from?",
      items: categories.map(c => ({
        value: c.id,
        title: c.label,
        sub: null,
        description: c.description,
        hasChildren: true,
        _categoryRow: true,
        _color: c.color,
        _icon: c.icon,
      })),
    };
  }
  if (chain.length === 1) {
    const cat = categories.find(c => c.id === chain[0]);
    if (!cat) return { label: "—", items: [] };
    const items = cat.resolveItems(ctx).map(i => ({
      ...i,
      _color: cat.color,
      _icon: cat.icon,
    }));
    return { label: cat.label, items };
  }
  // Level 2+: walk the shape based on the second segment (the picked variable)
  const variable = chain[1];
  let shape = null;
  if (variable.startsWith("$")) {
    // Built-in vars take precedence — they're exposed in the picker as items
    // that don't necessarily have a Source row, but the executor still populates
    // them ($allItems, $parentFilter, $trigger, etc.).
    if (BUILTIN_VAR_SHAPES[variable]) {
      shape = BUILTIN_VAR_SHAPES[variable];
    } else {
      const src = findSourceForVarName(ctx, variable);
      if (src) {
        shape = shapeForSourceEntityType(src.entityType);
      } else {
        // Anything else starting with `$` — local var, source we can't classify,
        // built-in object — gets the permissive occurrence shape so the picker is
        // never a dead end. The runtime decides whether the path actually
        // resolves; the editor just exposes the names.
        shape = "occurrence";
      }
    }
  } else if (variable.startsWith("field:")) {
    shape = "fieldValue";
  }

  // Walk remaining chain segments through the shape map. Each segment may have
  // a childShape that overrides the next descent.
  let currentItems = descendShape(shape, ctx);
  let currentLabel = chain[1];
  for (let i = 2; i < chain.length; i++) {
    const seg = chain[i];
    const matchedItem = currentItems.find(it => it.value === seg);
    if (!matchedItem) {
      currentItems = [];
      currentLabel = seg;
      break;
    }
    currentLabel = matchedItem.title;
    if (matchedItem.childShape) {
      currentItems = descendShape(matchedItem.childShape, ctx);
    } else {
      currentItems = [];
      break;
    }
  }
  return { label: currentLabel, items: currentItems };
}

// ---- Styles ----
// The dropdown layers two surfaces: the panel itself (`--surface` / fallback to
// the dark editor bg) and a slightly lighter list area inside. Without an
// explicit list bg the open panel reads as transparent against the editor.
const dropdownSt = {
  position: "fixed", zIndex: 9999,
  background: "var(--surface, #1f2125)",
  border: "1px solid var(--border-default)",
  borderRadius: 8, boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
  minWidth: 320, maxHeight: 420, overflow: "hidden",
  display: "flex", flexDirection: "column",
};
const breadcrumbSt = {
  display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap",
  padding: "6px 10px",
  background: "var(--input-bg, rgba(255,255,255,0.03))",
  borderBottom: "1px solid var(--border-subtle)",
  fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-muted)",
};
const tileSt = {
  display: "flex", alignItems: "flex-start", gap: 10,
  width: "100%", padding: "8px 10px",
  background: "var(--input-bg, rgba(255,255,255,0.04))",
  border: "1px solid var(--border-subtle)", borderRadius: 6,
  cursor: "pointer", textAlign: "left",
};
const tileHoverSt = { background: "var(--accent-blue-bg, rgba(59,130,246,0.15))" };
const iconBlockSt = (color) => ({
  width: 28, height: 28, borderRadius: 6,
  background: color, display: "flex", alignItems: "center", justifyContent: "center",
  flexShrink: 0,
});
const titleRowSt = { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" };
const titleTextSt = { fontSize: 12, color: "var(--text-primary)", fontWeight: 500, fontFamily: "var(--font-mono)" };
const subTextSt = { fontSize: 9, color: "var(--text-faint)", fontFamily: "var(--font-mono)" };
const descTextSt = { fontSize: 10, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.3 };
const pickThisSt = {
  marginLeft: "auto", display: "flex", alignItems: "center", justifyContent: "center",
  width: 24, height: 24, borderRadius: 4,
  background: "var(--input-bg)", border: "1px solid var(--border-subtle)",
  color: "var(--text-muted)", cursor: "pointer", flexShrink: 0,
};
const placeholderSt = {
  display: "inline-flex", alignItems: "center",
  padding: "3px 10px", borderRadius: 4,
  background: "var(--input-bg)", border: "1px dashed var(--border-default)",
  fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-faint)",
  cursor: "pointer", userSelect: "none",
};
const chipSt = {
  display: "inline-flex", alignItems: "center",
  padding: "2px 7px", borderRadius: 4,
  background: "var(--input-bg)", border: "1px solid var(--border-default)",
  fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-primary)",
};
const chipChainSt = {
  display: "inline-flex", alignItems: "center", gap: 3, flexWrap: "wrap",
  maxWidth: "100%",
};
const sepSt = { color: "var(--text-faint)", margin: "0 2px" };

// ---- Tile component ----
function Tile({ item, onBodyClick, onPickThis }) {
  const [hover, setHover] = useState(false);
  const Icon = item._icon;
  const color = item._color || "rgba(120,120,120,0.7)";

  const showChevron = item.hasChildren;
  return (
    <button
      type="button"
      onClick={onBodyClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={hover ? { ...tileSt, ...tileHoverSt } : tileSt}
    >
      {Icon ? (
        <span style={iconBlockSt(color)}>
          <Icon size={14} color="white" />
        </span>
      ) : (
        <span style={iconBlockSt(color)} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={titleRowSt}>
          <span style={titleTextSt}>{item.title}</span>
          {item.sub && <span style={subTextSt}>{item.sub}</span>}
        </div>
        {item.description && <div style={descTextSt}>{item.description}</div>}
      </div>
      {showChevron && (
        <span
          role="button"
          data-testid={`pick-this-${item.value}`}
          onClick={(e) => { e.stopPropagation(); onPickThis(); }}
          title="Pick this — stop here without drilling further"
          style={pickThisSt}
        >
          <ChevronRight size={14} />
        </span>
      )}
    </button>
  );
}

// ---- Main component ----
export default function CategoryPathPicker({
  value = "",
  onChange,
  ctx = {},
  config,
  mode = "path",
}) {
  const placeholder = config?.placeholder || (mode === "entity" ? "Pick reference" : "Pick path");
  const categories = config?.categories || CATEGORIES;
  const recordShape = config?.recordShape || null;

  const [open, setOpen] = useState(false);
  const [drillChain, setDrillChain] = useState([]); // values of items chosen on the way down
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const dropRef = useRef(null);

  const openMenu = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const top = Math.min(r.bottom + 4, window.innerHeight - 440);
    const left = Math.min(r.left, window.innerWidth - 340);
    setPos({ top, left });
    setDrillChain([]);
    setOpen(true);
  }, []);

  // Outside-click closes
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (dropRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Keep escape closing the menu
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const level = useMemo(
    () => itemsForLevel(drillChain, ctx, categories, recordShape),
    [drillChain, ctx, categories, recordShape],
  );

  const commitChain = useCallback((extra) => {
    // In recordShape mode every drill segment is part of the value (no synthetic
    // category step); in normal mode drillChain[0] is the category id and gets
    // dropped from the persisted value.
    const segments = recordShape ? [...drillChain] : [...drillChain.slice(1)];
    if (extra !== undefined) segments.push(extra);
    onChange(segments.join("."));
    setOpen(false);
  }, [drillChain, onChange, recordShape]);

  const handleBodyClick = useCallback((item) => {
    if (item.hasChildren) {
      setDrillChain(prev => [...prev, item.value]);
    } else {
      commitChain(item.value);
    }
  }, [commitChain]);

  const handlePickThis = useCallback((item) => {
    commitChain(item.value);
  }, [commitChain]);

  // Closed-state chip rendering. Split on `.` but keep `field:xxx` together.
  const chipSegments = useMemo(() => {
    if (!value) return [];
    const out = [];
    let buf = "";
    for (let i = 0; i < value.length; i++) {
      const ch = value[i];
      if (ch === "." && !buf.startsWith("field:")) {
        if (buf) out.push(buf);
        buf = "";
      } else if (ch === "." && buf.startsWith("field:") && !buf.includes(".", 6)) {
        // first dot after `field:xxx` — treat as separator
        out.push(buf);
        buf = "";
      } else {
        buf += ch;
      }
    }
    if (buf) out.push(buf);
    return out;
  }, [value]);

  const goToDepth = useCallback((depth) => setDrillChain(prev => prev.slice(0, depth)), []);

  const breadcrumbs = useMemo(() => {
    const rootLabel = recordShape ? "Record" : "Categories";
    const crumbs = [{ label: rootLabel, depth: 0 }];
    for (let i = 0; i < drillChain.length; i++) {
      const sub = itemsForLevel(drillChain.slice(0, i), ctx, categories, recordShape);
      const found = sub.items.find(it => it.value === drillChain[i]);
      crumbs.push({ label: found?.title || drillChain[i], depth: i + 1 });
    }
    return crumbs;
  }, [drillChain, ctx, categories, recordShape]);

  const clearValue = (e) => {
    e.stopPropagation();
    onChange("");
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <div ref={triggerRef}>
        {!value ? (
          <button
            type="button"
            onClick={openMenu}
            aria-label={placeholder}
            style={placeholderSt}
          >
            + {placeholder}
          </button>
        ) : (
          <span data-testid="picker-closed-chips" style={chipChainSt} title={value}>
            {chipSegments.map((seg, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span style={sepSt}>›</span>}
                <span style={chipSt} title={seg}>{segmentDisplay(seg, ctx)}</span>
              </React.Fragment>
            ))}
            <button
              type="button"
              onClick={clearValue}
              title="Clear path"
              style={{
                marginLeft: 4, background: "none", border: "none",
                color: "var(--text-faint)", cursor: "pointer",
                fontSize: 12, lineHeight: 1, padding: "0 2px",
              }}
            >×</button>
          </span>
        )}
      </div>

      {open && createPortal(
        <div ref={dropRef} style={{ ...dropdownSt, top: pos.top, left: pos.left }}>
          <div style={breadcrumbSt}>
            {breadcrumbs.map((c, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span style={sepSt}>›</span>}
                <span
                  onClick={() => goToDepth(c.depth)}
                  style={{
                    cursor: i < breadcrumbs.length - 1 ? "pointer" : "default",
                    textDecoration: i < breadcrumbs.length - 1 ? "underline" : "none",
                    color: i < breadcrumbs.length - 1 ? "var(--accent-blue-text)" : "inherit",
                  }}
                >{c.label}</span>
              </React.Fragment>
            ))}
          </div>
          <div style={{ overflowY: "auto", padding: 4, display: "flex", flexDirection: "column", gap: 1 }}>
            {level.items.length === 0 && (
              <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--text-faint)", fontStyle: "italic" }}>
                Nothing to drill into here. Pick a higher level or add a Source binding.
              </div>
            )}
            {level.items.map((item, i) => (
              <Tile
                key={`${item.value}-${i}`}
                item={item}
                onBodyClick={() => handleBodyClick(item)}
                onPickThis={() => handlePickThis(item)}
              />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
