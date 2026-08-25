// helpers/renderWindow.js — render a bounded WINDOW of a long child list.
//
// WHY, MEASURED (2026-08-25, real browser against production). The Movies board
// holds 993 rows. Rendering them all:
// ```
// DOM nodes in that panel   74,592      (~75 per row)
// ResizeObservers            7,377      one per AutoMarquee, watching 2 nodes each
// JS heap                      645 MB
// main thread blocked       14,689 ms   across 8 long tasks, worst single task 6,505 ms
// ```
// A Samsung tablet's renderer budget is ~256 MB, so the tab is killed BEFORE
// anything paints — and because that one task cannot be interrupted, the panels
// behind it (the Schedule, the Trackers) never render at all. The user's report
// was "the app crashes trying to load the schedule"; the Schedule was innocent.
//
// WHY `content-visibility: auto` DOES NOT ALREADY FIX THIS. It is applied to
// long lists already (`.container-list--long .instance-wrap`) and it is doing
// its job — it skips LAYOUT and PAINT for off-screen rows. It cannot skip
// creating them: the nodes, the React fibers and the ResizeObservers all exist
// whether or not the row is painted, and those are what the 645 MB is made of.
// Deferring the work would not help either — spread over ten frames it is still
// 645 MB at the end. The count has to come down.
//
// THE WINDOW GROWS ON SCROLL, so a long board is still fully browsable: a
// sentinel after the last rendered row asks for the next chunk as it comes into
// view. Nothing is permanently unreachable.
//
// AND IT CAN BE OPENED IN FULL, which is what keeps SEARCH honest. Jumping to an
// occurrence finds it by a DOM query and reports "filtered out" when it misses —
// so a windowed list would lie about row 800 existing. `jumpToOccurrence`
// dispatches `moduli:render-all` on its first miss and retries; every open
// window expands, and the retry finds it. That is why the escape hatch is an
// EVENT rather than a prop: the searcher and the container never meet.
import { useCallback, useEffect, useMemo, useState } from "react";

// Chosen against the measurement above, not by taste: at ~75 nodes and ~7
// observers per row, 80 rows is ~6,000 nodes — the weight of an ordinary busy
// page, and comfortably inside a tablet's budget with three panels mounted.
export const WINDOW_INITIAL = 80;
export const WINDOW_STEP = 80;
// Below this a window costs more than it saves: the sentinel, the observer and
// the extra render are real, and a 90-row container is not what breaks a tablet.
// It matches the `.container-list--long` threshold the CSS already uses.
export const WINDOW_MIN = 120;

export const RENDER_ALL_EVENT = "moduli:render-all";

/** Ask every open window to render everything. Used by the occurrence jump so a
 *  row outside the window is never reported as missing. */
export function requestRenderAll() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(RENDER_ALL_EVENT));
}

/**
 * How many of `total` items to render, and a ref for the "load more" sentinel.
 * Returns `count === total` (and a null ref) whenever windowing is not worth it,
 * so short containers take a byte-identical path.
 */
export function useRenderWindow(total, { enabled = true, resetKey = null } = {}) {
  const windowed = enabled && total > WINDOW_MIN;
  const [count, setCount] = useState(windowed ? WINDOW_INITIAL : total);
  // A CALLBACK ref, not a plain one. The sentinel is rendered conditionally, so
  // with `useRef` the observer effect depends on the node happening to be
  // attached by the time the effect runs — true today, and one reorder away
  // from silently never observing. A callback ref makes the node itself the
  // dependency, so the observer attaches whenever the sentinel appears.
  const [sentinel, setSentinel] = useState(null);

  // A new list (navigation, a filter change) starts a new window. Without this
  // the count carries over and a freshly filtered 5-row list would claim to be
  // showing 240.
  useEffect(() => { setCount(windowed ? WINDOW_INITIAL : total); }, [resetKey, windowed, total]);

  const showAll = useCallback(() => setCount((c) => (c >= total ? c : total)), [total]);
  useEffect(() => {
    if (!windowed) return;
    const onAll = () => showAll();
    window.addEventListener(RENDER_ALL_EVENT, onAll);
    return () => window.removeEventListener(RENDER_ALL_EVENT, onAll);
  }, [windowed, showAll]);

  useEffect(() => {
    if (!windowed || count >= total) return;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    // `rootMargin` asks for the next chunk BEFORE the sentinel is on screen, so
    // scrolling does not stall at the seam.
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setCount((c) => Math.min(total, c + WINDOW_STEP));
    }, { rootMargin: "600px" });
    io.observe(sentinel);
    return () => io.disconnect();
  }, [windowed, count, total, sentinel]);

  return useMemo(() => ({
    count: windowed ? Math.min(count, total) : total,
    windowed,
    hidden: windowed ? Math.max(0, total - count) : 0,
    sentinelRef: windowed ? setSentinel : null,
    showAll,
  }), [windowed, count, total, showAll]);
}
