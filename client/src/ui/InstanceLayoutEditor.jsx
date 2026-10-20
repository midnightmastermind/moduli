// ui/InstanceLayoutEditor.jsx
//
// The placement's ROW LAYOUT, in its Layout settings (user, 2026-10-15): the label,
// the cover and each field sit in nested boxes; each box lays its items out as
// columns (side by side) or rows (stacked), can wrap or not, and items and boxes are
// moved with ↑/↓ arrows (helpers/instanceLayout.stepItem) — drag-and-drop could not
// reach the top, and boxes could not be reordered at all (user, 2026-10-20). A field chip, clicked, opens its own styling: hide its name, width,
// size, colour, own line. Stored on `occurrence.meta.instanceLayout`
// (helpers/instanceLayout); a copy of the placement carries it.

import React, { useMemo, useState } from "react";
import { useGridActions } from "../GridActionsContext";
import * as CommitHelpers from "../helpers/CommitHelpers";
import * as L from "../helpers/instanceLayout";

const box = { border: "1px dashed var(--border-default)", borderRadius: 6, padding: 6, display: "flex", gap: 6, minHeight: 32 };
const chipBase = { fontSize: 13, padding: "3px 4px 3px 10px", borderRadius: 999, border: "1px solid var(--border-default)", background: "var(--input-bg)", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", display: "inline-flex", alignItems: "center", gap: 4 };
const tiny = { fontSize: 12, padding: "2px 7px", border: "1px solid var(--border-default)", borderRadius: 4, background: "transparent", color: "var(--text-muted)", cursor: "pointer" };
const arrow = { fontSize: 12, lineHeight: 1, padding: "2px 5px", border: "1px solid var(--border-default)", borderRadius: 4, background: "transparent", color: "var(--text-primary)", cursor: "pointer" };

export default function InstanceLayoutEditor({ occurrence }) {
  const { dispatch, socket, modulesById, fieldsById, occurrencesById } = useGridActions() || {};
  const module = occurrence?.moduleId ? modulesById?.[occurrence.moduleId] : null;
  const stored = occurrence?.meta?.instanceLayout || null;
  const [selected, setSelected] = useState(null);

  const fieldIds = useMemo(() => L.layoutFieldIds(module, fieldsById || {}), [module, fieldsById]);
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
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Row layout</div>
        <button type="button" style={{ ...tiny, fontSize: 13, padding: "4px 10px" }}
          onClick={() => write(L.defaultLayout(fieldIds, { hasCover }))}>Arrange this row…</button>
      </div>
    );
  }

  const layout = { ...stored, tree: L.resolveTree(stored, avail).tree };
  // Same name, same fields: every day's copy of this routine (often on its own cloned module).
  const twins = L.sameShapeTargets(occurrence, { occurrencesById: occurrencesById || {}, modulesById: modulesById || {}, fieldsById: fieldsById || {} });
  const applyAll = () => {
    const label = occurrence.label || module?.label || "row";
    if (!window.confirm(`Give all ${twins.length} other "${label}" instances with these fields this layout?`)) return;
    CommitHelpers.applyInstanceLayout({ dispatch, socket, layout: stored, occurrenceIds: twins, occurrencesById });
  };
  const nameOf = (key) => key === L.LABEL ? "Label" : key === L.COVER ? "Cover" : (fieldsById?.[L.fieldIdOf(key)]?.name || "Field");
  // ↑/↓ on an item (a field or a box) at `index` of the group at `path`.
  const step = (path, index, dir) => (e) => {
    e.stopPropagation();
    const next = L.stepItem(layout, path, index, dir);
    if (next !== layout) write(next);
  };
  const arrows = (path, index, label) => (
    <span style={{ display: "inline-flex", gap: 2 }}>
      <button type="button" style={arrow} title={`Move ${label} up`} aria-label={`Move ${label} up`} onClick={step(path, index, -1)}>↑</button>
      <button type="button" style={arrow} title={`Move ${label} down`} aria-label={`Move ${label} down`} onClick={step(path, index, +1)}>↓</button>
    </span>
  );

  const renderGroup = (g, path) => {
    const row = g.dir === "row";
    return (
      <div key={path.join(".") || "root"} data-layout-path={path.join(".")} style={{ ...box, flexDirection: "column" }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center", flexWrap: "wrap" }}>
          {path.length > 0 && arrows(path.slice(0, -1), path[path.length - 1], "this box")}
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
        <div style={{ display: "flex", flexDirection: row ? "row" : "column", flexWrap: row ? "wrap" : "nowrap", gap: 6, alignItems: row ? "flex-start" : "stretch" }}>
          {g.items.map((it, i) => typeof it === "object" ? renderGroup(it, [...path, i]) : (
            <span key={it} data-layout-key={it}
              onClick={() => setSelected(selected === it ? null : it)}
              style={{ ...chipBase, ...(selected === it ? { borderColor: "rgb(96,165,250)" } : null), ...(row ? null : { alignSelf: "flex-start" }) }}>
              {nameOf(it)}
              {arrows(path, i, nameOf(it))}
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
    <div style={{ padding: "6px 12px" }} data-testid="instance-layout-editor">
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>Row layout</div>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>↑/↓ move items in and out of boxes · click a field to style it</span>
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
