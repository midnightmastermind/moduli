# SelectDrilldown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace PathPicker and all re-export shim files with a proper config-driven `SelectDrilldown` component plus `Select`/`Multiselect` primitives.

**Architecture:** Config-driven levels array drives each drilldown page. Closed state renders chip-chains. Open state is a portal dropdown. `buildPathConfig` adapts existing shapeByVar data to the new config format so existing call sites need only minor updates.

**Tech Stack:** React, CSS custom properties (`var(--*)`), `createPortal` for dropdown, existing system design tokens.

**Spec:** `docs/superpowers/specs/2026-04-22-select-drilldown-design.md`

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| **Create** | `client/src/ui/Select.jsx` | Single-select item-list primitive — searchable, hover, hint rows |
| **Create** | `client/src/ui/Multiselect.jsx` | Multi-select item-list primitive — checkboxes, Done button |
| **Create** | `client/src/ui/SelectDrilldown.jsx` | Drilldown dropdown + chip-chain closed state + `buildPathConfig` + value converters |
| **Delete** | `client/src/blocks/PathPicker.jsx` | Replaced by SelectDrilldown |
| **Modify** | `client/src/blocks/OperationsBuilder.jsx` | Replace PathPicker import + 2 call sites |
| **Modify** | `client/src/blocks/ConditionGroup.jsx` | Replace PathPicker import + 1 call site |
| **Delete** | `client/src/modules/Panel.jsx` | Shim → ModulePanel.jsx |
| **Delete** | `client/src/modules/Page.jsx` | Shim → ModulePage.jsx |
| **Delete** | `client/src/modules/Container.jsx` | Shim → ModuleContainer.jsx |
| **Delete** | `client/src/modules/View.jsx` | Shim → ModuleRouter.jsx |
| **Delete** | `client/src/modules/Module.jsx` | Shim → ModuleRouter.jsx |
| **Delete** | `client/src/modules/Artifact.jsx` | Shim → ArtifactContent.jsx |
| **Delete** | `client/src/modules/Instance.jsx` | Shim → ModuleInstance.jsx (MemoInstanceInner) |
| **Delete** | `client/src/modules/PreviewCard.jsx` | Shim → PreviewContent.jsx |
| **Delete** | `client/src/modules/containers/ContainerDoc.jsx` | Shim → DocContent.jsx |
| **Delete** | `client/src/modules/containers/ContainerCanvas.jsx` | Shim → CanvasContent.jsx |
| **Modify** | `client/src/modules/containerHelpers.jsx` | Remove re-export section; keep only CanvasCard |
| **Modify** | `client/src/Grid.jsx` | Panel import → ModulePanel |
| **Modify** | `client/src/ui/FullscreenOverlay.jsx` | Panel import → ModulePanel |
| **Modify** | `client/src/docs/ModuleEmbedNode.jsx` | Container import → ModuleContainer |
| **Modify** | `client/src/modules/ModuleRouter.jsx` | Instance import → MemoInstanceInner from ModuleInstance |
| **Modify** | `client/src/modules/containers/ContainerPool.jsx` | PoolPill import → PoolContent |

---

## Task 1: Delete Shim Files and Update Import Sites

**Files:**
- Delete: all 10 shim files listed above
- Modify: `Grid.jsx`, `FullscreenOverlay.jsx`, `ModuleEmbedNode.jsx`, `ModuleRouter.jsx`, `ContainerPool.jsx`, `containerHelpers.jsx`

- [ ] **Step 1: Delete the 8 simple shim files**

```bash
rm client/src/modules/Panel.jsx
rm client/src/modules/Page.jsx
rm client/src/modules/View.jsx
rm client/src/modules/Module.jsx
rm client/src/modules/Artifact.jsx
rm client/src/modules/Instance.jsx
rm client/src/modules/PreviewCard.jsx
rm client/src/modules/containers/ContainerDoc.jsx
rm client/src/modules/containers/ContainerCanvas.jsx
```

- [ ] **Step 2: Update Grid.jsx — Panel → ModulePanel**

File: `client/src/Grid.jsx`, line 16.

Change:
```js
import Panel from "./modules/Panel";
```
To:
```js
import Panel from "./modules/ModulePanel";
```

- [ ] **Step 3: Update FullscreenOverlay.jsx — Panel → ModulePanel**

File: `client/src/ui/FullscreenOverlay.jsx`, line 3.

Change:
```js
import ModulePanel from "../modules/Panel";
```
To:
```js
import ModulePanel from "../modules/ModulePanel";
```

- [ ] **Step 4: Update ModuleEmbedNode.jsx — Container → ModuleContainer**

File: `client/src/docs/ModuleEmbedNode.jsx`, line 8.

Change:
```js
import Container from "../modules/Container.jsx";
```
To:
```js
import Container from "../modules/ModuleContainer.jsx";
```

- [ ] **Step 5: Update ModuleRouter.jsx — Instance → MemoInstanceInner from ModuleInstance**

File: `client/src/modules/ModuleRouter.jsx`, line 45.

Change:
```js
import Instance from "./Instance.jsx";
```
To:
```js
import { MemoInstanceInner as Instance } from "./ModuleInstance.jsx";
```

- [ ] **Step 6: Update ContainerPool.jsx — PoolPill → PoolContent**

File: `client/src/modules/containers/ContainerPool.jsx`, line 6.

Change:
```js
import { PoolPill } from "../containerHelpers.jsx";
```
To:
```js
import { PoolPill } from "../PoolContent.jsx";
```

- [ ] **Step 7: Trim containerHelpers.jsx — remove the re-export section, keep only CanvasCard**

File: `client/src/modules/containerHelpers.jsx`

Replace the entire file content with just the CanvasCard component. Remove lines 1-10 (the comment header + 3 re-export lines). The file becomes:

```js
// modules/containerHelpers.jsx — CanvasCard: free-position canvas item with pointer drag.
import React, { useRef, useState, useCallback, useEffect } from "react";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { GripVertical } from "lucide-react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { DragType } from "../helpers/dragSystem";

export const CanvasCard = React.memo(function CanvasCard({ module, occurrence, dispatch, socket, style, containerId, panelId, children }) {
  const cardRef = useRef(null);
  const dndHandleRef = useRef(null);
  const startPosRef = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const [pos, setPos] = useState({ x: occurrence?.meta?.x ?? 20, y: occurrence?.meta?.y ?? 20 });
  const [dragging, setDragging] = useState(false);

  React.useEffect(() => {
    setPos({ x: occurrence?.meta?.x ?? 20, y: occurrence?.meta?.y ?? 20 });
  }, [occurrence?.meta?.x, occurrence?.meta?.y]);

  useEffect(() => {
    const el = cardRef.current;
    const handle = dndHandleRef.current;
    if (!el || !handle) return;
    const dragType = module?.role === "container" ? DragType.CONTAINER : DragType.INSTANCE;
    return draggable({
      element: el,
      dragHandle: handle,
      getInitialData: () => ({
        type: dragType,
        id: module.id,
        data: { ...module, occurrence },
        context: { containerId, panelId, instanceId: module.id, occurrenceId: occurrence?.id },
      }),
    });
  }, [module?.id, module?.role, occurrence?.id, containerId, panelId]);

  const onPointerDown = useCallback((e) => {
    if (dndHandleRef.current?.contains(e.target)) return;
    if (e.target.closest?.("input, button, textarea, [contenteditable], .radial-handle, [data-no-canvas-drag]")) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    startPosRef.current = { x: e.clientX, y: e.clientY, ox: pos.x, oy: pos.y };
    setDragging(true);
  }, [pos]);

  const onPointerMove = useCallback((e) => {
    if (!dragging) return;
    const dx = e.clientX - startPosRef.current.x;
    const dy = e.clientY - startPosRef.current.y;
    setPos({ x: Math.max(0, startPosRef.current.ox + dx), y: Math.max(0, startPosRef.current.oy + dy) });
  }, [dragging]);

  const onPointerUp = useCallback((e) => {
    if (!dragging) return;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
    if (occurrence?.id) {
      CommitHelpers.updateOccurrence({ dispatch, socket,
        occurrence: { ...occurrence, meta: { ...(occurrence.meta || {}), x: pos.x, y: pos.y } },
        emit: true });
    }
  }, [dragging, occurrence, pos, dispatch, socket]);

  return (
    <div
      ref={cardRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: "absolute",
        left: pos.x, top: pos.y,
        minWidth: 160, maxWidth: 300,
        background: "var(--surface-overlay)",
        border: `1px solid ${dragging ? "rgba(99,102,241,0.6)" : "var(--input-border)"}`,
        borderRadius: 8,
        cursor: dragging ? "grabbing" : "default",
        boxShadow: dragging ? "0 8px 24px rgba(0,0,0,0.5)" : "0 2px 8px rgba(0,0,0,0.3)",
        ...style,
        zIndex: dragging ? 100 : 1,
        userSelect: "none", WebkitUserSelect: "none",
        transition: dragging ? "none" : "box-shadow 0.15s",
        overflow: "hidden",
      }}
    >
      <div
        ref={dndHandleRef}
        data-dnd-handle="true"
        title="Drag to another panel"
        style={{
          position: "absolute", top: 3, right: 4, zIndex: 10,
          cursor: "grab", opacity: 0.3, display: "flex", alignItems: "center",
          padding: 2, pointerEvents: "auto",
        }}
        onPointerEnter={e => { e.currentTarget.style.opacity = "0.8"; }}
        onPointerLeave={e => { e.currentTarget.style.opacity = "0.3"; }}
      >
        <GripVertical size={10} />
      </div>
      {children}
    </div>
  );
});
```

- [ ] **Step 8: Verify app still starts**

```bash
npm run dev
```

Expected: no import errors in terminal, app loads.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: delete shim re-export files, update import sites to point at real modules"
```

---

## Task 2: Build Select.jsx Primitive

**Files:**
- Create: `client/src/ui/Select.jsx`

- [ ] **Step 1: Create Select.jsx**

```jsx
// ui/Select.jsx — single-select item list: used as one "page" inside SelectDrilldown.
import React, { useState, useMemo, useRef, useEffect } from "react";

const itemSt = (hovered) => ({
  display: "flex", alignItems: "center", gap: 6,
  padding: "5px 10px", cursor: "pointer", userSelect: "none",
  fontFamily: "var(--font-mono)", fontSize: 11,
  color: hovered ? "var(--accent-blue-text)" : "var(--text-primary)",
  background: hovered ? "var(--accent-blue-bg)" : "transparent",
});

const hintSt = {
  display: "block", fontSize: 9, color: "var(--text-faint)",
  fontFamily: "var(--font-mono)", marginTop: 1,
};

const searchSt = {
  width: "100%", boxSizing: "border-box",
  padding: "5px 10px", fontSize: 11, fontFamily: "var(--font-mono)",
  background: "transparent", border: "none", borderBottom: "1px solid var(--border-subtle)",
  color: "var(--text-primary)", outline: "none",
};

/**
 * Single-select item list.
 * @param {{ items: Array<{value,title,sub?,hint?,disabled?,hasChildren?}>, onSelect: fn, searchable?: bool }} props
 */
export default function Select({ items, onSelect, searchable = false }) {
  const [query, setQuery] = useState("");
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const searchRef = useRef(null);

  useEffect(() => {
    if (searchable) searchRef.current?.focus();
  }, [searchable]);

  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(it => it.title.toLowerCase().includes(q) || it.sub?.toLowerCase().includes(q));
  }, [items, query]);

  return (
    <div>
      {searchable && (
        <input
          ref={searchRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setHoveredIdx(-1); }}
          placeholder="Search…"
          style={searchSt}
        />
      )}
      <div style={{ overflowY: "auto", maxHeight: 260 }}>
        {filtered.length === 0 && (
          <div style={{ padding: "8px 10px", fontSize: 10, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
            No results
          </div>
        )}
        {filtered.map((it, i) => (
          <div
            key={it.value}
            style={{ ...itemSt(hoveredIdx === i), opacity: it.disabled ? 0.4 : 1 }}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(-1)}
            onMouseDown={e => { e.preventDefault(); if (!it.disabled) onSelect(it); }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              {it.title}
              {it.sub && <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>{it.sub}</span>}
              {it.hint && <span style={hintSt}>{it.hint}</span>}
            </span>
            {it.hasChildren && (
              <span style={{ color: "var(--text-faint)", fontSize: 10 }}>›</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify file was created and app builds**

```bash
ls client/src/ui/Select.jsx
```

Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/Select.jsx
git commit -m "feat: add Select single-select item list primitive"
```

---

## Task 3: Build Multiselect.jsx Primitive

**Files:**
- Create: `client/src/ui/Multiselect.jsx`

- [ ] **Step 1: Create Multiselect.jsx**

```jsx
// ui/Multiselect.jsx — multi-select item list with checkboxes and a Done button.
import React, { useState, useMemo, useRef, useEffect } from "react";

const itemSt = (hovered) => ({
  display: "flex", alignItems: "center", gap: 8,
  padding: "5px 10px", cursor: "pointer", userSelect: "none",
  fontFamily: "var(--font-mono)", fontSize: 11,
  color: hovered ? "var(--accent-blue-text)" : "var(--text-primary)",
  background: hovered ? "var(--accent-blue-bg)" : "transparent",
});

const checkboxSt = (checked) => ({
  width: 12, height: 12, borderRadius: 2, flexShrink: 0,
  border: `1px solid ${checked ? "var(--accent-blue-border)" : "var(--border-default)"}`,
  background: checked ? "var(--accent-blue-bg)" : "transparent",
  display: "flex", alignItems: "center", justifyContent: "center",
});

const hintSt = {
  display: "block", fontSize: 9, color: "var(--text-faint)",
  fontFamily: "var(--font-mono)", marginTop: 1,
};

const searchSt = {
  width: "100%", boxSizing: "border-box",
  padding: "5px 10px", fontSize: 11, fontFamily: "var(--font-mono)",
  background: "transparent", border: "none", borderBottom: "1px solid var(--border-subtle)",
  color: "var(--text-primary)", outline: "none",
};

const doneBtnSt = {
  width: "100%", padding: "5px 10px", textAlign: "center",
  fontSize: 10, fontFamily: "var(--font-mono)", cursor: "pointer",
  background: "var(--accent-blue-bg)", border: "none",
  borderTop: "1px solid var(--border-subtle)",
  color: "var(--accent-blue-text)", fontWeight: 600,
};

/**
 * Multi-select item list.
 * @param {{ items, selectedValues: string[], onDone: fn(selectedValues), searchable?: bool }} props
 */
export default function Multiselect({ items, selectedValues = [], onDone, searchable = false }) {
  const [selected, setSelected] = useState(new Set(selectedValues));
  const [query, setQuery] = useState("");
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const searchRef = useRef(null);

  useEffect(() => {
    if (searchable) searchRef.current?.focus();
  }, [searchable]);

  const filtered = useMemo(() => {
    if (!query) return items;
    const q = query.toLowerCase();
    return items.filter(it => it.title.toLowerCase().includes(q) || it.sub?.toLowerCase().includes(q));
  }, [items, query]);

  const toggle = (value) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value); else next.add(value);
      return next;
    });
  };

  return (
    <div>
      {searchable && (
        <input
          ref={searchRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setHoveredIdx(-1); }}
          placeholder="Search…"
          style={searchSt}
        />
      )}
      <div style={{ overflowY: "auto", maxHeight: 240 }}>
        {filtered.length === 0 && (
          <div style={{ padding: "8px 10px", fontSize: 10, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>
            No results
          </div>
        )}
        {filtered.map((it, i) => {
          const checked = selected.has(it.value);
          return (
            <div
              key={it.value}
              style={{ ...itemSt(hoveredIdx === i), opacity: it.disabled ? 0.4 : 1 }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(-1)}
              onMouseDown={e => { e.preventDefault(); if (!it.disabled) toggle(it.value); }}
            >
              <div style={checkboxSt(checked)}>
                {checked && <span style={{ fontSize: 8, color: "var(--accent-blue-text)", lineHeight: 1 }}>✓</span>}
              </div>
              <span style={{ flex: 1, minWidth: 0 }}>
                {it.title}
                {it.sub && <span style={{ color: "var(--text-muted)", marginLeft: 6 }}>{it.sub}</span>}
                {it.hint && <span style={hintSt}>{it.hint}</span>}
              </span>
            </div>
          );
        })}
      </div>
      <button style={doneBtnSt} onMouseDown={e => { e.preventDefault(); onDone([...selected]); }}>
        Done ({selected.size} selected)
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify file exists**

```bash
ls client/src/ui/Multiselect.jsx
```

Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/Multiselect.jsx
git commit -m "feat: add Multiselect multi-select item list primitive"
```

---

## Task 4: Build SelectDrilldown.jsx

**Files:**
- Create: `client/src/ui/SelectDrilldown.jsx`

- [ ] **Step 1: Create SelectDrilldown.jsx**

```jsx
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
  minWidth: 220, maxHeight: 340, overflow: "hidden",
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
  const { placeholder = "Select…", levels = [] } = config;
  const [open, setOpen] = useState(false);
  const [drillPath, setDrillPath] = useState([]); // [{levelConfig, chosenItem}]
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
      onChange([...value, chain]);
      setOpen(false);
    }
  }, [currentLevel, drillPath, value, onChange]);

  const handleMultiDone = useCallback((selectedValues) => {
    if (!currentLevel) return;
    const prefix = drillPath.map(d => d.chosenItem.value);
    const newChains = selectedValues.map(v => [...prefix, v]);
    onChange([...value, ...newChains]);
    setOpen(false);
  }, [currentLevel, drillPath, value, onChange]);

  const goToDepth = useCallback((depth) => {
    setDrillPath(prev => prev.slice(0, depth));
  }, []);

  // Remove a chain by index
  const removeChain = useCallback((idx) => {
    onChange(value.filter((_, i) => i !== idx));
  }, [value, onChange]);

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
                  style={{ cursor: i < breadcrumbs.length - 1 ? "pointer" : "default", textDecoration: i < breadcrumbs.length - 1 ? "underline" : "none" }}
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
```

- [ ] **Step 2: Verify file was created**

```bash
ls client/src/ui/SelectDrilldown.jsx
```

Expected: file exists.

- [ ] **Step 3: Commit**

```bash
git add client/src/ui/SelectDrilldown.jsx
git commit -m "feat: add SelectDrilldown config-driven drilldown component with buildPathConfig and value converters"
```

---

## Task 5: Delete PathPicker and Update Call Sites

**Files:**
- Delete: `client/src/blocks/PathPicker.jsx`
- Modify: `client/src/blocks/OperationsBuilder.jsx` (import line 18, call sites lines 718 and 730 and 883 and 886)
- Modify: `client/src/blocks/ConditionGroup.jsx` (import line 4, call sites lines 55 and 90)

- [ ] **Step 1: Delete PathPicker.jsx**

```bash
rm client/src/blocks/PathPicker.jsx
```

- [ ] **Step 2: Update OperationsBuilder.jsx — import**

File: `client/src/blocks/OperationsBuilder.jsx`, line 18.

Change:
```js
import PathPicker, { buildPathShape } from "./PathPicker";
```
To:
```js
import SelectDrilldown, { buildPathConfig, chainToPathString, pathStringToChain } from "../ui/SelectDrilldown";
```

- [ ] **Step 3: Update OperationsBuilder.jsx — ExprOrPath component (lines 715-734)**

The `ExprOrPath` function uses `buildPathShape` and `PathPicker`. Replace both.

Change:
```js
const shape = useMemo(() => buildPathShape({ sources, fields, inLoop }), [sources, fields, inLoop]);
```
To:
```js
const pathConfig = useMemo(() => buildPathConfig({ sources, fields, inLoop }), [sources, fields, inLoop]);
```

Change the PathPicker render:
```jsx
? <PathPicker value={value || ""} onChange={onChange} shapeByVar={shape} placeholder={placeholder || "$var…"} />
```
To:
```jsx
? <SelectDrilldown
    config={pathConfig}
    value={value ? [pathStringToChain(value)] : []}
    onChange={chains => onChange(chains.length > 0 ? chainToPathString(chains[chains.length - 1]) : "")}
  />
```

- [ ] **Step 4: Update OperationsBuilder.jsx — ConditionRule component (line 883)**

Change:
```js
const shape = useMemo(() => buildPathShape({ sources, fields, inLoop: true }), [sources, fields]);
```
To:
```js
const pathConfig = useMemo(() => buildPathConfig({ sources, fields, inLoop: true }), [sources, fields]);
```

Change the PathPicker render (line 886):
```jsx
<PathPicker value={rule.left || ""} onChange={v => onUpdate({ left: v })} shapeByVar={shape} placeholder="variable…" />
```
To:
```jsx
<SelectDrilldown
  config={pathConfig}
  value={rule.left ? [pathStringToChain(rule.left)] : []}
  onChange={chains => onUpdate({ left: chains.length > 0 ? chainToPathString(chains[chains.length - 1]) : "" })}
/>
```

- [ ] **Step 5: Update ConditionGroup.jsx — import (line 4)**

Change:
```js
import PathPicker, { buildPathShape } from "./PathPicker";
```
To:
```js
import SelectDrilldown, { buildPathConfig, chainToPathString, pathStringToChain } from "../ui/SelectDrilldown";
```

- [ ] **Step 6: Update ConditionGroup.jsx — body (lines 55 and 90)**

Change:
```js
const shape = buildPathShape({ sources, fields, inLoop: true });
```
To:
```js
const pathConfig = buildPathConfig({ sources, fields, inLoop: true });
```

Change (line 90):
```jsx
<PathPicker value={rule.left} onChange={(next) => onChange({ ...rule, left: next })} shapeByVar={shape} />
```
To:
```jsx
<SelectDrilldown
  config={pathConfig}
  value={rule.left ? [pathStringToChain(rule.left)] : []}
  onChange={chains => onChange({ ...rule, left: chains.length > 0 ? chainToPathString(chains[chains.length - 1]) : "" })}
/>
```

- [ ] **Step 7: Start dev server and test manually**

```bash
npm run dev
```

Open the app. Navigate to Command Center → Operations. Open any operation with a pipeline that has a ConditionRule (loop + if step). Verify:
1. The drilldown shows a chip-chain (or placeholder) where PathPicker used to be
2. Clicking the chip opens the dropdown portal
3. Selecting a variable ($item, $trigger, etc.) drills into its properties
4. Selecting a leaf closes the dropdown and updates the chip-chain
5. The value string passed to the operation is a dot-joined path (e.g. `$item.fields.water.value`)

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: replace PathPicker with SelectDrilldown in OperationsBuilder and ConditionGroup"
```

---

## Post-Implementation Checklist

- [ ] All shim files deleted (run `ls client/src/modules/*.jsx` — no Panel/Page/Container/View/Module/Artifact/Instance/PreviewCard)
- [ ] `containerHelpers.jsx` contains only CanvasCard
- [ ] `PathPicker.jsx` deleted
- [ ] App starts with no import errors
- [ ] SelectDrilldown renders in OperationsBuilder ExprOrPath and ConditionRule
- [ ] Drilldown correctly reflects the shapeByVar structure from `buildPathConfig`
- [ ] Selected value roundtrips correctly through `chainToPathString`/`pathStringToChain`
