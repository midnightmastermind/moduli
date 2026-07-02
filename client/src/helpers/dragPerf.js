// helpers/dragPerf.js
// ============================================================
// Lightweight, opt-in drag performance probe.
//
// Logs ONE compact summary per drag (on drop) — never per-frame — so it's
// cheap and safe to leave on. Defaults ON for coarse-pointer/touch devices so
// it works on a tablet with no console flag-setting. Override with:
//   window.__dragPerf = true   // force on (desktop too)
//   window.__dragPerf = false  // force off
//
// Read the summary in the browser console (remote-inspect the tablet, or an
// on-device console). Key numbers:
//   fps            — rAF frames / drag duration. Want ~60.
//   rafMove_maxMs  — worst single frame of the touch mover. >16ms = a dropped frame.
//   framesOver16ms — how many frames blew the 60fps budget.
//   hitTest_maxMs  — worst elementsFromPoint drop-target scan.
// ============================================================

const s = {
  active: false, t0: 0,
  moves: 0, frames: 0,
  onMoveTotal: 0, onMoveMax: 0,
  rafTotal: 0, rafMax: 0,
  hitTotal: 0, hitCount: 0, hitMax: 0,
  long16: 0, long32: 0,
};

function enabled() {
  if (typeof window === "undefined") return false;
  if (window.__dragPerf === false) return false;
  if (window.__dragPerf === true) return true;
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

export const dragPerf = {
  start() {
    if (!enabled()) { s.active = false; return; }
    Object.assign(s, {
      active: true, t0: performance.now(),
      moves: 0, frames: 0, onMoveTotal: 0, onMoveMax: 0,
      rafTotal: 0, rafMax: 0, hitTotal: 0, hitCount: 0, hitMax: 0,
      long16: 0, long32: 0,
    });
  },
  // Time spent in one touchmove handler (active drag only).
  move(dt) {
    if (!s.active) return;
    s.moves++;
    s.onMoveTotal += dt;
    if (dt > s.onMoveMax) s.onMoveMax = dt;
  },
  // Time spent in one _findDropTarget hit-test.
  hit(dt) {
    if (!s.active) return;
    s.hitCount++; s.hitTotal += dt;
    if (dt > s.hitMax) s.hitMax = dt;
  },
  // Time spent in one handleDragMove rAF frame (the touch mover).
  frame(dt) {
    if (!s.active) return;
    s.frames++;
    s.rafTotal += dt;
    if (dt > s.rafMax) s.rafMax = dt;
    if (dt > 16.7) s.long16++;
    if (dt > 32) s.long32++;
  },
  end() {
    if (!s.active) return;
    s.active = false;
    const dur = performance.now() - s.t0;
    if (dur < 40) return; // ignore taps / micro-drags
    const avg = (tot, n) => (n ? +(tot / n).toFixed(2) : 0);
    // eslint-disable-next-line no-console
    console.log(
      `%c[dragPerf] ${dur.toFixed(0)}ms drag`,
      "color:#4af;font-weight:bold",
      {
        touchmoves: s.moves,
        rafFrames: s.frames,
        fps: (dur ? +(s.frames / (dur / 1000)).toFixed(0) : 0),
        onMove_avgMs: avg(s.onMoveTotal, s.moves),
        onMove_maxMs: +s.onMoveMax.toFixed(2),
        rafMove_avgMs: avg(s.rafTotal, s.frames),
        rafMove_maxMs: +s.rafMax.toFixed(2),
        hitTest_avgMs: avg(s.hitTotal, s.hitCount),
        hitTest_maxMs: +s.hitMax.toFixed(2),
        framesOver16ms: s.long16,
        framesOver32ms: s.long32,
      }
    );
  },
};
