
import { requestRenderAll } from "./renderWindow";// helpers/jumpToOccurrence.js
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
// SCOPING (`root`): the SAME occurrence can be mounted in several panels at
// once (a page pinned in two cells, a copy-link, a feed copy). An unscoped
// document query returns whichever comes first in document order, so a search
// that opened the target in panel B would highlight panel A's copy instead
// (user 2026-07-27). Callers that know WHERE they put it pass a root element
// (or a lazy resolver) and the lookup never escapes it.
//
// Highlight CSS: `.anchor-highlight` in `index.css` (defined Apr 2 2026).

const HIGHLIGHT_MS = 1200;
const PAGE_SWITCH_GRACE_MS = 220;

/**
 * Jump to an occurrence's DOM node. Returns true if found + scrolled,
 * false if it wasn't in the DOM and nothing was scheduled to look again.
 *
 * Options:
 *   - root: Element, or a function returning one, to search WITHIN (see the
 *     scoping note at the top). When given, the lookup NEVER falls back to
 *     the document — a copy in another panel must not steal the highlight.
 *   - onActivatePage(occId): callback that opens the page containing
 *     the target. Called when the element isn't currently mounted. The
 *     helper retries the scroll after PAGE_SWITCH_GRACE_MS.
 *   - retries / retryMs: keep looking after the first miss (a page that was
 *     just pinned + activated needs a few frames to mount its subtree).
 *   - onMissing(): called when every attempt failed, so an async caller can
 *     still report "it's there but filtered out".
 *   - highlightMs: override the flash duration (default 1200ms).
 *   - scrollBlock: "start" | "center" | "nearest" (default "center" so
 *     the flash lands in the middle of the viewport, easier to spot).
 */
export function jumpToOccurrence(occurrenceId, opts = {}) {
  const {
    onActivatePage,
    highlightMs = HIGHLIGHT_MS,
    scrollBlock = "center",
    root = null,
    retries = 0,
    retryMs = PAGE_SWITCH_GRACE_MS,
    onMissing,
  } = opts;
  if (!occurrenceId) return false;
  const el = findOccurrenceElement(occurrenceId, root);
  if (el) {
    scrollAndFlash(el, { highlightMs, scrollBlock });
    return true;
  }
  // A long container renders a bounded WINDOW of its rows, so a row past the
  // window is in the data and not yet in the DOM. Without this, searching for
  // movie #800 would report "filtered out" — a lie, and exactly the kind a
  // windowed list invites. Ask every window to open, then fall into the retry
  // below, which is what finds it on the next frame.
  requestRenderAll();
  if (onActivatePage || retries > 0) {
    onActivatePage?.(occurrenceId);
    // Retry once the page swap has had a chance to mount the target.
    let left = Math.max(1, retries);
    const attempt = () => {
      const retry = findOccurrenceElement(occurrenceId, root);
      if (retry) { scrollAndFlash(retry, { highlightMs, scrollBlock }); return; }
      if (--left > 0) setTimeout(attempt, retryMs);
      else onMissing?.();
    };
    setTimeout(attempt, retryMs);
    return true;
  }
  // retries:0 callers ("the page is already open, a miss means filtered out")
  // still deserve one look after the windows expand — the row may simply have
  // been past the seam.
  const afterExpand = findOccurrenceElement(occurrenceId, root);
  if (afterExpand) { scrollAndFlash(afterExpand, { highlightMs, scrollBlock }); return true; }
  return false;
}

/**
 * Find the DOM element for an occurrence. Checks both `data-occ-id` (the
 * canonical attribute) and `data-occurrence-id` (legacy / iframe-preview
 * variant) to maximize compatibility.
 *
 * `root` (Element or () => Element|null) scopes the search. A root that
 * resolves to nothing yields null rather than searching the whole document —
 * "not mounted yet" must not silently become "some other panel's copy".
 */
export function findOccurrenceElement(occurrenceId, root = null) {
  if (!occurrenceId || typeof document === "undefined") return null;
  const scope = root ? (typeof root === "function" ? root() : root) : document;
  if (!scope || typeof scope.querySelector !== "function") return null;
  // CSS.escape guards against UUIDs whose hyphens / curly braces would
  // otherwise be interpreted as selector syntax.
  const safe = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(occurrenceId) : occurrenceId;
  // `data-page-occ-id` is the page shell's marker — a page IS an occurrence and
  // the search can return one, but it carries no `data-occ-id`, so an unlisted
  // page result used to find nothing at all. Listed last so a real occurrence
  // node always wins.
  const selectors = [
    `[data-occ-id="${safe}"]`,
    `[data-occurrence-id="${safe}"]`,
    `[data-page-occ-id="${safe}"]`,
  ];
  for (const sel of selectors) {
    // querySelector only sees DESCENDANTS — check the scope element itself too
    // (scoping to a page and jumping to that same page).
    if (scope.matches?.(sel)) return scope;
    const hit = scope.querySelector(sel);
    if (hit) return hit;
  }
  return null;
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
