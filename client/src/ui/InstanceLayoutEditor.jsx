// ui/InstanceLayoutEditor.jsx
//
// The placement's ROW LAYOUT, in its Layout settings (user, 2026-10-15): the label,
// the cover and each field sit in nested boxes; each box lays its items out as
// columns (side by side) or rows (stacked), can wrap or not, and items are dragged
// between boxes. A field chip, clicked, opens its own styling: hide its name, width,
// size, colour, own line. Stored on `occurrence.meta.instanceLayout`
// (helpers/instanceLayout); a copy of the placement carries it.

import React, { useMemo, useState } from "react";
import { useGridActions } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import * as L from "../helpers/instanceLayout";

const box = { border: "1px dashed var(--border-default)", borderRadius: 6, padding: 4, display: "flex", gap: 4, minHeight: 26 };
const chipBase = { fontSize: 10, padding: "2px 6px", borderRadius: 999, border: "1px solid var(--border-default)", background: "var(--input-bg)", cursor: "grab", whiteSpace: "nowrap", userSelect: "none" };
const tiny = { fontSize: 9, padding: "0 4px", border: "1px solid var(--border-default)", borderRadius: 4, background: "transparent", color: "var(--text-muted)", cursor: "pointer" };

export default function InstanceLayoutEditor({ occurrence }) {
  const { dispatch, socket, modulesById, fieldsById } = useGridActions() || {};
  const module = occurrence?.moduleId ? modulesById?.[occurrence.moduleId] : null;
  const stored = occurrence?.meta?.instanceLayout || null;
  const [selected, setSelected] = useState(null);
  const [dragKey, setDragKey] = useState(null);

  const fieldIds = useMemo(() => (module?.fieldBindings || [])
    .filter((b) => b?.fieldId && fieldsById?.[b.fieldId] && !b.hidden && b.role !== "media" && b.role !== "files")
    .map((b) => b.fieldId), [module?.fieldBindings, fieldsById]);
  const hasCover = useMemo(() => (module?.fieldBindings || []).some((b) => b.role === "media" || b.role === "files"), [module?.fieldBindings]);
  const avail = useMemo(() => [L.LABEL, ...(hasCover ? [L.COVER] : []), ...fieldIds.map(L.fieldKey)], [fieldIds, hasCover]);

  const write = (next) => {
    const meta = { ...(occurrence.meta || {}) };
    if (next == null) delete meta.instanceLayout; else meta.instanceLayout = next;
    CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: { id: occurrence.id, meta }, emit: true });
  };

  if (!occurrence?.id) return null;
  if (!stored) {
    return (
      <div style={{ padding: "6px 12px" }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Row layout</div>
        <button type="button" style={{ ...tiny, fontSize: 10, padding: "2px 8px" }}
          onClick={() => write(L.defaultLayout(fieldIds, { hasCover }))}>Arrange this row…</button>
      </div>
    );
  }

  const layout = { ...stored, tree: L.resolveTree(stored, avail).tree };
  const nameOf = (key) => key === L.LABEL ? "Label" : key === L.COVER ? "Cover" : (fieldsById?.[L.fieldIdOf(key)]?.name || "Field");
  const drop = (path, index) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const key = dragKey || e.dataTransfer.getData("text/plain");
    setDragKey(null);
    if (key) write(L.moveItem(layout, key, path, index));
  };

  const renderGroup = (g, path) => {
    const row = g.dir === "row";
    return (
      <div key={path.join(".") || "root"} data-layout-path={path.join(".")} style={{ ...box, flexDirection: "column" }}
        onDragOver={(e) => e.preventDefault()} onDrop={drop(path, null)}>
        <div style={{ display: "flex", gap: 3, alignItems: "center" }}>
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
        <div style={{ display: "flex", flexDirection: row ? "row" : "column", flexWrap: row ? "wrap" : "nowrap", gap: 4, alignItems: row ? "flex-start" : "stretch" }}>
          {g.items.map((it, i) => typeof it === "object" ? renderGroup(it, [...path, i]) : (
            <span key={it} draggable data-layout-key={it}
              onDragStart={(e) => { setDragKey(it); e.dataTransfer.setData("text/plain", it); }}
              onDragOver={(e) => e.preventDefault()} onDrop={drop(path, i)}
              onClick={() => setSelected(selected === it ? null : it)}
              style={{ ...chipBase, ...(selected === it ? { borderColor: "rgb(96,165,250)" } : null) }}>
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
  const row = { display: "flex", alignItems: "center", gap: 6, fontSize: 10, marginTop: 4 };

  return (
    <div style={{ padding: "6px 12px" }} data-testid="instance-layout-editor">
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 600 }}>Row layout</div>
        <span style={{ fontSize: 9, color: "var(--text-muted)" }}>drag items between boxes</span>
        <button type="button" style={{ ...tiny, marginLeft: "auto" }} onClick={() => write(null)}>Reset</button>
      </div>
      {hasCover && (
        <label style={row}>Cover
          <select value={layout.cover || "layout"} onChange={(e) => write(L.setCoverMode(layout, e.target.value))} style={{ fontSize: 10 }}>
            <option value="layout">In the layout</option>
            <option value="background">Behind the row</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
      )}
      <div style={{ marginTop: 4 }}>{renderGroup(layout.tree, [])}</div>
      {selFid && (
        <div style={{ marginTop: 6, padding: 6, border: "1px solid var(--border-default)", borderRadius: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 600 }}>{nameOf(selected)}</div>
          <label style={row}><input type="checkbox" checked={!!cell?.hideName} onChange={(e) => setHideName(e.target.checked)} />Hide its name</label>
          <label style={row}><input type="checkbox" checked={!!selStyle.ownLine} onChange={(e) => write(L.setFieldStyle(layout, selFid, { ownLine: e.target.checked }))} />Own line</label>
          <label style={row}>Width
            <select value={selStyle.width || ""} onChange={(e) => write(L.setFieldStyle(layout, selFid, { width: e.target.value || null }))} style={{ fontSize: 10 }}>
              <option value="">Natural</option><option value="narrow">Narrow</option><option value="wide">Wide</option><option value="full">Full</option>
            </select>
          </label>
          <label style={row}>Size
            <select value={selStyle.size || ""} onChange={(e) => write(L.setFieldStyle(layout, selFid, { size: e.target.value || null }))} style={{ fontSize: 10 }}>
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
