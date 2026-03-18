import React from "react";

const CELL_SIZE = 12;
const GAP = 2;

export default function MiniGridMap({ rows, cols, activeRow, activeCol, onMapClick }) {
  if (rows <= 1 && cols <= 1) return null;

  const w = cols * CELL_SIZE + (cols - 1) * GAP;
  const h = rows * CELL_SIZE + (rows - 1) * GAP;

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isActive = r === activeRow && c === activeCol;
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={c * (CELL_SIZE + GAP)}
          y={r * (CELL_SIZE + GAP)}
          width={CELL_SIZE}
          height={CELL_SIZE}
          rx={2}
          fill={isActive ? "var(--accent-blue)" : "var(--input-bg)"}
          stroke={isActive ? "var(--accent-blue-border)" : "var(--border-subtle)"}
          strokeWidth={1}
        />
      );
    }
  }

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ flexShrink: 0, cursor: "pointer" }}
      aria-label="Grid map"
      onClick={onMapClick}
    >
      {cells}
    </svg>
  );
}
