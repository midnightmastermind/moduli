// helpers/jumpToOccurrence.js
//
// Shared "jump to + highlight" helper. Used by:
//   - ManifestTree anchor chip clicks (already had this logic inline).
//   - RepresentationView's onJump (mind-map node clicks, value-builder
//     breadcrumb card crumbs).
//   - Any future "find this occurrence" surface (assistant drawer, search).
//
// Behavior:
//   1. If the target occurrence's DOM element is already mounted, scroll to
//      it + flash the .anchor-highlight CSS animation.
//   2. If not mounted (different page open), call `onActivatePage(occId)`
//      to switch the active page, then retry the scroll after a short
//      grace window.
//
// DOM marker: occurrences render with `data-occ-id={occurrence.id}` on
// their outermost element (ModuleInstance, ModuleContainer, ModulePage,
// PreviewNode all comply). The helper queries that selector.
//
// Highlight CSS: `.anchor-highlight` in `index.css` (defined Apr 2 2026).

const HIGHLIGHT_MS = 1200;
const PAGE_SWITCH_GRACE_MS = 220;

/**
 * Jump to an occurrence's DOM node. Returns true if found + scrolled,
 * false if it wasn't in the DOM and no activation hook was supplied.
 *
 * Options:
 *   - onActivatePage(occId): callback that opens the page containing
 *     the target. Called when the element isn't currently mounted. The
 *     helper retries the scroll after PAGE_SWITCH_GRACE_MS.
 *   - highlightMs: override the flash duration (default 1200ms).
 *   - scrollBlock: "start" | "center" | "nearest" (default "center" so
 *     the flash lands in the middle of the viewport, easier to spot).
 */
export function jumpToOccurrence(occurrenceId, opts = {}) {
  const {
    onActivatePage,
    highlightMs = HIGHLIGHT_MS,
    scrollBlock = "center",
  } = opts;
  if (!occurrenceId) return false;
  const el = findOccurrenceElement(occurrenceId);
  if (el) {
    scrollAndFlash(el, { highlightMs, scrollBlock });
    return true;
  }
  if (onActivatePage) {
    onActivatePage(occurrenceId);
    // Retry once the page swap has had a chance to mount the target.
    setTimeout(() => {
      const retry = findOccurrenceElement(occurrenceId);
      if (retry) scrollAndFlash(retry, { highlightMs, scrollBlock });
    }, PAGE_SWITCH_GRACE_MS);
    return true;
  }
  return false;
}

/**
 * Find the DOM element for an occurrence. Checks both `data-occ-id` (the
 * canonical attribute) and `data-occurrence-id` (legacy / iframe-preview
 * variant) to maximize compatibility.
 */
export function findOccurrenceElement(occurrenceId) {
  if (!occurrenceId || typeof document === "undefined") return null;
  // CSS.escape guards against UUIDs whose hyphens / curly braces would
  // otherwise be interpreted as selector syntax.
  const safe = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(occurrenceId) : occurrenceId;
  return (
    document.querySelector(`[data-occ-id="${safe}"]`) ||
    document.querySelector(`[data-occurrence-id="${safe}"]`)
  );
}

/**
 * Scroll an element into view + flash the highlight animation. Exported
 * so callers that already have the element (e.g. drag handlers) can skip
 * the lookup.
 */
export function scrollAndFlash(el, opts = {}) {
  const { highlightMs = HIGHLIGHT_MS, scrollBlock = "center" } = opts;
  if (!el) return;
  // Scroll first — use the nearest .artifact-markdown scroll container
  // for richer-positioned scroll, fall back to scrollIntoView for
  // anything outside a doc.
  const sc = el.closest(".artifact-markdown");
  if (sc) {
    const top = sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top;
    sc.scrollTo({ top, behavior: "smooth" });
  } else {
    try { el.scrollIntoView({ behavior: "smooth", block: scrollBlock }); }
    catch { el.scrollIntoView(); }
  }
  // Restart the CSS animation by toggling the class. `void el.offsetWidth`
  // forces a reflow so the second add() retriggers the animation when
  // the class was just removed in the same tick.
  el.classList.remove("anchor-highlight");
  void el.offsetWidth;
  el.classList.add("anchor-highlight");
  setTimeout(() => el.classList.remove("anchor-highlight"), highlightMs);
}
