import React from "react";

const CELL_SIZE = 12;
const GAP = 2;

// `onMapClick`  — legacy whole-svg click (mobile toolbar zoom toggle).
// `onCellClick(row,col)` — per-cell selection (e.g. the assistant panel picker).
//   When set, only cells where `enabledCell(row,col)` is truthy are clickable
//   and brightly rendered; disabled cells are dimmed. `cellSize` scales it up.
export default function MiniGridMap({
  rows, cols, activeRow, activeCol, onMapClick,
  onCellClick = null, enabledCell = null, cellSize = CELL_SIZE,
}) {
  if (rows <= 1 && cols <= 1 && !onCellClick) return null;

  const SZ = cellSize;
  const w = cols * SZ + (cols - 1) * GAP;
  const h = rows * SZ + (rows - 1) * GAP;

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isActive = r === activeRow && c === activeCol;
      const enabled = onCellClick ? (enabledCell ? !!enabledCell(r, c) : true) : false;
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={c * (SZ + GAP)}
          y={r * (SZ + GAP)}
          width={SZ}
          height={SZ}
          rx={2}
          fill={isActive ? "var(--accent-blue)" : (onCellClick && !enabled ? "rgba(255,255,255,0.03)" : "var(--input-bg)")}
          stroke={isActive ? "var(--accent-blue-border)" : "var(--border-subtle)"}
          strokeWidth={1}
          style={{ cursor: enabled ? "pointer" : (onCellClick ? "not-allowed" : "inherit") }}
          onClick={enabled ? (e) => { e.stopPropagation(); onCellClick(r, c); } : undefined}
        />
      );
    }
  }

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ flexShrink: 0, cursor: onCellClick ? "default" : "pointer" }}
      aria-label="Grid map"
      onClick={onMapClick}
    >
      {cells}
    </svg>
  );
}
