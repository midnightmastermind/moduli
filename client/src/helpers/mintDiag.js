// helpers/mintDiag.js
//
// `[mint]` — attribution for the click-an-empty-line → textblock path, BOTH ways:
// the block being minted, and the block going away again.
//
// User, 2026-08-06: *"why creating a textblock via clicking an empty line takes
// so long. it should be instant"*, and *"really audit what takes so long."*
// Measured on the real app before touching anything: **958ms** from click to the
// block existing in the DOM, of which the browser's own event handling is the
// first 24ms. The remaining ~930ms had no owner — hence these marks, which name
// each step of the path on one clock so "slow" can be attributed rather than
// described. Same posture as `scrollDiag` / `loadDiag`: OFF unless
// `window.__mintDiag === true`, and a no-op boolean check when off.
//
// 2026-09-17: it recorded into `window.__mintMarks` and NEVER PRINTED, so using
// it meant knowing to type `console.table(window.__mintMarks)` — on a report
// whose whole value is one click from the person seeing the bug. It prints
// itself now, once the gesture settles.
//
// It also only ever covered the MINT. A click-minted block that is still empty
// when you move away is supposed to remove itself, and that path — focus, blur,
// `handleEmptyBlur` — had no marks at all, which is exactly the half that is
// unexplained (CLAUDE.md 2026-09-17 (5): "the click-off case goes through
// `handleEmptyBlur` ... and is NOT explained"). A block only blurs if it
// focused first, so the marks name both.

// ON BY DEFAULT (`window.__mintDiag = false` mutes). The same posture `[tb]`,
// `[gap]` and caretDiag take for a live user-facing bug: a report should cost the
// person seeing it no setup. User, 2026-09-18: *"put in console logs to
// diagnose."*
const on = () => typeof window !== "undefined" && window.__mintDiag !== false;

/** Zero the clock (the gesture that starts a mint attempt). */
export function startMintTimer(label = "gesture") {
  if (!on()) return;
  window.__mintMarks = [];
  window.__mintT0 = performance.now();
  mintMark(label);
}

export function mintMark(label, extra) {
  if (!on()) return;
  if (window.__mintT0 == null) { window.__mintT0 = performance.now(); window.__mintMarks = []; }
  (window.__mintMarks = window.__mintMarks || []).push({
    t: +(performance.now() - window.__mintT0).toFixed(1), label, ...(extra || {}),
  });
  scheduleFlush();
}

// One table per gesture. The window is longer than the vanish path's own
// `setTimeout(..., 0)` hops so a mint and the blur that undoes it land in the
// SAME table — reading those apart is what made this hard to attribute.
const FLUSH_AFTER_MS = 1200;
let flushTimer = 0;

function scheduleFlush() {
  if (typeof window === "undefined") return;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushMintMarks, FLUSH_AFTER_MS);
}

/** Print what has been recorded and start a fresh clock. Safe to call by hand. */
export function flushMintMarks() {
  if (typeof window === "undefined") return;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
  const marks = window.__mintMarks;
  window.__mintMarks = [];
  window.__mintT0 = null;
  if (!marks || marks.length === 0) return;
  // console.table because these are uniform rows and the columns are what
  // discriminate — the repo's standing preference for a diagnostic.
  console.table(marks);
}

/** Time one synchronous step and record it. Returns the callback's value. */
export function mintStep(label, fn) {
  if (!on()) return fn();
  const a = performance.now();
  const out = fn();
  mintMark(label, { ms: +(performance.now() - a).toFixed(1) });
  return out;
}
