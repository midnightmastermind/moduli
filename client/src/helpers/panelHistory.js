// helpers/panelHistory.js
//
// BACK, FOR A PANEL.
//
// User, 2026-09-10: *"a back button on the panel header. this button will go
// back to the previously opened page. that way i can press back again if im on a
// browser page from a bookmark."*
//
// A panel's current page is its view's `activeOccurrenceId`. Back is therefore a
// history of that value — the same model `browserNav` already keeps for the
// address bar, which is why this imports it rather than restating it. Two
// history implementations would drift on the one question that matters: what
// counts as a navigation.
//
// ── IT LISTENS AT THE CHOKEPOINT, NOT AT THE CALL SITES ─────────────────────
//
// `activeOccurrenceId` is written from ten places today — pinning a page, a tree
// click, a drop, the assistant, `openOccurrenceInPanel`, the folder grid, the new
// open-as-page button. Pushing a history entry at each is the "eighth caller
// forgets" trap this codebase keeps paying for, and the eleventh would simply be
// missing from Back with nothing to say so.
//
// So `CommitHelpers.updateView` — which every one of them already goes through —
// reports the change here, once.
//
// ── IN MEMORY, PER DEVICE, NEVER ON THE GRID ────────────────────────────────
//
// Which page you were looking at a moment ago is a fact about this session at
// this screen. Persisting it would cost a socket write per navigation and would
// sync one machine's browsing onto another. Same call `helpers/treeExpansion`
// made for folder open-state.
import { pushEntry, currentUrl, canGoBack, canGoForward, goBack, goForward } from "./browserNav";

const BLANK = { entries: [], index: -1 };

/** viewId -> { entries, index } */
const byView = new Map();
const listeners = new Set();

function emit() { for (const fn of [...listeners]) { try { fn(); } catch { /* a bad listener is not this module's problem */ } } }

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** The whole history for a view, for tests and for the snapshot below. */
export function navFor(viewId) { return byView.get(viewId) || BLANK; }

/**
 * A view's active page changed. Called from the ONE write path.
 *
 * ── THE MOVE WE MADE OURSELVES NEEDS NO GUARD, and an A/B is why this says so
 * rather than carrying one (2026-09-10). A Back writes `activeOccurrenceId`,
 * which comes straight back through `updateView` and lands here — so the
 * obvious worry is that it appends the page you just left and Back never
 * reaches further than one step.
 *
 * It cannot. `back()` moves the INDEX onto the target before returning it, so
 * by the time that write arrives the target IS the current entry, and
 * `pushEntry` refuses to re-push what you are already on. A `suppress` set was
 * written for this and removed: it failed ZERO tests, because the no-op rule
 * it duplicated was already doing the work. A guard nobody has watched fire is
 * a guess.
 *
 * The identity check below is NOT correctness — `pushEntry` already returns the
 * same object for a no-op. It only avoids waking every subscriber for a change
 * that did not happen.
 */
export function recordActive(viewId, occId) {
  if (!viewId || !occId) return;
  const before = navFor(viewId);
  const after = pushEntry(before, occId);
  if (after === before) return;          // nothing moved — do not wake anyone
  byView.set(viewId, after);
  emit();
}

export const canBack = (viewId) => canGoBack(navFor(viewId));
export const canForward = (viewId) => canGoForward(navFor(viewId));

/**
 * Step back (or forward) and return the page to open, or null.
 *
 * `exists` SKIPS STALE ENTRIES rather than opening a hole: a page in the history
 * may have been deleted or unpinned since, and resurrecting one would be worse
 * than the button doing nothing. Entries that fail it are stepped over, and the
 * index lands wherever the search stopped so a second press continues from there.
 */
function step(viewId, dir, exists) {
  let nav = navFor(viewId);
  const move = dir === "back" ? goBack : goForward;
  const can = dir === "back" ? canGoBack : canGoForward;
  while (can(nav)) {
    nav = move(nav);
    const id = currentUrl(nav);
    if (!id) continue;
    if (typeof exists === "function" && !exists(id)) continue;
    byView.set(viewId, nav);
    emit();
    return id;
  }
  // Nothing reachable that way. Keep whatever we walked to — a history full of
  // dead pages should not re-offer them on the next press.
  byView.set(viewId, nav);
  emit();
  return null;
}

export const back = (viewId, exists) => step(viewId, "back", exists);
export const forward = (viewId, exists) => step(viewId, "forward", exists);

/** Tests only: a session's history is not observable any other way. */
export function _reset() { byView.clear(); }
