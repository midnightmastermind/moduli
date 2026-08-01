// helpers/gapHover.js
//
// Owns "is the pointer over this insert gap" in JS instead of CSS `:hover`.
//
// WHY: a browser only re-computes `:hover` when the pointer MOVES. Moduli
// reflows constantly under a stationary pointer — the on-load op drain alone is
// ~580ms and 124 effects — so a gap that was hovered keeps `:hover` after the
// layout shifts out from under the cursor, and the highlight stays lit until
// the user moves back over it and away (their words: "if i go back over the
// highlight, it disappears again"). Nothing in CSS can correct that; a JS flag
// can, because we can re-test the pointer against the element's CURRENT rect
// whenever the layout may have moved.
//
// One document listener + one rAF-throttled check, shared by every gap.

let activeEl = null;
let activeSet = null;   // setter for the element that currently claims hover
let lastX = 0, lastY = 0;
let installed = false;
let queued = false;

function inRect(el, x, y) {
  const r = el.getBoundingClientRect();
  return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}

/** Drop the claim when the pointer is no longer inside the claiming element. */
function verify() {
  queued = false;
  if (!activeEl || !activeEl.isConnected) { release(); return; }
  if (!inRect(activeEl, lastX, lastY)) release();
}

function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(verify);
}

function release() {
  if (activeSet) activeSet(false);
  activeEl = null;
  activeSet = null;
}

function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  document.addEventListener("pointermove", (e) => {
    lastX = e.clientX; lastY = e.clientY;
    if (activeEl) schedule();
  }, { passive: true, capture: true });
  // Re-test after any layout change too — this is the case `:hover` cannot see.
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => { if (activeEl) schedule(); });
    ro.observe(document.documentElement);
  }
  document.addEventListener("scroll", () => { if (activeEl) schedule(); }, { passive: true, capture: true });
  // The pointer leaving the window can never be "still inside" anything.
  document.addEventListener("pointerleave", release, { passive: true });
}

/** Claim hover for `el`; any previous claimant is released. */
export function claimGapHover(el, setHot) {
  install();
  if (activeEl && activeEl !== el) release();
  activeEl = el;
  activeSet = setHot;
  setHot(true);
}

/** Release `el`'s claim (pointerleave). */
export function releaseGapHover(el) {
  if (activeEl === el) release();
}

/** Periodic safety net: nothing may stay hot without a live claim. */
if (typeof window !== "undefined") {
  setInterval(() => {
    if (activeEl) { schedule(); return; }
    for (const el of document.querySelectorAll(".insert-gap--hot")) {
      el.classList.remove("insert-gap--hot"); // orphaned by an unmount/remount
    }
  }, 1000);
}


// ── Generic region watch ──────────────────────────────────────────────────
// Same physics, different owner: the DOC gap (`.doc-insert-gap`, rendered by
// ui/Editor.jsx from its own `docGap` state) clears on the wrapper's
// `mouseleave`, which does NOT fire when the layout shifts out from under a
// stationary pointer. So a doc gap could stay lit for exactly the same reason
// the board gap did — and it lives inside the doc bodies, which is where the
// user's screenshot showed the stuck bars.
//
// `watchRegion(el, onLeave)` calls `onLeave()` as soon as the pointer is no
// longer inside `el`'s CURRENT rect, re-checked on pointer move, scroll and
// resize. Returns an unsubscribe.
const regions = new Set();

function checkRegions() {
  for (const r of [...regions]) {
    if (!r.el?.isConnected) { regions.delete(r); r.onLeave(); continue; }
    const b = r.el.getBoundingClientRect();
    if (!(lastX >= b.left && lastX <= b.right && lastY >= b.top && lastY <= b.bottom)) {
      regions.delete(r);
      r.onLeave();
    }
  }
}

export function watchRegion(el, onLeave) {
  if (!el) return () => {};
  install();
  const rec = { el, onLeave };
  regions.add(rec);
  return () => regions.delete(rec);
}

if (typeof window !== "undefined") {
  document.addEventListener("pointermove", (e) => {
    lastX = e.clientX; lastY = e.clientY;
    if (regions.size) checkRegions();
  }, { passive: true, capture: true });
  document.addEventListener("scroll", () => { if (regions.size) checkRegions(); }, { passive: true, capture: true });
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => { if (regions.size) checkRegions(); }).observe(document.documentElement);
  }
}
