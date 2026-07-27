import React, { useCallback, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ArrowUpLeft, ArrowUpRight, ArrowDownLeft, ArrowDownRight } from "lucide-react";

const RAIL_ICON = {
  left: ChevronLeft, right: ChevronRight, up: ChevronUp, down: ChevronDown,
  'up-left': ArrowUpLeft, 'up-right': ArrowUpRight, 'down-left': ArrowDownLeft, 'down-right': ArrowDownRight,
};

// Tap slop for the pointerup fire below: past this the press was a swipe/scroll
// that started on the rail, not a tap on it.
const RAIL_TAP_SLOP = 12;

function RailButton({ direction, onClick, disabled, label }) {
  // Fire on pointerup rather than click: click is synthesized after the browser
  // finishes its own tap processing, which is dead time the user reads as lag.
  // (Declared above the disabled early-return — `disabled` toggles per cell.)
  const press = useRef({ x: 0, y: 0, firedAt: 0 });
  if (disabled) return null;
  const Icon = RAIL_ICON[direction];
  const isSide = direction === 'left' || direction === 'right';
  const isDiag = direction.includes('-');
  const onPointerDown = (e) => { press.current.x = e.clientX; press.current.y = e.clientY; };
  const onPointerUp = (e) => {
    if (Math.abs(e.clientX - press.current.x) > RAIL_TAP_SLOP ||
        Math.abs(e.clientY - press.current.y) > RAIL_TAP_SLOP) return;
    press.current.firedAt = Date.now();
    onClick?.(e);
  };
  // The click that follows our own pointerup is the same tap — drop it. A click
  // with no pointerup (keyboard Enter/Space) still navigates.
  const handleClick = (e) => {
    if (Date.now() - press.current.firedAt < 700) return;
    onClick?.(e);
  };
  return (
    <button
      className={`mobile-rail-btn mobile-rail-${direction}`}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClick={handleClick}
      aria-label={`Navigate ${direction}${label ? ` to ${label}` : ''}`}
      title={isDiag ? (label || undefined) : undefined}
    >
      <Icon size={16} />
      {label && !isDiag ? (
        <span className={`mobile-rail-label${isSide ? ' mobile-rail-label--v' : ''}`}>{label}</span>
      ) : null}
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

// --- Multicell panel native scroll (2026-07-24) ---
// A panel spanning 2+ rows/cols is ONE panel whose content is several screens
// worth. Instead of cell-snapping inside it, the viewport becomes a real
// native scroller clamped to the panel's row/col range — continuous scroll
// with momentum through the whole panel. Cell-snap nav survives only for
// crossing to a DIFFERENT panel. The slider transform anchors to the panel's
// ORIGIN cell while inside it; scrollTop/scrollLeft carry the within-panel
// position, and activeCell silently tracks the nearest sub-cell (rails,
// persistence, drag-edge nav all keep working off it).

// `content` (optional) = { height, width } of the scroller's actual content
// (viewport.scrollHeight / scrollWidth). The cell span is a FLOOR, not a cap:
// a 2-high panel is guaranteed at least one extra viewport of scroll so you can
// cross its cells, but a panel whose content is TALLER than its cells (the
// Schedule's 48 timeslots in a 2-high panel) must still scroll all the way to
// the end. Capping at the cell span stranded everything past ~9:30pm
// (2026-07-25, per user: "id like the viewport to handle the full height").
export function panelScrollMax(panel, viewportW, viewportH, content = null) {
  const h = panel?.height || 1;
  const w = panel?.width || 1;
  const spanTop = Math.max(0, (h - 1) * viewportH);
  const spanLeft = Math.max(0, (w - 1) * viewportW);
  const contentTop = content?.height ? Math.max(0, content.height - viewportH) : 0;
  const contentLeft = content?.width ? Math.max(0, content.width - viewportW) : 0;
  return {
    maxTop: Math.max(spanTop, contentTop),
    maxLeft: Math.max(spanLeft, contentLeft),
  };
}

// The sub-cell (absolute row/col) the viewport scroll is closest to.
export function nearestSubCell(panel, scrollTop, scrollLeft, viewportW, viewportH) {
  const h = panel?.height || 1;
  const w = panel?.width || 1;
  const r = Math.max(0, Math.min(h - 1, Math.round(scrollTop / Math.max(1, viewportH))));
  const c = Math.max(0, Math.min(w - 1, Math.round(scrollLeft / Math.max(1, viewportW))));
  return { row: (panel?.row || 0) + r, col: (panel?.col || 0) + c };
}

// Has the viewport's clamped native scroll reached the panel's true edge in
// this direction? (Gate for overscroll-to-navigate OUT of a multicell panel.)
export function isViewportAtPanelEnd(viewport, panel, direction) {
  if (!viewport) return true;
  const { maxTop, maxLeft } = panelScrollMax(panel, viewport.clientWidth, viewport.clientHeight,
    { height: viewport.scrollHeight, width: viewport.scrollWidth });
  const threshold = 5;
  if (direction === 'down') return viewport.scrollTop >= maxTop - threshold;
  if (direction === 'up') return viewport.scrollTop <= threshold;
  if (direction === 'right') return viewport.scrollLeft >= maxLeft - threshold;
  if (direction === 'left') return viewport.scrollLeft <= threshold;
  return true;
}

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
  panelLabelResolver = null,
}) {
  const sliderRef = useRef(null);
  const viewportRef = useRef(null);

  // Stable ref for activeCell so the touch handler always sees the latest value
  const activeCellRef = useRef(activeCell);
  // Stable ref for visiblePanels so the touch handler can check panel bounds
  const visiblePanelsRef = useRef(visiblePanels);
  visiblePanelsRef.current = visiblePanels;

  // activeCell lives in App state, so a rail tap re-renders the whole grid
  // before the transform moves — on a phone that reads as a lag between the tap
  // and the cell switch. The tap now paints the target transform IMMEDIATELY
  // (imperatively, in its own frame) and holds the target here until the state
  // catches up, so the render that follows agrees instead of snapping back.
  // (Compared BY VALUE — MosaicMobileNav passes a fresh {row,col} each render.)
  const pendingCellRef = useRef(null);
  const lastSeenCellRef = useRef(activeCell);
  const seenCell = lastSeenCellRef.current;
  const stateMoved = seenCell.row !== activeCell.row || seenCell.col !== activeCell.col;
  lastSeenCellRef.current = activeCell;
  if (pendingCellRef.current && (stateMoved ||
      (pendingCellRef.current.row === activeCell.row && pendingCellRef.current.col === activeCell.col))) {
    // The state either reached our target or moved somewhere else of its own
    // accord — either way it is the truth again.
    pendingCellRef.current = null;
  }
  const cell = pendingCellRef.current || activeCell;
  activeCellRef.current = cell;

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

  // The same transform the render computes — see the anchor note down there.
  const cellTransform = useCallback(
    (row, col) => {
      const panel = findPanelForCell(visiblePanelsRef.current, row, col);
      const anchorRow = panel && (panel.height || 1) >= 2 ? panel.row : row;
      const anchorCol = panel && (panel.width || 1) >= 2 ? panel.col : col;
      return `translate(${-(anchorCol * (100 / cols))}%, ${-(anchorRow * (100 / rows))}%)`;
    },
    [rows, cols]
  );

  const navigate = useCallback(
    (dRow, dCol) => {
      // Dismiss mobile keyboard before navigating — prevents viewport dimension bugs
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
      const prev = activeCellRef.current;
      const row = Math.max(0, Math.min(rows - 1, prev.row + dRow));
      const col = Math.max(0, Math.min(cols - 1, prev.col + dCol));
      if (row === prev.row && col === prev.col) return;
      const next = { row, col };
      pendingCellRef.current = next;
      activeCellRef.current = next;
      triggerAnimation();
      // Move NOW; the React commit lands on the same transform a frame or two later.
      if (sliderRef.current && !zoomedOut) sliderRef.current.style.transform = cellTransform(row, col);
      setActiveCell(next);
    },
    [rows, cols, setActiveCell, triggerAnimation, cellTransform, zoomedOut]
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

  // Panel the active cell sits in (hoisted above the effects — the native
  // panel-scroll wiring keys off it). height/width ≥ 2 → continuous scroll.
  const currentPanel = findPanelForCell(visiblePanels, cell.row, cell.col);
  const panelHeightSpan = currentPanel ? (currentPanel.height || 1) : 1;
  const panelWidthSpan = currentPanel ? (currentPanel.width || 1) : 1;
  const panelScrollV = panelHeightSpan >= 2;
  const panelScrollH = panelWidthSpan >= 2;
  // Identity of the ACTIVE PANEL (not the sub-cell) — the scroll effect must
  // re-run when you enter a different panel, not when scroll-sync nudges
  // activeCell between sub-cells of the same panel.
  const panelKey = currentPanel
    ? `${currentPanel.row}:${currentPanel.col}:${panelHeightSpan}:${panelWidthSpan}`
    : null;

  // --- Native panel scroll: overflow entry positioning, clamp, silent sync ---
  const scrollSyncRafRef = useRef(0);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !isMobileLayout) return;
    const active = !zoomedOut && (panelScrollV || panelScrollH);
    if (!active) {
      viewport.scrollTop = 0;
      viewport.scrollLeft = 0;
      delete viewport.dataset.scrollMaxTop;
      delete viewport.dataset.scrollMaxLeft;
      delete viewport.dataset.panelNativeScroll;
      return;
    }
    // Marks the mode for CSS: the page scrollers INSIDE the panel must be
    // allowed to chain their overscroll into this viewport (see index.css).
    viewport.dataset.panelNativeScroll = "1";
    const cell = activeCellRef.current;
    const panel = findPanelForCell(visiblePanelsRef.current, cell.row, cell.col);
    if (!panel) return;
    // Land on the active sub-cell when ENTERING the panel (rail nav lands you
    // on the near edge; zoom-out select lands you on the picked sub-cell).
    viewport.scrollTop = panelScrollV ? (cell.row - panel.row) * viewport.clientHeight : 0;
    viewport.scrollLeft = panelScrollH ? (cell.col - panel.col) * viewport.clientWidth : 0;
    // Publish the clamp caps — DragProvider's drag autoscroll reads
    // data-scroll-max-top so it doesn't fight the clamp at the panel edge.
    const stampCaps = () => {
      const { maxTop, maxLeft } = panelScrollMax(panel, viewport.clientWidth, viewport.clientHeight,
        { height: viewport.scrollHeight, width: viewport.scrollWidth });
      viewport.dataset.scrollMaxTop = String(maxTop);
      viewport.dataset.scrollMaxLeft = String(maxLeft);
      return { maxTop, maxLeft };
    };
    stampCaps();
    const onScroll = () => {
      // Clamp the native scroll to the panel's own row/col range — the slider
      // continues below/right of the panel (other panels' cells), which must
      // stay reachable only via cell-snap nav, never by this scroll.
      const { maxTop, maxLeft } = stampCaps();
      if (viewport.scrollTop > maxTop) viewport.scrollTop = maxTop;
      if (viewport.scrollLeft > maxLeft) viewport.scrollLeft = maxLeft;
      if (scrollSyncRafRef.current) return;
      scrollSyncRafRef.current = requestAnimationFrame(() => {
        scrollSyncRafRef.current = 0;
        const cur = activeCellRef.current;
        const p = findPanelForCell(visiblePanelsRef.current, cur.row, cur.col);
        if (!p) return;
        const next = nearestSubCell(p, viewport.scrollTop, viewport.scrollLeft, viewport.clientWidth, viewport.clientHeight);
        // Silent sync — no navigate(), no animation class: the transform is
        // anchored to the panel ORIGIN while inside it, so this never moves
        // anything visually; it just keeps rails/persistence/drag-nav honest.
        if (next.row !== cur.row || next.col !== cur.col) setActiveCell(next);
      });
    };
    viewport.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      viewport.removeEventListener('scroll', onScroll);
      delete viewport.dataset.panelNativeScroll;
      if (scrollSyncRafRef.current) {
        cancelAnimationFrame(scrollSyncRafRef.current);
        scrollSyncRafRef.current = 0;
      }
    };
  }, [isMobileLayout, zoomedOut, panelKey, panelScrollV, panelScrollH, setActiveCell]);

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
        scrollEl: undefined,
      };
    };

    const onTouchMove = (e) => {
      if (cooldownRef.current) return;
      // Skip overscroll-to-navigate while an occurrence DRAG is in progress —
      // DragProvider's drag-to-edge nav owns cell switching then, and this
      // handler was reading a drag toward the middle as an OPPOSITE overscroll
      // and snapping the view back to the previous panel (user 2026-07-17).
      if (typeof document !== "undefined" && document.body?.dataset?.dragKind) return;
      const t = touchRef.current;

      const touch = e.touches[0];
      const dy = touch.clientY - t.startY;
      const dx = touch.clientX - t.startX;

      // Resolve the scrollable ancestor ONCE per gesture (getComputedStyle walk
      // — too hot for every touchmove). Keyboard show/hide correctness is kept
      // by the visualViewport resize handler below, which resets the touch
      // state (including this cache) when dimensions change.
      if (t.scrollEl === undefined) t.scrollEl = findScrollableAncestor(t.touchTarget || e.target, viewport);
      const scrollEl = t.scrollEl;

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

        // Multicell panels scroll NATIVELY within their own rows (the
        // panel-scroll effect owns that) — overscroll-nav only CROSSES the
        // panel edge. Single-row panels keep the plain cell-snap nav.
        const targetOutsidePanel = !panel ||
          targetRow < panel.row || targetRow >= panel.row + panelHeight;
        const targetValid = targetRow >= 0 && targetRow < rows;
        const canNav = targetValid && (panelHeight === 1 || targetOutsidePanel);

        const atBound = isAtScrollBoundary(scrollEl, direction) &&
          (panelHeight === 1 || isViewportAtPanelEnd(viewport, panel, direction));

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

        // Same crossing-only rule as the vertical branch: native viewport
        // scroll owns within-panel movement for 2+-col panels.
        const targetOutsidePanel = !panel ||
          targetCol < panel.col || targetCol >= panel.col + panelWidth;
        const targetValid = targetCol >= 0 && targetCol < cols;
        const canNav = targetValid && (panelWidth === 1 || targetOutsidePanel);

        const atBound = isAtScrollBoundary(scrollEl, direction) &&
          (panelWidth === 1 || isViewportAtPanelEnd(viewport, panel, direction));

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
      touchRef.current = { startY: 0, startX: 0, lastY: 0, lastX: 0, delta: 0, boundaryY: 0, boundaryX: 0, axis: null, touchTarget: null, panelEl: null, atBoundary: false, scrollEl: undefined };
    };

    // Reset touch state on viewport resize (keyboard show/hide) so boundary tracking stays fresh
    const onResize = () => {
      touchRef.current = { startY: 0, startX: 0, lastY: 0, lastX: 0, delta: 0, boundaryY: 0, boundaryX: 0, axis: null, touchTarget: null, panelEl: null, atBoundary: false, scrollEl: undefined };
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

  const { row, col } = cell;

  // Boundary hints for multi-cell panels (panel itself hoisted above the effects)
  const panelHeight = panelHeightSpan;
  const panelWidth = panelWidthSpan;

  // Rails inside a multicell panel: within-panel movement is the native
  // scroll now, so the arrows only show at the panel's EDGE sub-cells, where
  // they cross into the neighboring panel.
  const hasLeft = col > 0 && (panelWidth < 2 || col === currentPanel.col);
  const hasRight = col < cols - 1 && (panelWidth < 2 || col === currentPanel.col + panelWidth - 1);
  const hasUp = row > 0 && (panelHeight < 2 || row === currentPanel.row);
  const hasDown = row < rows - 1 && (panelHeight < 2 || row === currentPanel.row + panelHeight - 1);

  const hasMoreDown = currentPanel && (currentPanel.row + panelHeight > row + 1);
  const hasMoreUp = currentPanel && (currentPanel.row < row);
  const hasMoreRight = currentPanel && (currentPanel.col + panelWidth > col + 1);
  const hasMoreLeft = currentPanel && (currentPanel.col < col);

  // Name of the panel each rail leads to — written down the side button (user
  // 2026-07-17). Resolves the panel at the adjacent cell in that direction.
  const labelFor = (r, c) => {
    const p = findPanelForCell(visiblePanels, r, c);
    if (!p) return null;
    return (panelLabelResolver ? panelLabelResolver(p) : null) || p.label || null;
  };
  const leftLabel = hasLeft ? labelFor(row, col - 1) : null;
  const rightLabel = hasRight ? labelFor(row, col + 1) : null;
  const upLabel = hasUp ? labelFor(row - 1, col) : null;
  const downLabel = hasDown ? labelFor(row + 1, col) : null;

  // Diagonal nav: the corner where two rails overlap becomes a diagonal button,
  // shown only when a DIFFERENT panel actually sits in that diagonal cell (user
  // 2026-07-17). navigate(dRow, dCol) already handles both axes at once.
  const diagPanel = (dr, dc) => {
    const r = row + dr, c = col + dc;
    if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
    const p = findPanelForCell(visiblePanels, r, c);
    return p && p !== currentPanel ? p : null;
  };
  const ulP = diagPanel(-1, -1), urP = diagPanel(-1, 1), dlP = diagPanel(1, -1), drP = diagPanel(1, 1);

  // Zoomed-in: translate to show active cell. Inside a multicell panel the
  // translate anchors to the panel's ORIGIN cell — the within-panel position
  // is the viewport's own native scroll, so sub-cell activeCell changes never
  // move the transform (no snap).
  // Zoomed-out: scale entire grid to fit viewport
  const anchorRow = panelScrollV ? currentPanel.row : row;
  const anchorCol = panelScrollH ? currentPanel.col : col;
  const transform = zoomedOut
    ? `scale(${1 / cols}, ${1 / rows})`
    : `translate(${-(anchorCol * (100 / cols))}%, ${-(anchorRow * (100 / rows))}%)`;

  return (
    <div
      className="mobile-grid-viewport"
      ref={viewportRef}
      style={{
        overflowY: !zoomedOut && panelScrollV ? "auto" : "hidden",
        overflowX: !zoomedOut && panelScrollH ? "auto" : "hidden",
        overscrollBehavior: "contain",
      }}
    >
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
      {!zoomedOut && <RailButton direction="left" onClick={() => navigate(0, -1)} disabled={!hasLeft} label={leftLabel} />}
      {!zoomedOut && <RailButton direction="right" onClick={() => navigate(0, 1)} disabled={!hasRight} label={rightLabel} />}
      {!zoomedOut && <RailButton direction="up" onClick={() => navigate(-1, 0)} disabled={!hasUp} label={upLabel} />}
      {!zoomedOut && <RailButton direction="down" onClick={() => navigate(1, 0)} disabled={!hasDown} label={downLabel} />}
      {!zoomedOut && ulP && <RailButton direction="up-left" onClick={() => navigate(-1, -1)} label={labelFor(row - 1, col - 1)} />}
      {!zoomedOut && urP && <RailButton direction="up-right" onClick={() => navigate(-1, 1)} label={labelFor(row - 1, col + 1)} />}
      {!zoomedOut && dlP && <RailButton direction="down-left" onClick={() => navigate(1, -1)} label={labelFor(row + 1, col - 1)} />}
      {!zoomedOut && drP && <RailButton direction="down-right" onClick={() => navigate(1, 1)} label={labelFor(row + 1, col + 1)} />}

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
          activeCell={cell}
          onSelect={handleCellSelect}
        />
      )}
    </div>
  );
}
