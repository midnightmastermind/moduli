// ui/SelectDrilldown.jsx — config-driven multi-level tree select.
// Closed state: chip-chains (one per selection path). Open state: drilldown dropdown portal.
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import Select from "./Select";
import Multiselect from "./Multiselect";
import { labelForId } from "../helpers/labelHelpers";

// ---- Value converters ----

/** ["$item","fields","water","value"] → "$item.fields.water.value" */
export function chainToPathString(chain) {
  return (chain || []).join(".");
}

/** "$item.fields.water.value" → ["$item","fields","water","value"] */
export function pathStringToChain(str) {
  return str ? str.split(".") : [];
}

// ---- buildPathConfig ----

/**
 * Converts a PathPicker shapeByVar into a SelectDrilldown config.
 * Emits { title, sub } per item so field IDs render as "Water" + "…a8f3b2" instead
 * of raw UIDs. Also exposes `resolveSegmentLabel(seg)` on the config so the closed
 * chip chain can name-resolve each segment.
 *
 * @param {{ sources: Array, fields: Array, inLoop?: bool, fieldsById?: Object, modulesById?: Object, occurrencesById?: Object }} args
 * @returns SelectDrilldown config object
 */
export function buildPathConfig({ sources = [], fields = [], inLoop = false, fieldsById, modulesById, occurrencesById, localVars = [] }) {
  const fieldsShape = {};
  for (const f of fields) fieldsShape[f.id] = { value: null, flow: null };

  const mergedFieldsById = fieldsById || Object.fromEntries(fields.map(f => [f.id, f]));

  const occShape = { id: null, moduleId: null, parentId: null, _ancestors: null, fields: fieldsShape, meta: {}, label: null, templateId: null };

  // Built-in shapes only include scalars and $grid. Collection vars
  // ($allItems, $allTemplates, $parentFilter) are no longer auto-exposed —
  // a Source row must bind them so the user explicitly picks what shows up
  // in the path picker (matches the new DrilldownPicker gating).
  const shapeByVar = {
    $now: null, $today: null, $activeDate: null, $activeDateLabel: null, $activeDayOfWeek: null,
  };
  for (const src of sources) {
    if (!src.variableName) continue;
    const k = `$${src.variableName}`;
    if (src.entityType === "allOccurrences" || src.entityType === "allContainers" || src.entityType === "allPages" || src.entityType === "allInstances") {
      shapeByVar[k] = [occShape];
    } else if (src.entityType === "allTemplates") {
      shapeByVar[k] = [{ id: null, name: null, label: null, role: null, kind: null, meta: {} }];
    } else if (src.entityType === "parentFilter" || src.entityType === "effectiveFilter") {
      shapeByVar[k] = { date: null };
    } else {
      shapeByVar[k] = occShape;
    }
  }
  if (inLoop) shapeByVar.$item = occShape;
  // Local vars declared by INIT_VAR / SET_VAR / loop.as. Without this, paths
  // like `$schedDate` or `$slot.label` render as raw text instead of resolved
  // chip chains. Loop iteration vars get the occShape (rich enough to drill
  // into); plain INIT_VAR names are scalars (null) by default — the user can
  // toggle to free-text mode if they need to drill deeper than that.
  for (const name of localVars) {
    if (!name || typeof name !== "string" || !name.startsWith("$")) continue;
    if (shapeByVar[name] !== undefined) continue;
    // Heuristic: $slot / $preset / $item etc. are usually loop vars carrying
    // arbitrary object shapes — give them a permissive shape so pickers don't
    // dead-end. The path resolver doesn't validate these against runtime
    // values; the editor just needs something to drill into.
    shapeByVar[name] = occShape;
  }
  // NOTE: $trigger is intentionally NOT exposed in the path picker. To use any
  // $trigger.* property in your pipeline, add a Source row of type "trigger"
  // with a triggerProp — that promotes it to a named $var which then appears
  // here. This forces explicit declaration of which trigger props the pipeline
  // depends on (and keeps the path picker focused on values that actually exist
  // for THIS specific operation).

  // Resolve a raw segment (variable name or ID) to its display label.
  // Full path is always shown — no truncation. If an ID resolves to a label we
  // surface the friendly name; otherwise the raw segment is shown verbatim so
  // the user can always read the complete path end-to-end.
  const resolveSegmentLabel = (seg) => {
    if (!seg) return { title: seg, sub: null };
    if (seg.startsWith("$")) return { title: seg, sub: null };
    const resolved = labelForId(seg, { fieldsById: mergedFieldsById, modulesById, occurrencesById });
    if (resolved?.label) return { title: resolved.label, sub: `…${resolved.shortId}` };
    return { title: seg, sub: null };
  };

  function shapeToItems(shape) {
    if (!shape || typeof shape !== "object") return [];
    return Object.keys(shape).map(k => {
      const { title, sub } = resolveSegmentLabel(k);
      const child = shape[k];
      const hasChildren =
        (child !== null && typeof child === "object" && !Array.isArray(child)) ||
        (Array.isArray(child) && child.length > 0 && typeof child[0] === "object");
      return { value: k, title, sub, hasChildren };
    });
  }

  function makeLevel(shape, labelText) {
    return {
      label: labelText,
      searchable: false,
      multi: false,
      items: () => shapeToItems(shape),
      next: (item) => {
        let child = shape?.[item.value];
        // Arrays (e.g. $allOccurrences) drill into the first sample element.
        if (Array.isArray(child)) child = child[0];
        if (child === null || child === undefined || typeof child !== "object") return null;
        return makeLevel(child, resolveSegmentLabel(item.value).title);
      },
    };
  }

  return {
    placeholder: "Select…",
    multi: false,
    levels: [makeLevel(shapeByVar, "Variable")],
    resolveSegmentLabel,
  };
}

// ---- Styles ----

const dropdownSt = {
  position: "fixed", zIndex: 9999,
  background: "var(--input-bg)", border: "1px solid var(--border-default)",
  borderRadius: 6, boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
  minWidth: 240, maxHeight: 320, overflow: "hidden",
  display: "flex", flexDirection: "column",
};

const breadcrumbSt = {
  display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap",
  padding: "5px 10px", borderBottom: "1px solid var(--border-subtle)",
  fontFamily: "var(--font-mono)", fontSize: 9, color: "var(--text-muted)",
};

const chipChainSt = {
  display: "inline-flex", alignItems: "center", gap: 3,
  padding: "2px 6px", borderRadius: 4,
  background: "var(--input-bg)", border: "1px solid var(--border-default)",
  fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-primary)",
  cursor: "pointer", userSelect: "none",
  // Show the full path. No truncation, no ellipsis, no max-width clamp.
  // The chain wraps to the next line if it overflows but every segment stays
  // legible end-to-end.
  whiteSpace: "normal", wordBreak: "break-word", maxWidth: "100%",
};

const placeholderSt = {
  display: "inline-flex", alignItems: "center",
  padding: "2px 8px", borderRadius: 4,
  background: "var(--input-bg)", border: "1px dashed var(--border-default)",
  fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-faint)",
  cursor: "pointer", userSelect: "none",
};

// ---- SelectDrilldown ----

/**
 * Config-driven multi-level drilldown select.
 *
 * @param {{
 *   config: { placeholder?, multi?, levels: Array<LevelConfig> },
 *   value: string[][],
 *   onChange: fn(string[][]),
 * }} props
 *
 * LevelConfig: { label, searchable?, multi?, items(parentValue) → [{value,title,sub?,hint?,hasChildren?,disabled?}], next(item) → LevelConfig|null }
 */
export default function SelectDrilldown({ config = {}, value = [], onChange }) {
  const { placeholder = "Select…", multi = false, levels = [], resolveSegmentLabel } = config;
  const [open, setOpen] = useState(false);
  const [drillPath, setDrillPath] = useState([]); // [{levelConfig, chosenItem, nextLevel}]
  const triggerRef = useRef(null);
  const dropRef = useRef(null);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });

  const openDrop = useCallback(() => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const top = Math.min(r.bottom + 4, window.innerHeight - 344);
    const left = Math.min(r.left, window.innerWidth - 230);
    setDropPos({ top, left });
    setDrillPath([]);
    setOpen(true);
  }, []);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (dropRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Current level config
  const currentLevel = useMemo(() => {
    if (drillPath.length === 0) return levels[0] ?? null;
    return drillPath[drillPath.length - 1].nextLevel;
  }, [drillPath, levels]);

  // Items for current level
  const currentItems = useMemo(() => {
    if (!currentLevel) return [];
    const parentValue = drillPath.length > 0 ? drillPath[drillPath.length - 1].chosenItem?.value : undefined;
    return currentLevel.items(parentValue) ?? [];
  }, [currentLevel, drillPath]);

  const handleSelect = useCallback((item) => {
    if (!currentLevel) return;
    const nextLevel = currentLevel.next(item);
    if (nextLevel) {
      // Drill in — not a leaf
      setDrillPath(prev => [...prev, { levelConfig: currentLevel, chosenItem: item, nextLevel }]);
    } else {
      // Leaf — build chain and close
      const chain = [...drillPath.map(d => d.chosenItem.value), item.value];
      onChange(multi ? [...value, chain] : [chain]);
      setOpen(false);
    }
  }, [currentLevel, drillPath, value, onChange]);

  const handleMultiDone = useCallback((selectedValues) => {
    if (!currentLevel) return;
    const prefix = drillPath.map(d => d.chosenItem.value);
    const newChains = selectedValues.map(v => [...prefix, v]);
    onChange(multi ? [...value, ...newChains] : newChains);
    setOpen(false);
  }, [currentLevel, drillPath, value, onChange]);

  const goToDepth = useCallback((depth) => {
    setDrillPath(prev => prev.slice(0, depth));
  }, []);

  const breadcrumbs = useMemo(() => {
    const crumbs = [];
    if (levels[0]) crumbs.push({ label: levels[0].label ?? "Select", depth: 0 });
    drillPath.forEach((d, i) => {
      crumbs.push({ label: d.chosenItem.title, depth: i + 1 });
    });
    return crumbs;
  }, [levels, drillPath]);

  // When a value is selected, the chip chain itself is no longer a click target —
  // the user has to clear (×) or re-pick from the dropdown affordance to change it.
  // Empty state: the placeholder pill IS the click target.
  const hasValue = value.length > 0;
  const clearValue = (chainIdx) => {
    const next = value.filter((_, i) => i !== chainIdx);
    onChange(next);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      {/* Closed state: chip chains */}
      <div
        ref={triggerRef}
        onClick={hasValue ? undefined : openDrop}
        style={{
          display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap",
          cursor: hasValue ? "default" : "pointer",
        }}
      >
        {!hasValue ? (
          <span style={placeholderSt}>{placeholder}</span>
        ) : (
          value.map((chain, ci) => (
            <span
              key={ci}
              style={{ ...chipChainSt, cursor: "default" }}
              title={chain.join(".")}
            >
              {chain.map((seg, si) => {
                const resolved = resolveSegmentLabel?.(seg) ?? { title: seg, sub: null };
                return (
                  <React.Fragment key={si}>
                    {si > 0 && <span style={{ color: "var(--text-faint)", margin: "0 1px" }}>›</span>}
                    <span>{resolved.title}</span>
                  </React.Fragment>
                );
              })}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); clearValue(ci); }}
                title="Clear path"
                style={{
                  marginLeft: 4, background: "none", border: "none",
                  color: "var(--text-faint)", cursor: "pointer",
                  fontSize: 12, lineHeight: 1, padding: "0 2px",
                }}
              >
                ×
              </button>
            </span>
          ))
        )}
      </div>

      {/* Dropdown portal */}
      {open && createPortal(
        <div ref={dropRef} style={{ ...dropdownSt, top: dropPos.top, left: dropPos.left }}>
          {/* Breadcrumb bar */}
          <div style={breadcrumbSt}>
            {breadcrumbs.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span style={{ color: "var(--text-faint)" }}>›</span>}
                <span
                  onClick={() => goToDepth(crumb.depth)}
                  style={{ cursor: i < breadcrumbs.length - 1 ? "pointer" : "default", textDecoration: i < breadcrumbs.length - 1 ? "underline" : "none", color: i < breadcrumbs.length - 1 ? "var(--accent-blue-text)" : "inherit" }}
                >
                  {crumb.label}
                </span>
              </React.Fragment>
            ))}
          </div>

          {/* Item list */}
          {currentLevel?.multi ? (
            <Multiselect
              items={currentItems.map(it => ({ ...it, hasChildren: false }))}
              selectedValues={[]}
              onDone={handleMultiDone}
              searchable={currentLevel.searchable}
            />
          ) : (
            <Select
              items={currentItems}
              onSelect={handleSelect}
              searchable={currentLevel?.searchable}
            />
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
