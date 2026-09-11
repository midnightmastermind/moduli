// ui/SpreadTileMaximize.jsx
// ============================================================
// THE HEADER BUTTON THAT MAKES ONE VIEWER TILE FILL THE VIEWER.
//
// User, 2026-09-11: *"We need a button to expand the occurance in the viewer.
// put it on the headers of the occurances in the viewer. the goal is, i can make
// the browser here full screen when i want to when i have multiple files. all
// files and browsers in the viewer should have this."*
//
// Rendered by `ModuleInstance` in every tile's handle row, and renders NOTHING
// outside the viewer (or in its canvas arrangement) — the context is null there,
// so the ~1,000 rows on a board never grow a control they cannot use.
//
// It is its own component rather than inline JSX in `ModuleInstance` because
// that file is 1,700 lines and needs the whole grid store to mount, while this
// decision needs neither — so it is tested here, where the risk actually is.
// ============================================================
import React from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useSpreadMaximize } from "../helpers/spreadDock";

/** True when `occurrenceId` is the tile currently filling the viewer. */
export function useIsSpreadMaximized(occurrenceId) {
  const ctl = useSpreadMaximize();
  return !!ctl && !!occurrenceId && ctl.maxId === occurrenceId;
}

export default function SpreadTileMaximize({ occurrenceId }) {
  const ctl = useSpreadMaximize();
  if (!ctl || !occurrenceId) return null;
  const on = ctl.maxId === occurrenceId;
  const label = on ? "Back to the grid" : "Fill the viewer";
  return (
    <button
      type="button"
      className="spread-tile-maximize"
      aria-pressed={on}
      aria-label={label}
      title={on ? "Back to the grid (Esc)" : label}
      // The row owns selection and a drag; neither should start from here.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); ctl.toggle(occurrenceId); }}
    >
      {on
        ? <Minimize2 style={{ width: 13, height: 13 }} />
        : <Maximize2 style={{ width: 13, height: 13 }} />}
    </button>
  );
}
