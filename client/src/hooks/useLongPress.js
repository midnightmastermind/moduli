import { useRef, useCallback } from "react";

// Fires onLongPress({x,y}) after the finger is held `delayMs` without moving
// beyond `moveTolerance` px. Used to open the same context menu on touch that
// right-click opens on desktop (native long-press → contextmenu is unreliable
// across tablets, so we detect it ourselves).
export function useLongPress(onLongPress, { delayMs = 450, moveTolerance = 10 } = {}) {
  // Touch context menu DISABLED (user 2026-07-17: "hide right click menu on
  // touch"). Right-click still opens it on desktop via onContextMenu; long-press
  // no longer does on touch. Re-enable by removing this early return.
  const DISABLED = true;

  const timer = useRef(null);
  const start = useRef({ x: 0, y: 0 });

  const clear = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  const onTouchStart = useCallback((e) => {
    if (!e.touches || e.touches.length !== 1) return;
    // Don't arm on drag handles or interactive controls — those own the touch
    // (drag, radial menu, inputs). Long-press is for the plain body only.
    if (e.target?.closest?.("[data-dnd-handle], button, a, input, textarea, select, [contenteditable='true']")) return;
    const t = e.touches[0];
    start.current = { x: t.clientX, y: t.clientY };
    clear();
    timer.current = setTimeout(() => {
      timer.current = null;
      onLongPress({ x: start.current.x, y: start.current.y });
    }, delayMs);
  }, [onLongPress, delayMs, clear]);

  const onTouchMove = useCallback((e) => {
    if (!timer.current || !e.touches || !e.touches.length) return;
    const t = e.touches[0];
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    if (dx * dx + dy * dy > moveTolerance * moveTolerance) clear();
  }, [moveTolerance, clear]);

  if (DISABLED) return {};
  return { onTouchStart, onTouchMove, onTouchEnd: clear, onTouchCancel: clear };
}
