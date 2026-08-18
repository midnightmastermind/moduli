// closingGate.js — hold a surface mounted long enough to animate itself out.
//
// AN EXIT ANIMATION IS NOT A CSS PROBLEM, IT IS A LIFECYCLE ONE. React unmounts
// the moment `open` goes false, so a `@keyframes` on the way out never gets a
// frame to run in — the element is gone before the first one. The only way to
// play it is to keep the surface mounted for the duration and report the close
// afterwards.
//
// So the close paths call `requestClose()` instead of `onClose()`: the caller
// flips a class, the animation runs, and the REAL close fires when it is done.
//
// ONE HELPER FOR BOTH SURFACES, deliberately. The spread viewer and the
// full-screen artifact need exactly this, and two copies of a timer-plus-flag
// is precisely the shape that drifts — one of them gets the re-open reset and
// the other does not, and the bug shows up months later as a dialog that
// refuses to open a second time.
import { useCallback, useEffect, useRef, useState } from "react";

/** Does this user want motion at all? Read at call time, not at module load —
 *  the setting can change while the tab is open. Missing `matchMedia` (jsdom,
 *  older embeds) means "no preference expressed", which is motion. */
export function prefersReducedMotion() {
  try {
    return typeof window !== "undefined"
      && typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/**
 * @param {boolean} open      whether the surface is currently shown
 * @param {number}  durationMs how long the exit animation runs
 * @param {Function} onClosed  called once, after the animation, to actually close
 * @returns {{ closing: boolean, requestClose: Function }}
 */
export function useClosingGate(open, durationMs, onClosed) {
  const [closing, setClosing] = useState(false);
  const timerRef = useRef(null);
  // The callback is read through a ref so a caller passing an inline arrow does
  // not restart the timer on every render — that would make the close fire late,
  // or never, depending on how often the parent re-renders.
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  const clear = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const requestClose = useCallback(() => {
    // REPEATS ARE IGNORED, and this is load-bearing rather than tidy: Escape
    // auto-repeats while held, and a second timer would fire `onClosed` twice —
    // which, for a host that pops a stack, closes the surface underneath too.
    if (timerRef.current) return;
    if (durationMs <= 0 || prefersReducedMotion()) { onClosedRef.current?.(); return; }
    setClosing(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      onClosedRef.current?.();
    }, durationMs);
  }, [durationMs]);

  // RE-OPENING MUST CLEAR THE FLAG. Without this a surface that is closed and
  // immediately reopened comes back already wearing its exit animation — it
  // appears, plays the shrink, and is unreachable. Also cancels a close still
  // in flight, so reopening mid-animation is not followed by a stale close.
  useEffect(() => {
    if (open) { clear(); setClosing(false); }
  }, [open, clear]);

  useEffect(() => clear, [clear]);

  return { closing, requestClose };
}
