// ui/InstanceLayoutEditor.jsx
//
// The placement's ROW LAYOUT, in its Layout settings (user, 2026-10-15): the label,
// the cover and each field sit in nested boxes; each box lays its items out as
// columns (side by side) or rows (stacked), can wrap or not, and fields and boxes are
// DRAGGED (user, 2026-10-27: "the arrows are too slow"), with a blue line where the
// drop lands — before/after any item, the top of any box, inside an empty box
// (helpers/instanceLayout.moveNode). Pointer events, so touch and the headset's
// controller drag too. A field chip, clicked, opens its own styling: hide its name, width,
// size, colour, own line. Stored on `occurrence.meta.instanceLayout`
// (helpers/instanceLayout); a copy of the placement carries it.

import React, { useEffect, useMemo, useRef, useState } from "react";
import LayoutDragOverlay from "./LayoutDragOverlay";
import { useGridActions } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import * as L from "../helpers/instanceLayout";

const box = { border: "1px dashed var(--border-default)", borderRadius: 6, padding: 6, display: "flex", gap: 6, minHeight: 32 };
const chipBase = { fontSize: 13, padding: "3px 4px 3px 10px", borderRadius: 999, border: "1px solid var(--border-default)", background: "var(--input-bg)", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", display: "inline-flex", alignItems: "center", gap: 4 };
const tiny = { fontSize: 12, padding: "2px 7px", border: "1px solid var(--border-default)", borderRadius: 4, background: "transparent", color: "var(--text-muted)", cursor: "pointer" };
const DRAG_START_PX = 5;

const parsePath = (s) => (s ? s.split(".").map(Number) : []);

// Where a drop at (x, y) lands: { path, index, line } or null. `line` is the blue bar's
// screen rect. Reads the DOM the editor renders: items carry data-li="<path>|<index>",
// each box's item list carries data-lg="<path>" and data-dir.
export function dropTargetAt(root, x, y, draggedEl) {
  const el = document.elementFromPoint?.(x, y);
  if (!el || !root?.contains(el) || draggedEl?.contains(el)) return null;
  const hit = el.closest("[data-li],[data-lg]");
  if (!hit || !root.contains(hit)) return null;
  const T = 3;
  if (hit.hasAttribute("data-li")) {
    const [p, i] = hit.getAttribute("data-li").split("|");
    const list = hit.parentElement;
    const row = list?.getAttribute("data-dir") === "row";
    const r = hit.getBoundingClientRect();
    const before = row ? x < r.left + r.width / 2 : y < r.top + r.height / 2;
    const index = Number(i) + (before ? 0 : 1);
    const line = row
      ? { left: (before ? r.left : r.right) - T / 2 - 2, top: r.top, width: T, height: r.height }
      : { left: r.left, top: (before ? r.top : r.bottom) - T / 2 - 2, width: r.width, height: T };
    return { path: parsePath(p), index, line };
  }
  const row = hit.getAttribute("data-dir") === "row";
  const kids = [...hit.children].filter((c) => c.hasAttribute("data-li") && c !== draggedEl);
  const rects = kids.map((c) => c.getBoundingClientRect());
  let index = 0;
  rects.forEach((r, k) => {
    const isBefore = row ? (r.bottom < y || (r.top <= y && r.left + r.width / 2 < x)) : r.top + r.height / 2 < y;
    if (isBefore) index = Number(kids[k].getAttribute("data-li").split("|")[1]) + 1;
  });
  const b = hit.getBoundingClientRect();
  const prev = rects[kids.findIndex((c) => Number(c.getAttribute("data-li").split("|")[1]) === index - 1)];
  const line = !kids.length || index === 0
    ? { left: b.left, top: b.top, width: row && kids.length ? T : b.width, height: row && kids.length ? (rects[0]?.height || 20) : T }
    : row
      ? { left: prev.right + 1, top: prev.top, width: T, height: prev.height }
      : { left: b.left, top: prev.bottom + 1, width: b.width, height: T };
  return { path: parsePath(hit.getAttribute("data-lg")), index, line };
}

export default function InstanceLayoutEditor({ occurrence }) {
  const { dispatch, socket, modulesById, fieldsById, occurrencesById } = useGridActions() || {};
  const module = occurrence?.moduleId ? modulesById?.[occurrence.moduleId] : null;
  const stored = occurrence?.meta?.instanceLayout || null;
  const [selected, setSelected] = useState(null);
  // Drag: `pending` is the press (not yet a drag), `drag` the live drag
  // { key, label, x, y, target }. Kept in refs for the window listeners.
  const rootRef = useRef(null);
  const pending = useRef(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const layoutRef = useRef(null);

  const fieldIds = useMemo(() => L.layoutFieldIds(module, fieldsById || {}), [module, fieldsById]);
  const hasCover = useMemo(() => (module?.fieldBindings || []).some((b) => b.role === "media" || b.role === "files"), [module?.fieldBindings]);
  const avail = useMemo(() => [L.LABEL, ...(hasCover ? [L.COVER] : []), ...fieldIds.map(L.fieldKey)], [fieldIds, hasCover]);

  const write = (next) => {
    const meta = { ...(occurrence.meta || {}) };
    if (next == null) delete meta.instanceLayout; else meta.instanceLayout = next;
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: occurrence.id, meta }, emit: true });
  };

  const startDrag = (e, path, index, label) => {
    if (e.button != null && e.button !== 0) return;
    e.stopPropagation();
    pending.current = { path, index, label, key: `${path.join(".")}|${index}`, x0: e.clientX, y0: e.clientY, el: e.currentTarget.closest("[data-li]") };
  };
  useEffect(() => {
    const move = (e) => {
      const p = pending.current;
      if (!p) return;
      if (!dragRef.current && Math.hypot(e.clientX - p.x0, e.clientY - p.y0) < DRAG_START_PX) return;
      e.preventDefault();
      const target = dropTargetAt(rootRef.current, e.clientX, e.clientY, p.el);
      dragRef.current = { key: p.key, label: p.label, x: e.clientX, y: e.clientY, target };
      setDrag(dragRef.current);
    };
    const up = () => {
      const p = pending.current, d = dragRef.current;
      pending.current = null; dragRef.current = null;
      if (!p || !d) return;
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
      setDrag(null);
      const lay = layoutRef.current;
      if (d.target && lay) {
        const next = L.moveNode(lay, p.path, p.index, d.target.path, d.target.index);
        if (next !== lay) write(next);
      }
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  });

  if (!occurrence?.id) return null;
  if (!stored) {
    return (
      <div style={{ padding: "6px 12px" }}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Row layout</div>
        <button type="button" style={{ ...tiny, fontSize: 13, padding: "4px 10px" }}
          onClick={() => write(L.defaultLayout(fieldIds, { hasCover }))}>Arrange this row…</button>
      </div>
    );
  }

  const layout = { ...stored, tree: L.resolveTree(stored, avail).tree };
  layoutRef.current = layout;
  // Same name, same fields: every day's copy of this routine (often on its own cloned module).
  const twins = L.sameShapeTargets(occurrence, { occurrencesById: occurrencesById || {}, modulesById: modulesById || {}, fieldsById: fieldsById || {} });
  const applyAll = () => {
    const label = occurrence.label || module?.label || "row";
    if (!window.confirm(`Give all ${twins.length} other "${label}" instances with these fields this layout?`)) return;
    CommitHelpers.applyInstanceLayout({ dispatch, socket, layout: stored, occurrenceIds: twins, occurrencesById });
  };
  const nameOf = (key) => key === L.LABEL ? "Label" : key === L.COVER ? "Cover" : (fieldsById?.[L.fieldIdOf(key)]?.name || "Field");
  const renderGroup = (g, path) => {
    const row = g.dir === "row";
    return (
      <div key={path.join(".") || "root"} data-layout-path={path.join(".")}
        {...(path.length ? { "data-li": `${path.slice(0, -1).join(".")}|${path[path.length - 1]}` } : {})}
        style={{ ...box, flexDirection: "column", ...(path.length && drag?.key === `${path.slice(0, -1).join(".")}|${path[path.length - 1]}` ? { opacity: 0.35 } : null) }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap", ...(path.length ? { cursor: "grab", touchAction: "none" } : null) }}
          onPointerDown={path.length ? (e) => { if (!e.target.closest("button")) startDrag(e, path.slice(0, -1), path[path.length - 1], "Box"); } : undefined}>
          {path.length > 0 && <span title="Drag to move this box" style={{ cursor: "grab", color: "var(--text-muted)", fontSize: 13, padding: "0 2px" }}>⠿</span>}
          <button type="button" style={tiny} title="Lay these out side by side or stacked"
            onClick={() => write(L.toggleDir(layout, path))}>{row ? "Columns" : "Rows"}</button>
          {row && (
            <button type="button" style={tiny} title="Responsive: wrap onto the next line when narrow"
              onClick={() => write(L.setGroupProps(layout, path, { wrap: g.wrap === false ? null : false }))}>
              {g.wrap === false ? "No wrap" : "Wraps"}
            </button>
          )}
          {path.length > 0 && (
            <button type="button" style={tiny} title="Take up the free space"
              onClick={() => write(L.setGroupProps(layout, path, { grow: g.grow ? null : true }))}>{g.grow ? "Fills" : "Fits"}</button>
          )}
          <button type="button" style={tiny} onClick={() => write(L.addGroup(layout, path))}>+ Box</button>
          {path.length > 0 && <button type="button" style={tiny} title="Remove this box (its items move out)"
            onClick={() => write(L.removeGroup(layout, path))}>×</button>}
        </div>
        <div data-lg={path.join(".")} data-dir={row ? "row" : "col"}
          style={{ display: "flex", flexDirection: row ? "row" : "column", flexWrap: row ? "wrap" : "nowrap", gap: 6, alignItems: row ? "flex-start" : "stretch", minHeight: 22 }}>
          {g.items.map((it, i) => typeof it === "object" ? renderGroup(it, [...path, i]) : (
            <span key={it} data-layout-key={it} data-li={`${path.join(".")}|${i}`}
              onPointerDown={(e) => startDrag(e, path, i, nameOf(it))}
              onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } setSelected(selected === it ? null : it); }}
              style={{ ...chipBase, padding: "3px 10px", cursor: "grab", touchAction: "none", ...(selected === it ? { borderColor: "rgb(96,165,250)" } : null), ...(row ? null : { alignSelf: "flex-start" }), ...(drag?.key === `${path.join(".")}|${i}` ? { opacity: 0.35 } : null) }}>
              {nameOf(it)}
            </span>
          ))}
        </div>
      </div>
    );
  };

  const selFid = L.fieldIdOf(selected);
  const selStyle = selFid ? (layout.fieldStyles?.[selFid] || {}) : null;
  const cell = selFid ? occurrence.fields?.[selFid] : null;
  const setHideName = (on) => {
    const next = { ...(cell && typeof cell === "object" ? cell : { value: cell ?? null }), hideName: on };
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: occurrence.id, fields: { ...(occurrence.fields || {}), [selFid]: next } }, emit: true });
  };
  const row = { display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginTop: 6 };

  return (
    <div ref={rootRef} style={{ padding: "6px 12px" }} data-testid="instance-layout-editor">
      <LayoutDragOverlay drag={drag} chipStyle={chipBase} />
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Row layout</div>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>drag fields and boxes to arrange them · click a field to style it</span>
        {twins.length > 0 && (
          <button type="button" style={{ ...tiny, marginLeft: "auto" }} onClick={applyAll}
            title="Every other instance with this name and these fields gets this layout">Apply to all {twins.length}</button>
        )}
        <button type="button" style={{ ...tiny, ...(twins.length ? null : { marginLeft: "auto" }) }} onClick={() => write(null)}>Reset</button>
      </div>
      {hasCover && (
        <label style={row}>Cover
          <select value={layout.cover || "layout"} onChange={(e) => write(L.setCoverMode(layout, e.target.value))} style={{ fontSize: 13 }}>
            <option value="layout">In the layout</option>
            <option value="background">Behind the row</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
      )}
      <div style={{ marginTop: 4 }}>{renderGroup(layout.tree, [])}</div>
      {selFid && (
        <div style={{ marginTop: 6, padding: 6, border: "1px solid var(--border-default)", borderRadius: 6 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{nameOf(selected)}</div>
          <label style={row}><input type="checkbox" checked={!!cell?.hideName} onChange={(e) => setHideName(e.target.checked)} />Hide its name</label>
          <label style={row}><input type="checkbox" checked={!!selStyle.ownLine} onChange={(e) => write(L.setFieldStyle(layout, selFid, { ownLine: e.target.checked }))} />Own line</label>
          <label style={row}>Width
            <select value={selStyle.width || ""} onChange={(e) => write(L.setFieldStyle(layout, selFid, { width: e.target.value || null }))} style={{ fontSize: 13 }}>
              <option value="">Natural</option><option value="narrow">Narrow</option><option value="wide">Wide</option><option value="full">Full</option>
            </select>
          </label>
          <label style={row}>Size
            <select value={selStyle.size || ""} onChange={(e) => write(L.setFieldStyle(layout, selFid, { size: e.target.value || null }))} style={{ fontSize: 13 }}>
              <option value="">Normal</option><option value="sm">Small</option><option value="lg">Large</option>
            </select>
          </label>
          <label style={row}>Colour
            <input type="color" value={selStyle.color && selStyle.color.startsWith("#") ? selStyle.color : "#334155"}
              onChange={(e) => write(L.setFieldStyle(layout, selFid, { color: e.target.value }))} />
            {selStyle.color && <button type="button" style={tiny} onClick={() => write(L.setFieldStyle(layout, selFid, { color: null }))}>clear</button>}
          </label>
        </div>
      )}
    </div>
  );
}
