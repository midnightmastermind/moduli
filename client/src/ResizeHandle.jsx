import { useRef, useCallback } from "react";

const ResizeHandle = ({ panel, cols, rows, onResize, onResizeEnd }) => {
  const startRef = useRef(null);

  const handleStart = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();

    const panelEl = e.target.closest('[data-panel-id]');
    const gridEl = panelEl?.closest('[style*="display: grid"]') || panelEl?.parentElement?.parentElement;

    if (!panelEl || !gridEl) return;

    const startX = e.clientX || e.touches?.[0]?.clientX;
    const startY = e.clientY || e.touches?.[0]?.clientY;

    const gridRect = gridEl.getBoundingClientRect();
    const cellWidth = gridRect.width / cols;
    const cellHeight = gridRect.height / rows;

    const startCellWidth = panel.width || 1;
    const startCellHeight = panel.height || 1;

    startRef.current = {
      startX,
      startY,
      cellWidth,
      cellHeight,
      startCellWidth,
      startCellHeight,
      panelRow: panel.row,
      panelCol: panel.col,
      lastWidth: startCellWidth,
      lastHeight: startCellHeight,
    };

    const handleMove = (moveEvent) => {
      if (!startRef.current) return;

      const clientX = moveEvent.clientX || moveEvent.touches?.[0]?.clientX;
      const clientY = moveEvent.clientY || moveEvent.touches?.[0]?.clientY;

      const deltaX = clientX - startRef.current.startX;
      const deltaY = clientY - startRef.current.startY;

      // Calculate cell span based on delta in pixels
      const cellDeltaX = Math.round(deltaX / startRef.current.cellWidth);
      const cellDeltaY = Math.round(deltaY / startRef.current.cellHeight);

      // Calculate new cell spans (min 1, max grid size - panel position)
      const newCellWidth = Math.max(1, Math.min(
        cols - startRef.current.panelCol,
        startRef.current.startCellWidth + cellDeltaX
      ));
      const newCellHeight = Math.max(1, Math.min(
        rows - startRef.current.panelRow,
        startRef.current.startCellHeight + cellDeltaY
      ));

      // Store the last calculated dimensions
      startRef.current.lastWidth = newCellWidth;
      startRef.current.lastHeight = newCellHeight;

      onResize?.({ width: newCellWidth, height: newCellHeight });
    };

    const handleEnd = () => {
      if (!startRef.current) return;

      // Use the last calculated dimensions from handleMove
      const finalCellWidth = startRef.current.lastWidth;
      const finalCellHeight = startRef.current.lastHeight;

      onResizeEnd?.({ width: finalCellWidth, height: finalCellHeight });

      startRef.current = null;

      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove);
    document.addEventListener('touchend', handleEnd);
  }, [panel, cols, rows, onResize, onResizeEnd]);

  return (
    <div
      onMouseDown={handleStart}
      onTouchStart={handleStart}
      style={{
        width: 18,
        height: 18,
        position: "absolute",
        right: 6,  // Account for panel margin
        bottom: 6,
        cursor: "nwse-resize",
        background: "rgba(100, 120, 150, 0.6)",
        borderTopLeftRadius: 6,
        touchAction: "none",
        zIndex: 9999,
        pointerEvents: "auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity: 0.7,
        transition: "opacity 0.15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; }}
      onMouseLeave={(e) => { e.currentTarget.style.opacity = 0.7; }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" style={{ opacity: 0.5 }}>
        <path d="M10 0 L10 10 L0 10 Z" fill="white" />
      </svg>
    </div>
  );
};

export default ResizeHandle;
