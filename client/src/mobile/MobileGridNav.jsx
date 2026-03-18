import React, { useCallback, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from "lucide-react";

function LipButton({ direction, onClick }) {
  const icons = {
    left: <ChevronLeft size={10} />,
    right: <ChevronRight size={10} />,
    up: <ChevronUp size={10} />,
    down: <ChevronDown size={10} />,
  };
  return (
    <button
      className={`mobile-lip-btn mobile-lip-btn-${direction}`}
      onClick={onClick}
      aria-label={`Navigate ${direction}`}
    >
      {icons[direction]}
    </button>
  );
}

function CellOverlay({ rows, cols, activeCell, onSelect }) {
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const isActive = r === activeCell.row && c === activeCell.col;
      cells.push(
        <div
          key={`${r}-${c}`}
          className={`zoom-cell${isActive ? " zoom-cell-active" : ""}`}
          onClick={() => onSelect({ row: r, col: c })}
          style={{ gridRow: r + 1, gridColumn: c + 1 }}
        />
      );
    }
  }
  return (
    <div
      className="zoom-overlay"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
    >
      {cells}
    </div>
  );
}

export default function MobileGridNav({
  children,
  rows,
  cols,
  activeCell,
  setActiveCell,
  isMobile,
  zoomedOut,
  setZoomedOut,
}) {
  const sliderRef = useRef(null);
  const viewportRef = useRef(null);

  const triggerAnimation = useCallback(() => {
    const el = sliderRef.current;
    if (!el) return;
    el.classList.add("animating");
    const onEnd = () => {
      el.classList.remove("animating");
      el.removeEventListener("transitionend", onEnd);
    };
    el.addEventListener("transitionend", onEnd);
  }, []);

  const navigate = useCallback(
    (dRow, dCol) => {
      setActiveCell((prev) => {
        const row = Math.max(0, Math.min(rows - 1, prev.row + dRow));
        const col = Math.max(0, Math.min(cols - 1, prev.col + dCol));
        if (row === prev.row && col === prev.col) return prev;
        return { row, col };
      });
      triggerAnimation();
    },
    [rows, cols, setActiveCell, triggerAnimation]
  );

  // Animate on zoomedOut toggle (zoom-out triggered from toolbar)
  useEffect(() => {
    triggerAnimation();
  }, [zoomedOut, triggerAnimation]);

  const handleCellSelect = useCallback(
    (cell) => {
      setActiveCell(cell);
      setZoomedOut(false);
      // Animation triggered by useEffect on zoomedOut change
    },
    [setActiveCell, setZoomedOut]
  );

  // Desktop passthrough — zero overhead
  if (!isMobile) return children;

  const { row, col } = activeCell;

  const hasLeft = col > 0;
  const hasRight = col < cols - 1;
  const hasUp = row > 0;
  const hasDown = row < rows - 1;

  // Zoomed-in: translate to show active cell
  // Zoomed-out: scale entire grid to fit viewport
  const transform = zoomedOut
    ? `scale(${1 / cols}, ${1 / rows})`
    : `translate(${-(col * (100 / cols))}%, ${-(row * (100 / rows))}%)`;

  return (
    <div className="mobile-grid-viewport" ref={viewportRef}>
      <div
        ref={sliderRef}
        className={`mobile-grid-slider${zoomedOut ? " zoomed-out" : ""}`}
        style={{
          width: `${cols * 100}%`,
          height: `${rows * 100}%`,
          transform,
          transformOrigin: "0 0",
        }}
      >
        {children}
      </div>

      {/* Lip buttons — hidden when zoomed out */}
      {!zoomedOut && hasLeft && <LipButton direction="left" onClick={() => navigate(0, -1)} />}
      {!zoomedOut && hasRight && <LipButton direction="right" onClick={() => navigate(0, 1)} />}
      {!zoomedOut && hasUp && <LipButton direction="up" onClick={() => navigate(-1, 0)} />}
      {!zoomedOut && hasDown && <LipButton direction="down" onClick={() => navigate(1, 0)} />}

      {/* Zoomed-out cell selection overlay */}
      {zoomedOut && (
        <CellOverlay
          rows={rows}
          cols={cols}
          activeCell={activeCell}
          onSelect={handleCellSelect}
        />
      )}
    </div>
  );
}
