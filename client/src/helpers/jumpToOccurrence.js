
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

// Two 500ms blink cycles — a double flash — `@keyframes anchor-blink` in
// index.css. Keep the two in step: this is when the class comes OFF, the
// animation is what it does while it is on.
export const HIGHLIGHT_MS = 1000;
const PAGE_SWITCH_GRACE_MS = 220;
// After a window is asked to grow, keep looking until the row mounts. A TIME
// bound, not a count: a large expansion can outlast any fixed number of polls
// (measured: 16 x 120ms ran out before a 994-row board finished mounting).
const EXPAND_DEADLINE_MS = 10000;
// A targeted request grows only the list that holds the row DIRECTLY, and that
// list CLAIMS it as the event is dispatched. A row nested deeper (inside a child
// container of a windowed list) is in no list's index, so nobody claims it and
// the jump opens every window at once. NOT a time grace: measured on prod, the
// claimed list took 4.6s to mount and a 1.2s grace opened 650 more rows in other
// boards while it did.

/**
 * Jump to an occurrence's DOM node. Returns true if found + scrolled OR if a
 * later look was scheduled (a miss is then reported via `onMissing`), false if
 * it wasn't in the DOM and nothing was scheduled to look again.
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
 *   - highlightMs: override the flash duration (default HIGHLIGHT_MS).
 *   - scrollBlock: "start" | "center" | "nearest" (default "center" so
 *     the flash lands in the middle of the viewport, easier to spot).
 *   - expandWindows: false keeps every windowed list as it is on a miss. For a
 *     jump nobody asked for (the on-load SCROLL_TO poll): it retries 24 times,
 *     and each miss used to open EVERY long list in full — with the Schedule
 *     not open in any panel, the People board went from 80 rows to all 1,202
 *     (~194k nodes) ten seconds after every load, and each later delete then
 *     froze the tab long enough to drop the socket (user, 2026-09-26).
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
    expandWindows = true,
  } = opts;
  if (!occurrenceId) return false;
  const el = findOccurrenceElement(occurrenceId, root);
  if (el) {
    scrollAndFlash(el, { highlightMs, scrollBlock });
    return true;
  }
  // A long container renders a bounded WINDOW of its rows, so a row past the
  // window is in the data and not yet in the DOM. Without the render-all
  // request, searching for movie #800 would report "filtered out" — a lie, and
  // exactly the kind a windowed list invites.
  //
  // ── BUT NEVER BEFORE A PAGE SWAP HAS HAD ITS CHANCE ─────────────────────
  // User, 2026-09-15: *"theres no reason it should take that long to open a
  // browser occurance … at least have it go to the page with the loading circle
  // right away"*. Opening a bookmark activates a NEW page and jumps to it. The
  // first lookup always misses (the page has not mounted), and asking for
  // render-all right then expanded every window STILL ON SCREEN — the Bookmarks
  // board being left went from 80 cards to all 1,465 in a 2.2s commit, before
  // the panel switched away and threw them out. A target that is about to mount
  // cannot be hiding in the windows of the page you are leaving, so a caller
  // that swaps or polls first looks again BEFORE anything is expanded, and only
  // a miss after that asks the windows to open.
  if (onActivatePage || retries > 0) {
    onActivatePage?.(occurrenceId);
    let left = Math.max(1, retries);
    let expanded = false;
    const attempt = () => {
      const retry = findOccurrenceElement(occurrenceId, root);
      if (retry) { scrollAndFlash(retry, { highlightMs, scrollBlock }); return; }
      if (!expanded && expandWindows) {
        // The page is up and the row is not: grow the window that holds it
        // and keep looking until it mounts.
        expanded = true;
        expandAndFind(occurrenceId, { root, retryMs, onMissing, found: (el) => scrollAndFlash(el, { highlightMs, scrollBlock }) });
        return;
      }
      if (--left > 0) setTimeout(attempt, retryMs);
      else onMissing?.();
    };
    setTimeout(attempt, retryMs);
    return true;
  }
  // retries:0 callers ("the page is already open, a miss means filtered out")
  // still deserve a look after the windows expand — the row may simply have
  // been past the seam. Nothing is changing page here, so expanding now is safe.
  //
  // ── AND THAT LOOK HAS TO WAIT FOR THE RENDER (user, 2026-09-30: "the first
  // search is still not scrolling to the correct one, it lags for a few seconds
  // and does nothing"). This used to look again in the SAME tick as the
  // request: the event only sets state, React renders the expanded list later,
  // so the lookup always missed. The first search paid for rendering every row
  // (the lag) and then reported the row missing (nothing happened); the second
  // search found the rows the first one had mounted, which is why it "worked
  // after that". The miss is reported through `onMissing` once the polls run
  // out, like the page-swap path above.
  if (!expandWindows) return false;
  expandAndFind(occurrenceId, { root, retryMs, onMissing, found: (el) => scrollAndFlash(el, { highlightMs, scrollBlock }) });
  return true;
}

/**
 * Grow the window holding `occurrenceId` and look until it mounts. A TARGETED
 * request (only the list holding the row grows, only as far as the row); if no
 * list claims it, every window opens in full (the row is nested below a
 * windowed list's direct children).
 * Gives up at EXPAND_DEADLINE_MS through `onMissing`.
 */
function expandAndFind(occurrenceId, { root, retryMs, onMissing, found }) {
  const t0 = Date.now();
  const scope = root ? (typeof root === "function" ? root() : root) : null;
  if (!requestRenderAll(occurrenceId, scope)) requestRenderAll();
  const look = () => {
    const hit = findOccurrenceElement(occurrenceId, root);
    if (hit) { found(hit); return; }
    if (Date.now() - t0 < EXPAND_DEADLINE_MS) setTimeout(look, retryMs);
    else onMissing?.();
  };
  setTimeout(look, 0);
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

// ── Landing ON the element, then showing it ─────────────────────────────────
// User, 2026-09-26: "the searched element doesnt land on the screen. the
// searched element should be scrolled to the center and highlighted for a
// second to show its the one". One smooth scroll aims at where the element IS
// when the scroll starts — and the page keeps moving after that: lazy rows and
// editors above it mount at their real height, images load, a long list opens
// its window. So the scroll landed where the element WAS, and the flash (a
// faint background tint that the row's own background hides anyway) played
// off screen. Now: scroll, then keep checking and re-center until the element
// holds still in the middle of its scroll area.
//
// THE RING BLINKS AT ONCE, rather than after that (user, 2026-09-30: "the
// highlight on the actual occurance is super late. it shows up like 2 seconds
// later"). Waiting made the settle logic correct and the feedback useless: the
// smooth scroll gets two checks before the first correction, so the earliest
// ring was ~1s and ~2s was typical. The ring rides ON the element, so it moves
// with it and is still blinking when it lands — the failure the wait was written
// for was the flash ENDING before the element arrived, which is why a settle
// that outlasts the blink restarts it ONCE.
/**
 * Ring an element and stop after `ms`. THE ONE DEFINITION of the jump blink —
 * every surface that says "here it is" calls this, or the class and the
 * keyframe's length drift apart and the ring cuts off mid-cycle. Returns the
 * off-timer so a caller re-blinking the same element can hand back the one it
 * is replacing.
 */
export function flashElement(el, ms = HIGHLIGHT_MS, prevTimer = null) {
  if (!el) return null;
  clearTimeout(prevTimer);
  el.classList.remove("anchor-highlight");
  void el.offsetWidth;              // restart the animation if it was just removed
  el.classList.add("anchor-highlight");
  return setTimeout(() => el.classList.remove("anchor-highlight"), ms);
}

const SETTLE_CHECK_MS = 250;
const SETTLE_MAX_CHECKS = 12;      // ~3s, then flash wherever it is
const CENTER_TOLERANCE_PX = 48;

function scrollParentOf(el) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

/**
 * PURE: how far (px) the element sits from where it should be in the visible
 * area — its centre from the area's centre, or, for an element taller than the
 * area, its top from a little below the area's top. Positive = below.
 */
export function offTargetBy(elRect, viewRect, block = "center") {
  if (block === "start" || elRect.height > viewRect.height - 32) return elRect.top - viewRect.top - 16;
  return (elRect.top + elRect.height / 2) - (viewRect.top + viewRect.height / 2);
}

function viewRectFor(el) {
  const sp = scrollParentOf(el);
  if (sp) return sp.getBoundingClientRect();
  return { top: 0, height: window.innerHeight || document.documentElement.clientHeight || 0 };
}

/** "auto" (instant) when the element sits more than FAR_SCREENS views away. */
const FAR_SCREENS = 2;
export function scrollBehaviorFor(el, block = "center") {
  const vr = viewRectFor(el);
  const off = offTargetBy(el.getBoundingClientRect(), vr, block);
  return vr.height > 0 && Math.abs(off) > FAR_SCREENS * vr.height ? "auto" : "smooth";
}

function scrollToTarget(el, block, behavior) {
  // A doc's own scroller: aim its centre, same as scrollIntoView would.
  const sc = el.closest(".artifact-markdown");
  if (sc) {
    const r = el.getBoundingClientRect(), s = sc.getBoundingClientRect();
    const offset = block === "center" && r.height < s.height ? (s.height - r.height) / 2 : 16;
    sc.scrollTo({ top: sc.scrollTop + r.top - s.top - offset, behavior });
    return;
  }
  try { el.scrollIntoView({ behavior, block: block === "nearest" ? "center" : block }); }
  catch { el.scrollIntoView(); }
}

/**
 * Scroll an element to the centre of its scroll area, keep it there while the
 * page settles. The ring blinks from the click, not from the settle. Exported
 * so callers that already have the element can skip the lookup.
 */
export function scrollAndFlash(el, opts = {}) {
  const { highlightMs = HIGHLIGHT_MS, scrollBlock = "center" } = opts;
  if (!el) return;
  // A FAR TARGET IS JUMPED TO, NOT GLIDED TO. Measured on prod: a search for
  // Movies row #600 smooth-scrolled ~55,000px and spent ~0.7s of the wait on
  // the animation alone. More than two screens away, nobody is following the
  // motion; a short hop keeps the glide that shows where you went.
  scrollToTarget(el, scrollBlock, scrollBehaviorFor(el, scrollBlock));

  let offTimer = null;
  let startedAt = null;             // when the blink actually began
  const flash = () => { startedAt = Date.now(); offTimer = flashElement(el, highlightMs, offTimer); };

  // BLINK WHEN IT COMES INTO VIEW (user, 2026-09-30: "theres a two second pause
  // and then it flashes. it should flash right when it gets in the view"). A
  // blink started at the click played out during a long smooth scroll, off
  // screen, and the one the user saw was the settle's re-blink ~2s later. The
  // observer fires on the frame the element enters the visible area — at once
  // when it is already there. Without IntersectionObserver, blink now.
  let io = null;
  if (typeof IntersectionObserver !== "undefined") {
    io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect(); io = null;
      flash();
    }, { threshold: 0.25 });
    io.observe(el);
  } else {
    flash();
  }
  let checks = 0, still = 0, lastTop = null;
  const settle = () => {
    if (!el.isConnected) { io?.disconnect(); clearTimeout(offTimer); el.classList.remove("anchor-highlight"); return; }
    checks++;
    const r = el.getBoundingClientRect();
    const off = offTargetBy(r, viewRectFor(el), scrollBlock);
    const moved = lastTop != null && Math.abs(r.top - lastTop) > 2;
    lastTop = r.top;
    // Give the smooth scroll two checks to arrive before correcting it.
    if (checks >= 2 && Math.abs(off) > CENTER_TOLERANCE_PX) { scrollToTarget(el, scrollBlock, "auto"); still = 0; lastTop = null; }
    else if (!moved && Math.abs(off) <= CENTER_TOLERANCE_PX) still++;
    // Only re-blink when the first one has already run out — a settle that
    // finishes inside the blink must not restart it and double its length.
    if (still >= 2 || checks >= SETTLE_MAX_CHECKS) {
      // Never came into view (or no observer fired): blink where it is now.
      if (io) { io.disconnect(); io = null; flash(); return; }
      if (startedAt == null || Date.now() - startedAt >= highlightMs) flash();
      return;
    }
    setTimeout(settle, SETTLE_CHECK_MS);
  };
  setTimeout(settle, SETTLE_CHECK_MS);
}
