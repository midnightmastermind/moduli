// hooks/useDoubleTap.js — a double-click that a headset controller (or a finger) can hit.
//
// A browser counts two clicks as a double-click only when the second lands almost exactly where the first did. A
// controller's ray moves a little between two trigger presses, so renaming a page or container title took a couple of
// tries in the headset (user, 2026-10-26: "hitting a page or container title was finicky"). Two clicks within `ms` and
// `slop` px of each other count; a real dblclick still works the same (its second click is one of the two).
import { useCallback, useRef } from "react";

export const DOUBLE_TAP_MS = 500;
export const DOUBLE_TAP_SLOP = 30;

/** Is a click at (x, y, t) the second of a double tap after `last`? Pure. */
export function isSecondTap(last, x, y, t, ms = DOUBLE_TAP_MS, slop = DOUBLE_TAP_SLOP) {
  return !!last && t - last.t <= ms && Math.abs(x - last.x) <= slop && Math.abs(y - last.y) <= slop;
}

/** An onClick handler that calls `onDoubleTap(event)` on the second of two close clicks. */
export function useDoubleTap(onDoubleTap) {
  const last = useRef(null);
  return useCallback((e) => {
    const t = performance.now();
    if (isSecondTap(last.current, e.clientX, e.clientY, t)) { last.current = null; onDoubleTap?.(e); return; }
    last.current = { x: e.clientX, y: e.clientY, t };
  }, [onDoubleTap]);
}
