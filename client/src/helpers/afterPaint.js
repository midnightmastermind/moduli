// helpers/afterPaint.js
//
// Run work in the first task AFTER the browser has painted.
//
// WHY THIS IS NOT `requestAnimationFrame`. A rAF callback runs BEFORE that
// frame's paint, so scheduling work there puts it in the very frame that was
// supposed to show the user something. That mistake has now been measured twice
// on this codebase: the staged-loading work found the chrome committed and
// unpainted for 7.7s because the op sweep was on a nested rAF, and the textblock
// mint found a 1121ms click of which the insert itself was 10ms — the rest was
// an app-wide re-render sharing the task. rAF *then* a macrotask is the shape
// that actually yields.
//
// Returns a cancel function. Callers that can unmount (every React caller)
// must use it — running a deferred write against a torn-down tree is how you
// get an occurrence nobody renders.

/**
 * True when a requestAnimationFrame callback will actually run soon. A HIDDEN tab has rAF and never fires it, so a
 * tab loaded in the background waited for the user to look at it before requesting the rest of the grid, releasing
 * panel content and starting the load operations — then did all of it at once (prod [load] lines: ops starting
 * 77-82s after the page appeared). With no paint coming there is nothing to wait for.
 */
export function canPaintSoon() {
  if (typeof requestAnimationFrame !== "function") return false;
  return !(typeof document !== "undefined" && document.hidden);
}

export function afterPaint(fn, delayMs = 0) {
  let cancelled = false;
  let timer = null;

  const run = () => { if (!cancelled) fn(); };

  if (canPaintSoon()) {
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      timer = setTimeout(run, delayMs);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame?.(raf);
      if (timer != null) clearTimeout(timer);
    };
  }

  // No rAF (jsdom, a backgrounded tab). A timer is the honest fallback — the
  // work must still happen, just without the paint guarantee.
  timer = setTimeout(run, delayMs || 16);
  return () => { cancelled = true; clearTimeout(timer); };
}
