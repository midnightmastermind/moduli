import React, { useCallback, useEffect, useRef, useMemo } from "react";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from "lucide-react";

function RailButton({ direction, onClick, disabled }) {
  if (disabled) return null;
  return (
    <button
      className={`mobile-rail-btn mobile-rail-${direction}`}
      onClick={onClick}
      aria-label={`Navigate ${direction}`}
    >
      {direction === 'left' && <ChevronLeft size={14} />}
      {direction === 'right' && <ChevronRight size={14} />}
      {direction === 'up' && <ChevronUp size={14} />}
      {direction === 'down' && <ChevronDown size={14} />}
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

// --- Auto-scroll helpers ---

function findPanelForCell(panels, row, col) {
  if (!panels) return null;
  return panels.find(p =>
    row >= p.row && row < p.row + (p.height || 1) &&
    col >= p.col && col < p.col + (p.width || 1)
  ) || null;
}

function findScrollableAncestor(el, stopAt) {
  let node = el;
  while (node && node !== stopAt) {
    if (node.scrollHeight > node.clientHeight + 1) {
      // Verify this element actually scrolls (not overflow: visible/hidden)
      const ov = getComputedStyle(node).overflowY;
      if (ov === 'auto' || ov === 'scroll' || ov === 'overlay') return node;
    }
    node = node.parentElement;
  }
  return null;
}

function isAtScrollBoundary(el, direction) {
  if (!el) return true; // no scrollable content = always at boundary
  const threshold = 5;
  if (direction === 'down') return el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
  if (direction === 'up') return el.scrollTop <= threshold;
  if (direction === 'right') return el.scrollLeft + el.clientWidth >= el.scrollWidth - threshold;
  if (direction === 'left') return el.scrollLeft <= threshold;
  return false;
}

const OVERSCROLL_THRESHOLD = 60;
const NAVIGATE_COOLDOWN = 400;

export default function MobileGridNav({
  children,
  rows,
  cols,
  activeCell,
  setActiveCell,
  isMobileLayout,
  zoomedOut,
  setZoomedOut,
  visiblePanels = [],
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
      // Dismiss mobile keyboard before navigating — prevents viewport dimension bugs
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
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

  // --- Auto-scroll: detect overscroll at content boundaries → navigate to next cell ---
  const touchRef = useRef({ startY: 0, startX: 0, lastY: 0, lastX: 0, delta: 0, axis: null, touchTarget: null, panelEl: null });
  const cooldownRef = useRef(false);
  // Stable ref for activeCell so the touch handler always sees the latest value
  const activeCellRef = useRef(activeCell);
  activeCellRef.current = activeCell;
  // Stable ref for visiblePanels so the touch handler can check panel bounds
  const visiblePanelsRef = useRef(visiblePanels);
  visiblePanelsRef.current = visiblePanels;

  useEffect(() => {
    if (!isMobileLayout || zoomedOut) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onTouchStart = (e) => {
      const touch = e.touches[0];
      const panelEl = e.target.closest?.('[data-panel-id]');

      touchRef.current = {
        startY: touch.clientY,
        startX: touch.clientX,
        lastY: touch.clientY,
        lastX: touch.clientX,
        delta: 0,
        boundaryY: 0,
        boundaryX: 0,
        axis: null,
        touchTarget: e.target,
        panelEl,
        atBoundary: false,
      };
    };

    const onTouchMove = (e) => {
      if (cooldownRef.current) return;
      const t = touchRef.current;

      const touch = e.touches[0];
      const dy = touch.clientY - t.startY;
      const dx = touch.clientX - t.startX;

      // Re-find scrollable ancestor each move — keyboard show/hide changes dimensions
      const scrollEl = findScrollableAncestor(t.touchTarget || e.target, viewport);

      // Determine dominant axis on first significant move
      if (!t.axis && (Math.abs(dy) > 10 || Math.abs(dx) > 10)) {
        t.axis = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
      }
      if (!t.axis) { t.lastY = touch.clientY; t.lastX = touch.clientX; return; }

      const cell = activeCellRef.current;
      // Only allow auto-navigation within multi-cell panels (2+ rows/cols)
      const panel = findPanelForCell(visiblePanelsRef.current, cell.row, cell.col);

      if (t.axis === 'vertical') {
        const direction = dy < 0 ? 'down' : 'up';
        const panelHeight = panel ? (panel.height || 1) : 1;
        const targetRow = direction === 'down' ? cell.row + 1 : cell.row - 1;

        // Allow nav if: (1) target cell is within the same panel bounds, OR (2) panel is single-row
        const targetWithinPanel = panel &&
          targetRow >= panel.row &&
          targetRow < panel.row + panelHeight &&
          targetRow >= 0 && targetRow < rows;
        const panelIsSingleRow = panelHeight === 1;
        const canNav = targetWithinPanel || panelIsSingleRow;

        const atBound = isAtScrollBoundary(scrollEl, direction);

        if (canNav && atBound) {
          // Mark where we first hit the boundary
          if (!t.atBoundary) {
            t.atBoundary = true;
            t.boundaryY = touch.clientY;
          }
          // Total distance swiped past boundary
          const overDist = Math.abs(touch.clientY - t.boundaryY);

          if (overDist > OVERSCROLL_THRESHOLD) {
            const dRow = direction === 'down' ? 1 : -1;
            navigate(dRow, 0);

            cooldownRef.current = true;
            setTimeout(() => { cooldownRef.current = false; }, NAVIGATE_COOLDOWN);
            t.delta = 0;
            t.startY = touch.clientY;
            t.startX = touch.clientX;
            t.boundaryY = 0;
            t.boundaryX = 0;
            t.axis = null;
            t.atBoundary = false;
          }
        } else {
          t.atBoundary = false;
          t.delta = 0;
        }
      } else {
        // Horizontal
        const direction = dx < 0 ? 'right' : 'left';
        const panelWidth = panel ? (panel.width || 1) : 1;
        const targetCol = direction === 'right' ? cell.col + 1 : cell.col - 1;

        // Allow nav if: (1) target cell is within the same panel bounds, OR (2) panel is single-col
        const targetWithinPanel = panel &&
          targetCol >= panel.col &&
          targetCol < panel.col + panelWidth &&
          targetCol >= 0 && targetCol < cols;
        const panelIsSingleCol = panelWidth === 1;
        const canNav = targetWithinPanel || panelIsSingleCol;

        const atBound = isAtScrollBoundary(scrollEl, direction);

        if (canNav && atBound) {
          if (!t.atBoundary) {
            t.atBoundary = true;
            t.boundaryX = touch.clientX;
          }
          const overDist = Math.abs(touch.clientX - t.boundaryX);

          if (overDist > OVERSCROLL_THRESHOLD) {
            const dCol = direction === 'right' ? 1 : -1;
            navigate(0, dCol);

            cooldownRef.current = true;
            setTimeout(() => { cooldownRef.current = false; }, NAVIGATE_COOLDOWN);
            t.delta = 0;
            t.startY = touch.clientY;
            t.startX = touch.clientX;
            t.boundaryY = 0;
            t.boundaryX = 0;
            t.axis = null;
            t.atBoundary = false;
          }
        } else {
          t.atBoundary = false;
          t.delta = 0;
        }
      }

      t.lastY = touch.clientY;
      t.lastX = touch.clientX;
    };

    const onTouchEnd = () => {
      touchRef.current = { startY: 0, startX: 0, lastY: 0, lastX: 0, delta: 0, boundaryY: 0, boundaryX: 0, axis: null, touchTarget: null, panelEl: null, atBoundary: false };
    };

    // Reset touch state on viewport resize (keyboard show/hide) so boundary tracking stays fresh
    const onResize = () => {
      touchRef.current = { startY: 0, startX: 0, lastY: 0, lastX: 0, delta: 0, boundaryY: 0, boundaryX: 0, axis: null, touchTarget: null, panelEl: null, atBoundary: false };
      cooldownRef.current = false;
    };

    viewport.addEventListener('touchstart', onTouchStart, { passive: true });
    viewport.addEventListener('touchmove', onTouchMove, { passive: true });
    viewport.addEventListener('touchend', onTouchEnd, { passive: true });
    window.visualViewport?.addEventListener('resize', onResize);

    return () => {
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('touchend', onTouchEnd);
      window.visualViewport?.removeEventListener('resize', onResize);
    };
  }, [isMobileLayout, zoomedOut, rows, cols, navigate]);

  // Desktop passthrough — zero overhead
  if (!isMobileLayout) return children;

  const { row, col } = activeCell;

  // Boundary hints for multi-cell panels
  const currentPanel = findPanelForCell(visiblePanels, row, col);
  const panelHeight = currentPanel ? (currentPanel.height || 1) : 1;
  const panelWidth = currentPanel ? (currentPanel.width || 1) : 1;

  const hasLeft = col > 0;
  const hasRight = col < cols - 1;
  // Hide up/down buttons when panel spans 2+ rows (only scroll, don't nav)
  const hasUp = row > 0 && panelHeight < 2;
  const hasDown = row < rows - 1 && panelHeight < 2;

  const hasMoreDown = currentPanel && (currentPanel.row + panelHeight > row + 1);
  const hasMoreUp = currentPanel && (currentPanel.row < row);
  const hasMoreRight = currentPanel && (currentPanel.col + panelWidth > col + 1);
  const hasMoreLeft = currentPanel && (currentPanel.col < col);

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

      {/* Rail buttons — full-length edge overlays, inset from OS gesture zones */}
      {!zoomedOut && <RailButton direction="left" onClick={() => navigate(0, -1)} disabled={!hasLeft} />}
      {!zoomedOut && <RailButton direction="right" onClick={() => navigate(0, 1)} disabled={!hasRight} />}
      {!zoomedOut && <RailButton direction="up" onClick={() => navigate(-1, 0)} disabled={!hasUp} />}
      {!zoomedOut && <RailButton direction="down" onClick={() => navigate(1, 0)} disabled={!hasDown} />}

      {/* Boundary hints — gradient showing more content in adjacent cell */}
      {!zoomedOut && hasMoreDown && <div className="boundary-hint boundary-hint-down" />}
      {!zoomedOut && hasMoreUp && <div className="boundary-hint boundary-hint-up" />}
      {!zoomedOut && hasMoreRight && <div className="boundary-hint boundary-hint-right" />}
      {!zoomedOut && hasMoreLeft && <div className="boundary-hint boundary-hint-left" />}

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
