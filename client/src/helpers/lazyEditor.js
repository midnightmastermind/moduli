// helpers/lazyEditor.js
// ============================================================================
// One decision, one place: "is this textblock's real editor mounted yet?"
//
// A live TipTap/ProseMirror instance per textblock is the app's dominant render
// cost. TextblockCard has carried this optimisation alone; the doc BLOCK path
// (246 of poms grid's 1036 textblocks) mounts eagerly. Extracting it here is
// what lets both share ONE implementation instead of a second copy.
//
// `forceLiveNow` exists for one specific reason, and it is not convenience:
// InstanceTextblockNode moves the caret between adjacent textblocks by focusing
// the SIBLING's inner `.ProseMirror`, behind an `if (innerPM)` guard. A neighbour
// that is still a placeholder has no `.ProseMirror`, so the guard swallows the
// focus and the caret silently stops moving between blocks. The neighbour must be
// made live SYNCHRONOUSLY before it is focused.
// ============================================================================
import { useCallback, useEffect, useRef, useState } from "react";

// The class a placeholder paints. Anything that MEASURES rendered text has to
// know it: WrapGroupNode reads `.ProseMirror || .textblock-card-placeholder`,
// because a host below the fold has thousands of characters on screen and no
// ProseMirror at all (measured on the Eminem page: 17 of 18 wrap groups reported
// textArea 0 with 2580-3826 real characters, which decideWrapStack read as
// "blank host — nothing to wrap"). Reusing the class TextblockCard already paints
// means every existing measurer keeps working when a second path goes lazy.
export const LAZY_PLACEHOLDER_CLASS = "textblock-card-placeholder";

// occurrenceId -> goLive(). Registered while a lazy editor is mounted and NOT yet
// live; removed the moment it goes live or unmounts, so the map only ever holds
// editors that can still be forced.
const pending = new Map();

/**
 * Make a registered, not-yet-live editor live synchronously.
 * @returns {boolean} false when that id is not registered (already live, never
 *   mounted, or not lazy) — callers use this to fall back rather than assume.
 */
export function forceLiveNow(occurrenceId) {
  const goLive = occurrenceId ? pending.get(occurrenceId) : null;
  if (!goLive) return false;
  goLive();
  return true;
}

// Test-only: register a goLive without mounting a component. Not used in app code.
// In the app the registration is removed by the hook's own effect cleanup, so a
// stale entry is impossible; a hand-registered one has no such lifecycle, which is
// why `__resetForTest` exists — without it a closure from a previous test fires
// against detached DOM and throws NotFoundError from an unrelated test.
export function __registerForTest(occurrenceId, goLive) {
  pending.set(occurrenceId, goLive);
}
export function __resetForTest() {
  pending.clear();
}

/**
 * @param {object}  opts
 * @param {boolean} opts.eager         mount the real editor immediately
 * @param {string}  opts.occurrenceId  key for forceLiveNow
 * @param {number}  opts.rootMargin    px ahead of the viewport to go live
 * @returns {{ live: boolean, ref: object, goLive: () => void }}
 */
export function useLazyEditor({ eager = false, occurrenceId = null, rootMargin = 700 } = {}) {
  const [live, setLive] = useState(eager);
  const ref = useRef(null);
  const goLive = useCallback(() => setLive(true), []);

  // Register while forceable. Keyed on `live` so the entry is dropped as soon as
  // it goes live — forcing an already-live editor is a no-op we should not claim
  // to have done (callers branch on the return value).
  useEffect(() => {
    if (!occurrenceId || live) return undefined;
    pending.set(occurrenceId, goLive);
    return () => { pending.delete(occurrenceId); };
  }, [occurrenceId, live, goLive]);

  useEffect(() => {
    if (live) return undefined;
    const el = ref.current;
    // No element, or no IntersectionObserver (jsdom, old engines) -> mount eagerly
    // rather than render a placeholder that could never be replaced.
    if (!el || typeof IntersectionObserver === "undefined") { setLive(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setLive(true); io.disconnect(); }
    }, { rootMargin: `${rootMargin}px` });
    io.observe(el);
    return () => io.disconnect();
  }, [live, rootMargin]);

  return { live, ref, goLive };
}
