// helpers/mintDiag.js
//
// `[mint]` — attribution for the click-an-empty-line → textblock path.
//
// User, 2026-08-06: *"why creating a textblock via clicking an empty line takes
// so long. it should be instant"*, and *"really audit what takes so long."*
// Measured on the real app before touching anything: **958ms** from click to the
// block existing in the DOM, of which the browser's own event handling is the
// first 24ms. The remaining ~930ms had no owner — hence these marks, which name
// each step of the path on one clock so "slow" can be attributed rather than
// described. Same posture as `scrollDiag` / `loadDiag`: OFF unless
// `window.__mintDiag === true`, and a no-op boolean check when off.

const on = () => typeof window !== "undefined" && window.__mintDiag === true;

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
}

/** Time one synchronous step and record it. Returns the callback's value. */
export function mintStep(label, fn) {
  if (!on()) return fn();
  const a = performance.now();
  const out = fn();
  mintMark(label, { ms: +(performance.now() - a).toFixed(1) });
  return out;
}
