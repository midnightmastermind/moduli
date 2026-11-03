// mobile/PanelPicker.jsx — the phone toolbar's one panel button.
//
// User, 2026-11-02: "the button for panel placement should just be one button that opens up a bigger dropdown
// of the stacked boxes of panels i can click on and switch to." The toolbar used to carry the small MiniGridMap
// (12px cells, a tap toggled the zoomed-out grid). Now one button opens a dropdown that draws the cells the
// phone pages through, each box named by the page its panel shows; tapping one moves to that cell.
//
// The shape and the panel in each cell come from activeCellStore.usePhoneShape (Grid publishes them on a phone),
// so the boxes are the cells the rails actually move through.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LayoutGrid } from "lucide-react";
import { useGridActions } from "../GridActionsContext";
import { useActiveCell, setActiveCell, usePhoneShape } from "../state/activeCellStore";

/** The name a panel box carries: the page its view shows, else the panel's own label. Pure. */
export function panelBoxLabel(cell, { occurrencesById = {}, modulesById = {}, viewsById = {} } = {}) {
  const occ = occurrencesById[cell.occId];
  const mod = modulesById[cell.moduleId] || (occ && modulesById[occ.moduleId]);
  const view = viewsById[occ?.viewId || mod?.viewId];
  const pageOcc = view?.activeOccurrenceId ? occurrencesById[view.activeOccurrenceId] : null;
  const pageMod = pageOcc ? modulesById[pageOcc.moduleId] : null;
  return pageOcc?.label || pageMod?.label || occ?.label || mod?.label || "Panel";
}

/** The cell a tap on a box should move to (its top-left), and whether the active cell is inside it. Pure. */
export function cellContains(cell, row, col) {
  return row >= cell.row && row < cell.row + (cell.height || 1) && col >= cell.col && col < cell.col + (cell.width || 1);
}

export default function PanelPicker({ gridRows = 1, gridCols = 1 }) {
  const shape = usePhoneShape();
  const active = useActiveCell();
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const { getOccMap, getModMap, getViewMap } = useGridActions();

  const rows = shape?.rows ?? gridRows;
  const cols = shape?.cols ?? gridCols;
  const cells = shape?.cells || [];

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("pointerdown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  // Labels are read when the dropdown opens; the button itself subscribes to nothing but the shape.
  const labelled = useMemo(() => {
    if (!open) return [];
    const maps = { occurrencesById: getOccMap?.() || {}, modulesById: getModMap?.() || {}, viewsById: getViewMap?.() || {} };
    return cells.map((c) => ({ ...c, label: panelBoxLabel(c, maps) }));
  }, [open, cells, getOccMap, getModMap, getViewMap]);

  if (cells.length <= 1 && rows <= 1 && cols <= 1) return null;

  const rect = open && btnRef.current ? btnRef.current.getBoundingClientRect() : null;
  const vw = typeof window !== "undefined" ? window.innerWidth : 390;
  const width = Math.min(vw - 16, Math.max(220, cols * 140));

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="toolbar-panel-picker-btn"
        title="Switch panel"
        aria-label="Switch panel"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <LayoutGrid size={18} />
      </button>
      {open && rect && createPortal(
        <div
          ref={popRef}
          role="dialog"
          aria-label="Panels"
          className="toolbar-panel-picker"
          style={{
            position: "fixed",
            top: rect.bottom + 6,
            left: Math.max(8, Math.min(rect.left, vw - width - 8)),
            width,
            zIndex: 1105,
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gridTemplateRows: `repeat(${rows}, minmax(56px, auto))`,
            gap: 6,
          }}
        >
          {labelled.map((c) => {
            const isActive = cellContains(c, active?.row ?? 0, active?.col ?? 0);
            return (
              <button
                key={c.occId || `${c.row}:${c.col}`}
                type="button"
                className={`toolbar-panel-picker-box${isActive ? " is-active" : ""}`}
                style={{ gridRow: `${c.row + 1} / span ${c.height || 1}`, gridColumn: `${c.col + 1} / span ${c.width || 1}` }}
                onClick={() => { setActiveCell({ row: c.row, col: c.col }); setOpen(false); }}
              >
                {c.label}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
}
