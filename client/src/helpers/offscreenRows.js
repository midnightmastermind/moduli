// helpers/offscreenRows.js
//
// THE MOBILE GRID KEEPS EVERY PANEL'S ROWS MOUNTED, INCLUDING THE ~150 IN THE
// TWO PANELS THAT ARE TRANSLATED OFF SCREEN.
//
// Measured on prod at 820x1180, 6x CPU throttle, one rail tap, median of three
// (baseline noise is the spread of the three 195-row arms):
//
//     arm                     rows shown   paint    whole tap
//     baseline                       195   457.7        1860
//     null_arm                       195   443.0        2015
//     offscreen_panels_only           54   258.5        1429   <- this file
//     window_viewport_600             45   285.2        1451
//     rows_none (the CEILING)          0   187.0         990
//
// ── WHY THE COARSE RULE AND NOT A VIEWPORT WINDOW ─────────────────────────
// The two middle arms are the same result. A per-row viewport window renders
// nine fewer rows and buys nothing for them — so the fine-grained version is
// pure risk, and the risk is documented: 2026-08-04 applied
// `content-visibility: auto` at ROW granularity and made the mobile Routines
// scroll 40x worse (frame median 484ms), because each flip costs that row a
// full layout and paint. A window that mounts and unmounts rows as you scroll
// has the same shape and a higher cost — React mount/unmount, not a skip.
//
// This rule flips ONCE PER CELL SWITCH and never during a scroll, because what
// it asks is "is this panel the one on screen", not "is this row in view".
//
// ── AND IT NEEDS NO HEIGHT PLACEHOLDER, WHICH IS THE OTHER HALF ───────────
// Collapsing a container inside the ACTIVE panel would change the scroll height
// under the finger — the `contain-intrinsic-size` trap this codebase has been
// wrong about in both directions. An OFF-SCREEN panel has no such problem: the
// grid's tracks are all `fr` on a fixed-size slider (`cols*100%` x `rows*100%`),
// so a panel's own intrinsic size never contributes to the cell geometry.
//
// ── WHY A STORE AND NOT A CONTEXT ─────────────────────────────────────────
// Only the container knows it renders rows; only the panel knows where it sits.
// A context provider per panel would re-render every consumer in its subtree on
// every cell switch, which is the fan-out `activeCellStore` and
// `computedValuesStore` were both created to avoid. Containers subscribe by
// panel id and nothing else hears about it.
import { useSyncExternalStore } from "react";
import { RENDER_ALL_EVENT } from "./renderWindow";
import { afterPaint } from "./afterPaint";

// ── AND THEN IT LOST THE TAP. A/B'd ON PROD, ONE BUILD, FLAG TOGGLED ──────
// The CSS arms above hid rows with `display:none` — they measured a STATE. This
// measures the TRANSITION, and the transition is where the cost is:
//
//     arm            rows  active | scroll med  p95   >32ms |  tap style  paint   task
//     OFF (today)     195     102 |       26.4 116.9     12 |      356.8  501.8   1785
//     ON              102     102 |       21.7  28.3      6 |      564.1  242.9   3484
//     OFF (today)     195     102 |       28.5 116.4     15 |        382  461.4   1894
//     ON              102     102 |       23.5  36.2      6 |      621.4  234.7   3616
//
// PAINT FELL EXACTLY AS PREDICTED (-50%, and 242.9 against the CSS arm's 258.5)
// and the SCROLL IS TRANSFORMED — p95 116.9 -> 28.3ms, long frames halved, and
// it covered MORE distance in the same 3s because the frames were cheaper. The
// scroll-thrash risk this design was shaped around does not exist: rows flip on
// a cell switch, never under a finger.
//
// AND THE TAP NEARLY DOUBLED, 1785 -> 3484ms. Unmounting ~93 rows and mounting
// ~93 more is more React work than the paint it saves — in the OFF arm the
// panel you switch TO already has its rows, so a switch is pure paint. `rowsInActivePanel`
// is 102 in BOTH arms, which is the control: nothing visible was removed, so
// the tap difference is the mount, not missing content.
//
// ── AND THE DEFERRED VARIANT WAS BUILT, AND IT DOES NOT SAVE IT EITHER ────
// The trace above measures TOTAL main-thread work in a window, which deferral
// cannot change — it reschedules work, it does not remove it. The number that
// answers this variant is the app's own CELL-SWITCH split (`paint` = commit ->
// the first frame after; `blocked` = thread unavailable during the window), so
// that is what was driven. Prod, 6x throttle, median of 4 taps per arm:
//
//     arm                  rows | blocked  maxBlock   react   paint
//     OFF (today)           195 |    1016       427      20     405
//     ON immediate          102 |    2692      2692      19    2673
//     ON deferred           102 |    2912      2761      19     132
//     OFF (today) again     195 |    1205       385      17     368
//     ON deferred again     102 |    3169      2986      22     144
//
// DEFERRAL DOES EXACTLY WHAT IT PROMISED: the destination cell paints 3x
// sooner, 405 -> 132ms. And it converts the cost into ONE 2.7-SECOND LONG TASK
// — you see the cell instantly and cannot touch it while ~93 rows arrive.
//
// So the finding is not about the trigger after all, and it is worth stating
// plainly so a fourth session does not propose this again: MOUNTING ~93 REACT
// ROWS COSTS ~2.7s AT 6x THROTTLE AGAINST THE ~405ms OF PAINT IT SAVES. That is
// ~6:1 the wrong way, and no trigger, deferral or slicing changes the ratio —
// slicing would only spread the 2.9s across frames. Keeping the rows mounted
// and paying the paint is the cheaper trade at every scheduling.
//
// WHAT DID COME OUT OF IT, and it is real: with the rows gone the ACTIVE
// panel's scroll is transformed (p95 129 -> 34ms, frames over 32ms 43 -> 7).
// That win is only available while the rows are unmounted, which is what costs
// the switch — so it is not free either. Any future attempt has to beat the
// 6:1 above, not just move it around.

/** OFF by default so the A/B runs on ONE build — a before/after only measures
 *  the change if both halves ran against the same thing. `App` flips it on. */
let enabled = false;
export function enableOffscreenRows(on = true) { enabled = !!on; emit(); }
export function offscreenRowsEnabled() {
  if (typeof window !== "undefined" && window.__offscreenRows === false) return false;
  if (typeof window !== "undefined" && window.__offscreenRows === true) return true;
  return enabled;
}

const _hidden = new Set();     // panel ids whose rows are not mounted
const _listeners = new Set();
// `jumpToOccurrence` finds an occurrence by DOM query and reports "filtered
// out" when it misses. A row we have unmounted would make that a LIE — the same
// hazard `renderWindow` documents and solves with this event, so we answer it
// too: everything mounts until the next cell switch republishes.
let _renderAll = false;

function emit() { for (const l of _listeners) l(); }

if (typeof window !== "undefined") {
  window.addEventListener(RENDER_ALL_EVENT, () => { _renderAll = true; emit(); });
}

/**
 * Does `panel` (a placement: row/col/width/height) cover the active cell?
 * Spans count — a 2-high panel is on screen from either of its cells.
 * Exported because this predicate is the whole decision and mounting a panel to
 * test it is not an option.
 */
export function panelCoversCell(panel, cell) {
  if (!panel || !cell) return true;              // unknown → keep it mounted
  const r0 = panel.row ?? 0, c0 = panel.col ?? 0;
  const r1 = r0 + Math.max(1, panel.height ?? 1) - 1;
  const c1 = c0 + Math.max(1, panel.width ?? 1) - 1;
  return (cell.row ?? 0) >= r0 && (cell.row ?? 0) <= r1
      && (cell.col ?? 0) >= c0 && (cell.col ?? 0) <= c1;
}

/**
 * Should this panel's rows be skipped?
 *
 * Every "no" here is a case where skipping would hide something the user can
 * see: desktop lays all the panels out at once, and the zoomed-out picker shows
 * every cell scaled down — blanking the rows there would empty the map you are
 * choosing from.
 */
export function shouldHidePanelRows(panel, cell, { isMobileLayout, zoomedOut } = {}) {
  if (!offscreenRowsEnabled()) return false;
  if (!isMobileLayout || zoomedOut) return false;
  return !panelCoversCell(panel, cell);
}

// ── DEFERRED MODE: THE TAP PAYS NEITHER THE UNMOUNT NOR THE MOUNT ─────────
// Applying the change inside the tap's own commit is what cost 1,700ms above:
// the departing panel unmounts ~93 rows and the arriving one mounts ~93, both
// before the browser is allowed to paint. Neither is needed in that frame —
// the departing panel is already off screen, and the arriving one has its
// chrome. So every change lands AFTER the paint, which is the same trade
// staged loading already makes on the initial load (helpers/stagedMount.js).
//
// The cost is honest and is the reason this is a switch rather than a default:
// the panel you land on shows its containers with no rows for one frame.
let deferred = false;
export function setOffscreenRowsDeferred(on = true) { deferred = !!on; }
export function offscreenRowsDeferred() {
  if (typeof window !== "undefined" && window.__offscreenRowsDefer === false) return false;
  if (typeof window !== "undefined" && window.__offscreenRowsDefer === true) return true;
  return deferred;
}

// One pending application per panel. A second tap before the first has landed
// REPLACES it rather than queueing — otherwise a fast back-and-forth applies a
// stale decision after the newer one and the wrong panel goes blank.
const _pending = new Map();   // panelId -> cancel fn

function applyNow(panelId, hidden) {
  const was = _hidden.has(panelId);
  if (was === !!hidden) return;
  if (hidden) _hidden.add(panelId); else _hidden.delete(panelId);
  // A fresh publish means the grid moved, so a previous search's "show me
  // everything" has served its purpose and should not pin the grid open.
  _renderAll = false;
  emit();
}

/** Publish one panel's decision. No-op when unchanged, so a panel re-rendering
 *  for an unrelated reason never wakes its containers. */
export function publishPanelRowsHidden(panelId, hidden) {
  if (!panelId) return;
  _pending.get(panelId)?.();
  _pending.delete(panelId);
  if (!offscreenRowsDeferred()) { applyNow(panelId, hidden); return; }
  const cancel = afterPaint(() => { _pending.delete(panelId); applyNow(panelId, hidden); });
  _pending.set(panelId, cancel);
}

function subscribe(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

/** True when this panel's rows should not be mounted. */
export function usePanelRowsHidden(panelId) {
  return useSyncExternalStore(
    subscribe,
    () => (!_renderAll && !!panelId && _hidden.has(panelId)),
    () => false,                    // server render: mount everything
  );
}

/** Test seam — the store is module state and each test needs a clean one. */
export function _resetOffscreenRows() {
  for (const c of _pending.values()) c();
  _pending.clear();
  _hidden.clear(); _renderAll = false; enabled = false; deferred = false;
  if (typeof window !== "undefined") {
    delete window.__offscreenRows;
    delete window.__offscreenRowsDefer;
  }
}
