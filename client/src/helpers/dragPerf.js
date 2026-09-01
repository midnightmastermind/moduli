// helpers/dragPerf.js
// ============================================================
// DRAG PERFORMANCE — ALL THREE PHASES, REPORTED WHERE THEY CAN BE READ.
//
// User, 2026-09-01: *"dragging an instance is taking forever to start up and
// then is just jittery around the grid (non smooth at all), its like its
// freezing up during the drag. the drop takes a bit too."* — and, correcting
// me when I claimed the middle phase was already covered: *"i called out the
// entire performace of the drag so during too its terrible."*
//
// This probe already measured the DURING phase (fps, frame times, hit-test
// cost) and logged one summary per drag. It measured nothing about STARTING or
// DROPPING, which are two of the three complaints — and the summary went to
// `console.log` only, so on the device that has the problem nobody could read
// it and it never reached the server. Instrumented is not the same as measured.
//
// Now: every phase, one copy-pasteable line, and the same line to the server so
// it lands in the pm2 log (helpers/scrollDiag.js does this for scrolling; the
// server prints `d.line` verbatim, so the two cannot drift).
//
//   window.__dragPerf = true   // force on (desktop too)
//   window.__dragPerf = false  // force off
//   window.__dragReport()      // reprint the last summary
//
// WHAT EACH PHASE ANSWERS:
//   start   — how much of "forever to start" is the deliberate hold delay,
//             and how much is our own work at threshold-cross. `setIsDragging`
//             and `handleDragStart` are React state updates on a grid with
//             ~18,600 DOM nodes.
//   during  — fps and the worst frame. `renders`/`opSweeps` say whether a
//             stall is the app re-rendering rather than the pointer maths.
//   drop    — touchend → handler returned → the frame the user sees.
// ============================================================
import { socket } from "../socket.js";
import { safeEmit } from "./offlineQueue.js";

const s = {
  active: false, t0: 0,
  tTouch: 0, tActivate: 0, tStarted: 0, tFirstPaint: 0,
  tDrop: 0, tDropDone: 0, tDropPaint: 0,
  moves: 0, frames: 0,
  onMoveTotal: 0, onMoveMax: 0,
  rafTotal: 0, rafMax: 0,
  hitTotal: 0, hitCount: 0, hitMax: 0,
  long16: 0, long32: 0,
  tally0: null, longTasks: 0, longTaskMs: 0, po: null,
  label: "", mode: "",
};
let last = null;

function enabled() {
  if (typeof window === "undefined") return false;
  if (window.__dragPerf === false) return false;
  if (window.__dragPerf === true) return true;
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
}

// rAF then a macrotask — a rAF callback runs BEFORE that frame's paint, so
// timing one measures the frame the work was scheduled in, not the frame the
// user saw. Same idiom as helpers/afterPaint.js, inlined to keep this probe
// dependency-light.
function afterNextPaint(fn) {
  if (typeof requestAnimationFrame !== "function") { setTimeout(fn, 16); return; }
  requestAnimationFrame(() => setTimeout(fn, 0));
}

export const dragPerf = {
  // touchstart — BEFORE the hold delay and the movement threshold, so the
  // deliberate wait is separable from our own cost. Without this split
  // "forever to start" cannot be told from "we make you hold for 80ms".
  touchStart() {
    if (!enabled()) return;
    s.tTouch = performance.now();
  },

  // The threshold was crossed: everything after this is work we chose to do.
  activate() {
    if (!enabled()) return;
    s.tActivate = performance.now();
  },

  start(meta = {}) {
    if (!enabled()) { s.active = false; return; }
    const now = performance.now();
    Object.assign(s, {
      active: true, t0: now, tStarted: now, tFirstPaint: 0,
      tDrop: 0, tDropDone: 0, tDropPaint: 0,
      moves: 0, frames: 0, onMoveTotal: 0, onMoveMax: 0,
      rafTotal: 0, rafMax: 0, hitTotal: 0, hitCount: 0, hitMax: 0,
      long16: 0, long32: 0, longTasks: 0, longTaskMs: 0,
      label: meta.label || "", mode: meta.mode || "",
      tally0: (typeof window !== "undefined" && window.__renderTally) ? window.__renderTally() : null,
    });
    // The frame the user actually sees the drag begin on.
    afterNextPaint(() => { if (s.active && !s.tFirstPaint) s.tFirstPaint = performance.now(); });
    try {
      s.po?.disconnect();
      s.po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) { s.longTasks++; s.longTaskMs += e.duration; }
      });
      s.po.observe({ entryTypes: ["longtask"] });
    } catch { s.po = null; }   // not implemented everywhere; absent ≠ zero
  },

  move(dt) {
    if (!s.active) return;
    s.moves++;
    s.onMoveTotal += dt;
    if (dt > s.onMoveMax) s.onMoveMax = dt;
  },
  hit(dt) {
    if (!s.active) return;
    s.hitCount++; s.hitTotal += dt;
    if (dt > s.hitMax) s.hitMax = dt;
  },
  frame(dt) {
    if (!s.active) return;
    s.frames++;
    s.rafTotal += dt;
    if (dt > s.rafMax) s.rafMax = dt;
    if (dt > 16.7) s.long16++;
    if (dt > 32) s.long32++;
  },

  // touchend, before the drop handler runs.
  dropStart() { if (s.active) s.tDrop = performance.now(); },
  // the drop handler returned — the write is dispatched, the paint is not done.
  dropDone() { if (s.active) s.tDropDone = performance.now(); },

  end() {
    if (!s.active) return;
    s.active = false;
    try { s.po?.disconnect(); } catch { /* ignore */ }
    const dur = performance.now() - s.t0;
    if (dur < 40 && !s.tDrop) return;   // a tap, not a drag

    // SNAPSHOT SYNCHRONOUSLY. The report waits a frame for the drop's paint,
    // and everything below used to read `s` from inside that callback — so a
    // second gesture starting in the meantime rewrote the numbers under it.
    // The first capture off the tablet showed two drags with byte-identical
    // START figures (hold=183ms work=2000ms paint=403ms) and wildly different
    // durations, which is not something two real drags can do.
    const f = { ...s };
    afterNextPaint(() => {
      f.tDropPaint = performance.now();
      const avg = (tot, n) => (n ? +(tot / n).toFixed(1) : 0);
      const d = (a, b) => (a && b ? Math.round(b - a) : -1);
      const tally = (typeof window !== "undefined" && window.__renderDiff && f.tally0)
        ? window.__renderDiff(f.tally0) : null;
      const rTot = tally ? Object.values(tally.renders || {}).reduce((a, n) => a + n, 0) : -1;
      const rTop = tally
        ? Object.entries(tally.renders || {}).filter(([, n]) => n)
          .sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k}:${n}`).join(",")
        : "";

      const line = `[drag] ${Math.round(dur)}ms "${f.label}" mode=${f.mode}`
        + ` | START hold=${d(f.tTouch, f.tActivate)}ms work=${d(f.tActivate, f.tStarted)}ms`
        + ` paint=${d(f.tStarted, f.tFirstPaint)}ms`
        + ` | DURING moves=${f.moves} frames=${f.frames}`
        + ` fps=${dur ? Math.round(f.frames / (dur / 1000)) : 0}`
        + ` onMove avg=${avg(f.onMoveTotal, f.moves)}/max=${+f.onMoveMax.toFixed(1)}ms`
        + ` raf avg=${avg(f.rafTotal, f.frames)}/max=${+f.rafMax.toFixed(1)}ms`
        + ` hit avg=${avg(f.hitTotal, f.hitCount)}/max=${+f.hitMax.toFixed(1)}ms`
        + ` over16=${f.long16} over32=${f.long32}`
        + ` | DROP handler=${d(f.tDrop, f.tDropDone)}ms paint=${d(f.tDropDone, f.tDropPaint)}ms`
        + ` | renders=${rTot}${rTop ? `(${rTop})` : ""}`
        + ` opSweeps=${tally?.ops?.runs ?? -1} opMs=${Math.round(tally?.ops?.ms ?? -1)}`
        + ` longTasks=${f.longTasks}(${Math.round(f.longTaskMs)}ms)`
        + ` dom=${typeof document !== "undefined" ? document.getElementsByTagName("*").length : -1}`
        // WAS THE GRID SETTLED WHEN THIS DRAG STARTED? The first capture read
        // 5,790 renders and 23 op sweeps during a drag — within noise of what
        // an idle LOAD produces (3,794 / 23-25), so "the drag is slow" and
        // "everything is slow because the load is still draining" are not
        // separable without this. Milliseconds since the page began.
        + ` sinceLoad=${Math.round(f.tStarted)}ms`;

      last = line;
      // eslint-disable-next-line no-console
      console.log(line);
      // AND TO THE SERVER, because the device with the problem is the one
      // whose console is hardest to read. The server prints `line` verbatim.
      try {
        safeEmit(socket, "save_scroll_diag", {
          line, kind: "drag",
          ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
        });
      } catch { /* a probe must never break the gesture it measures */ }
    });
  },
};

if (typeof window !== "undefined") {
  window.__dragReport = () => { console.log(last || "[drag] nothing captured yet"); return last; };
}
