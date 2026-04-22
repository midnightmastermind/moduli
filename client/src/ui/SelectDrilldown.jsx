// ui/SelectDrilldown.jsx — config-driven multi-level tree select.
// Closed state: chip-chains (one per selection path). Open state: drilldown dropdown portal.
import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import Select from "./Select";
import Multiselect from "./Multiselect";

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
 * @param {{ sources: Array, fields: Array, inLoop?: bool }} args
 * @returns SelectDrilldown config object
 */
export function buildPathConfig({ sources = [], fields = [], inLoop = false }) {
  const fieldsShape = {};
  for (const f of fields) fieldsShape[f.id] = { value: null, flow: null };

  const occShape = { id: null, targetId: null, parentId: null, _ancestors: null, fields: fieldsShape };

  const shapeByVar = {
    $now: null, $today: null, $activeDate: null, $iterationValue: null,
  };
  for (const src of sources) {
    if (src.variableName) shapeByVar[`$${src.variableName}`] = occShape;
  }
  if (inLoop) shapeByVar.$item = occShape;
  shapeByVar.$trigger = {
    occurrenceId: null, fieldId: null, value: null, occurrence: occShape,
    containerId: null, panelId: null,
  };

  function shapeToItems(shape) {
    if (!shape || typeof shape !== "object") return [];
    return Object.keys(shape).map(k => ({
      value: k,
      title: k,
      hasChildren: shape[k] !== null && typeof shape[k] === "object",
    }));
  }

  function makeLevel(shape, labelText) {
    return {
      label: labelText,
      searchable: false,
      multi: false,
      items: () => shapeToItems(shape),
      next: (item) => {
        const child = shape?.[item.value];
        if (child === null || child === undefined || typeof child !== "object") return null;
        return makeLevel(child, item.value);
      },
    };
  }

  return {
    placeholder: "Select…",
    multi: false,
    levels: [makeLevel(shapeByVar, "Variable")],
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
  const { placeholder = "Select…", multi = false, levels = [] } = config;
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

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      {/* Closed state: chip chains */}
      <div ref={triggerRef} onClick={openDrop} style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
        {value.length === 0 ? (
          <span style={placeholderSt}>{placeholder}</span>
        ) : (
          value.map((chain, ci) => (
            <span key={ci} style={chipChainSt}>
              {chain.map((seg, si) => (
                <React.Fragment key={si}>
                  {si > 0 && <span style={{ color: "var(--text-faint)", margin: "0 1px" }}>›</span>}
                  <span>{seg}</span>
                </React.Fragment>
              ))}
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
