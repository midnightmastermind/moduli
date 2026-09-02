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
  tTouch: 0, tActivate: 0, tStarted: 0, tFirstPaint: 0, touchRectMs: -1, holdScrolls: -1, via: "?",
  attributing: false,
  marks: null, attr0: null, attrWas: undefined,
  tDrop: 0, tDropDone: 0, tDropPaint: 0,
  moves: 0, frames: 0,
  onMoveTotal: 0, onMoveMax: 0,
  moveBy: {}, autoscrolling: false,
  rafTotal: 0, rafMax: 0,
  hitTotal: 0, hitCount: 0, hitMax: 0,
  efpTotal: 0, efpMax: 0, walkTotal: 0, walkMax: 0, elsMax: 0, dropTargets: 0,
  long16: 0, long32: 0,
  tally0: null, tallyDrop: null, longTasks: 0, longTaskMs: 0, po: null,
  firstTaskMs: -1, firstTaskAt: -1,
  label: "", mode: "",
};
let last = null;
// The forced-flush attribution runs on the FIRST drag of a page load only.
let attributedOnce = false;

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
  // `rectMs` is how long the rect read dragSystem already takes at touchstart
  // took — i.e. THE COST OF ONE FORCED LAYOUT, before the hold delay and
  // before we have written anything to the document.
  //
  // It exists to answer the question the drag-start reorder raised and could
  // not settle: reading the grid rect first changed nothing (1,036ms), so the
  // page was already dirty when the gesture began. This says whether it was
  // dirty at the FIRST TOUCH too. Dirty at touch means the cost belongs to
  // whatever the app was doing beforehand — the scroll repaint is the
  // candidate — and not to the drag at all; clean at touch means something in
  // the hold window dirties it, and the hold window is ours to look at.
  //
  // The read is not added FOR the probe: dragSystem has always taken it there
  // ("cache rect NOW while layout is fresh"), so this measures a cost we were
  // already paying rather than introducing one.
  touchStart(rectMs = -1) {
    if (!enabled()) return;
    s.tTouch = performance.now();
    s.touchRectMs = rectMs;
  },

  // The threshold was crossed: everything after this is work we chose to do.
  //
  // `scrolls` is how many scroll events fired while the finger was down. It
  // is the discriminator for the startup cost that SURVIVED the fix: one
  // forced layout costs 0.1ms at touchstart and ~1s at activation, so the page
  // is dirtied inside the hold window — by the panel scrolling under the
  // finger, or by our own writes. Non-zero says scroll; zero says us. Neither
  // reading requires forcing a layout to obtain, which is the point: the
  // instrument must not re-introduce the cost it is measuring.
  // `via` says WHICH path lifted the drag: the hold timer, or the finger
  // crossing the movement threshold. Without it `hold` is two different
  // numbers wearing one name — the wait WE impose, and the wait until the
  // user happened to move — and reading the second as the first is exactly
  // the mistake that let a 1s startup complaint survive a fixed startup.
  // A capture reading `via=move hold=2588` is a user who held still and got
  // nothing; `via=lift hold=220` is the timer doing its job.
  activate(scrolls = -1, via = "?") {
    if (!enabled()) return;
    s.tActivate = performance.now();
    s.holdScrolls = scrolls;
    s.via = via;
    s.marks = [];
    // OPT-IN NOW (`window.__dragAttr = true`), once per page load.
    //
    // It found what it was built for — `f:touchAction:903` out of a 961ms
    // startup, with `f:t0:0` proving the page was clean before it and
    // `f:overscroll:3` on the same element proving it was that property and
    // not that element. With the write gone, leaving it on costs the first
    // drag after every reload eight forced style/layout flushes, and it
    // DISTORTS the very number now left to explain: forcing flushes changes
    // when the paint happens, so `paint` cannot be read off an attribution
    // run at all.
    //
    // Kept rather than deleted, because the next unattributable second will
    // want it and it is a bounded, proven instrument. Same course as
    // `caretDiag` and `scrollDiag` once their fixes were verified.
    s.attributing = !attributedOnce
      && typeof window !== "undefined" && window.__dragAttr === true;
    if (s.attributing) attributedOnce = true;
  },

  // WHICH PART OF THE ACTIVATION COSTS THE SECOND. `work` measures the whole
  // block between the threshold crossing and `handleDragStart` returning, and
  // on the user's tablet that is 916-1044ms against 10-26ms on Firefox. Inside
  // it are a React state update (`setIsDragging`), the payload build, the pill,
  // and `handleDragStart` — which itself opens a session, spawns edge barriers
  // and hit-tests for the cell. One number cannot say which.
  mark(name) {
    if (!s.marks) return;
    s.marks.push([name, performance.now()]);
  },

  // ATTRIBUTE THE ~1.1s TASK TO THE WRITE THAT CAUSES IT.
  //
  // The measurement so far: `holdScrolls=0` (the page never scrolled under the
  // finger, so the repaint theory is dead and the cause is ours),
  // `touchRect=0.1ms` (clean when the finger landed), `work=1-4ms` of JS, and
  // then ONE long task of 1,102-1,170ms. So ~1.1s of style/layout/paint is
  // provoked by something we write at activation, and there are five
  // candidates, each one line: the `<html>` inline style, `setIsDragging`, the
  // pill append, four edge barriers, and `body.dataset.dragKind` — which
  // `index.css` matches with `body[data-drag-kind="panel"] .container-shell`,
  // an ancestor-attribute selector that invalidates style document-wide.
  //
  // A forced flush after each one bills that write for its own invalidation,
  // so the FIRST expensive segment names the cause. This deliberately makes
  // the drag slower while it runs — it converts one deferred pass into
  // several — which is why it is ONCE PER PAGE LOAD: the answer needs one
  // drag, and the second drag should not pay for it.
  //
  // React state updates flush asynchronously, so their segments read ~0 by
  // construction. That is not a gap: if every forced segment is cheap and
  // `paint` is still ~1.1s, the cost is the React render and its layout, and
  // that is the answer rather than a missing measurement.
  flushMark(name) {
    if (!s.marks || !s.attributing) return;
    if (typeof document !== "undefined") void document.body.offsetHeight;
    s.marks.push([name, performance.now()]);
  },

  start(meta = {}) {
    if (!enabled()) { s.active = false; return; }
    const now = performance.now();
    Object.assign(s, {
      active: true, t0: now, tStarted: now, tFirstPaint: 0,
      tDrop: 0, tDropDone: 0, tDropPaint: 0,
      moves: 0, frames: 0, onMoveTotal: 0, onMoveMax: 0, moveBy: {}, autoscrolling: false,
      rafTotal: 0, rafMax: 0, hitTotal: 0, hitCount: 0, hitMax: 0,
      efpTotal: 0, efpMax: 0, walkTotal: 0, walkMax: 0, elsMax: 0, dropTargets: 0,
      long16: 0, long32: 0, longTasks: 0, longTaskMs: 0,
      firstTaskMs: -1, firstTaskAt: -1,
      label: meta.label || "", mode: meta.mode || "",
      tally0: (typeof window !== "undefined" && window.__renderTally) ? window.__renderTally() : null,
      tallyDrop: null,
      // Render CAUSES for the drag window. ARMED HERE AND DISARMED AT THE END,
      // rather than asking the user to set `window.__RENDER_ATTR` by hand: they
      // did, twice, and it came back empty both times — the likeliest reason
      // being that the reload which fetched the new build cleared it. A
      // diagnostic that depends on a manual step surviving a page load is a
      // diagnostic that does not run.
      //
      // The cost is one changed-key comparison per render, bounded to the
      // gesture, and only while `dragPerf` itself is enabled (touch by
      // default). Anything the caller set explicitly is restored afterwards.
      attr0: (typeof window !== "undefined" && window.__renderAttrs) ? window.__renderAttrs() : null,
      attrWas: typeof window !== "undefined" ? window.__RENDER_ATTR : undefined,
    });
    if (typeof window !== "undefined") window.__RENDER_ATTR = true;
    // The frame the user actually sees the drag begin on.
    afterNextPaint(() => { if (s.active && !s.tFirstPaint) s.tFirstPaint = performance.now(); });
    try {
      s.po?.disconnect();
      s.po = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          s.longTasks++; s.longTaskMs += e.duration;
          // THE FIRST ONE, kept separately. `paint=1183ms` is the wait before
          // the drag is visible, and one 1.2s task and forty 30ms ones are
          // different problems with different fixes — a total cannot tell them
          // apart. Offset from drag start, so it can be lined up against the
          // marks rather than guessed at.
          if (s.firstTaskMs < 0) {
            s.firstTaskMs = e.duration;
            s.firstTaskAt = e.startTime - s.t0;
          }
        }
      });
      s.po.observe({ entryTypes: ["longtask"] });
    } catch { s.po = null; }   // not implemented everywhere; absent ≠ zero
  },

  // `dt` alone is a drag-wide average, and the user's report is that the cost
  // varies WITHIN a drag: "it only jitters when its passing over other
  // instances ... dragging over empty containers is faster" (2026-09-02). An
  // average cannot answer that — two hypotheses were falsified against it
  // before this existed (instance re-renders measured 0 across 12 crossings
  // with a live counter as the control; `elementsFromPoint` measured 12.4ms
  // over a row against 12.5ms over empty space). So the move is bucketed by
  // WHAT THE POINTER WAS OVER, and the report prints the buckets.
  /** Edge autoscroll started / stopped. Diagnostic only. */
  setAutoscrolling(on) { if (s.active) s.autoscrolling = !!on; },

  move(dt, over) {
    if (!s.active) return;
    s.moves++;
    s.onMoveTotal += dt;
    if (dt > s.onMoveMax) s.onMoveMax = dt;
    // AUTOSCROLL IS ITS OWN DIMENSION. User, 2026-09-02: "it still jitters from
    // something as i scroll down with the drag." While the edge autoscroll loop
    // runs, every frame scrolls the container AND re-runs the hit-test AND
    // repositions the indicators — and scrolling invalidates every cached rect
    // (2026-09-01 (6)). A bucket that mixes those moves with ordinary ones
    // averages the two together and answers nothing.
    const k = (over || "unknown") + (s.autoscrolling ? "+scroll" : "");
    const b = (s.moveBy[k] ||= { n: 0, total: 0, max: 0 });
    b.n++; b.total += dt;
    if (dt > b.max) b.max = dt;
  },
  hit(dt) {
    if (!s.active) return;
    s.hitCount++; s.hitTotal += dt;
    if (dt > s.hitMax) s.hitMax = dt;
  },
  // WHICH HALF of the hit-test. `elementsFromPoint` forces a document-wide
  // hit-test; the registry walk is a Map.get per ancestor. Same total, opposite
  // fixes — and "the drop points are what is slow" is only answerable with
  // both, plus how many are registered.
  hitParts(efp, walk, nEls, nTargets) {
    if (!s.active) return;
    s.efpTotal += efp; if (efp > s.efpMax) s.efpMax = efp;
    s.walkTotal += walk; if (walk > s.walkMax) s.walkMax = walk;
    if (nEls > s.elsMax) s.elsMax = nEls;
    s.dropTargets = nTargets;
  },
  frame(dt) {
    if (!s.active) return;
    s.frames++;
    s.rafTotal += dt;
    if (dt > s.rafMax) s.rafMax = dt;
    if (dt > 16.7) s.long16++;
    if (dt > 32) s.long32++;
  },

  // touchend, before the drop handler runs. The render tally is snapshotted
  // HERE so the drop's own fan-out can be separated from the drag's: a drop
  // paint of 1,842-5,302ms is either the write's re-render or the browser
  // painting a 20,000-node document, and those are different fixes.
  dropStart() {
    if (!s.active) return;
    s.tDrop = performance.now();
    s.tallyDrop = (typeof window !== "undefined" && window.__renderTally) ? window.__renderTally() : null;
  },
  // the drop handler returned — the write is dispatched, the paint is not done.
  dropDone() { if (s.active) s.tDropDone = performance.now(); },

  end() {
    if (!s.active) return;
    s.active = false;
    // Restore whatever the caller had — off by default, but a developer who
    // switched it on deliberately keeps it on.
    if (typeof window !== "undefined") window.__RENDER_ATTR = s.attrWas;
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

      // BUILT INSIDE A GUARD. Two inline expressions were added to this string
      // (the startup breakdown and the render causes) with nothing around
      // them, and the console.log AND the socket emit both come after it — so
      // a throw in either took the whole report with it, silently. Measured
      // 2026-09-01: five client connects after the deploy and ZERO drag lines,
      // on a build whose code was verified present in the served bundle. A
      // diagnostic that can vanish is worse than one that reports less.
      let line;
      try {
        line = `[drag] ${Math.round(dur)}ms "${f.label}" mode=${f.mode}`
          + ` | START touchRect=${f.touchRectMs >= 0 ? +f.touchRectMs.toFixed(1) : -1}ms`
          + ` holdScrolls=${f.holdScrolls}`
          + ` hold=${d(f.tTouch, f.tActivate)}ms via=${f.via} work=${d(f.tActivate, f.tStarted)}ms`
          + ` paint=${d(f.tStarted, f.tFirstPaint)}ms`
          + `${(() => {
              if (!f.marks || f.marks.length < 2) return "";
              const out = [];
              for (let i = 1; i < f.marks.length; i++) {
                const ms = Math.round(f.marks[i][1] - f.marks[i - 1][1]);
                // ORDINARY marks print only when they cost something — the
                // startup breakdown is meant to name the expensive one.
                //
                // AN ATTRIBUTION PASS IS THE OPPOSITE: four of the five writes
                // are expected to be free, and each zero EXONERATES one
                // candidate. Filtering them would print an exoneration and a
                // mark that never ran as the same thing — absent read as
                // measured — and that is precisely the confusion this pass
                // exists to resolve. So while attributing, every segment
                // prints, zeros included.
                if (ms > 0 || f.attributing) out.push(`${f.marks[i][0]}:${ms}`);
              }
              return out.length ? ` [${out.join(" ")}]` : "";
            })()}`
          + ` | DURING moves=${f.moves} frames=${f.frames}`
          + ` fps=${dur ? Math.round(f.frames / (dur / 1000)) : 0}`
          + ` onMove avg=${avg(f.onMoveTotal, f.moves)}/max=${+f.onMoveMax.toFixed(1)}ms`
          + (() => {
              // The whole point of the buckets: `instance:...` next to
              // `container:...` says whether crossing rows really is dearer.
              const e = Object.entries(f.moveBy || {}).sort((a, b) => b[1].n - a[1].n);
              if (!e.length) return "";
              return ` moveBy=[${e.map(([k, v]) =>
                `${k}:${v.n}x${(v.total / v.n).toFixed(1)}/max${v.max.toFixed(0)}ms`).join(" ")}]`;
            })()
          + ` raf avg=${avg(f.rafTotal, f.frames)}/max=${+f.rafMax.toFixed(1)}ms`
          + ` hit avg=${avg(f.hitTotal, f.hitCount)}/max=${+f.hitMax.toFixed(1)}ms`
          + ` [efp avg=${avg(f.efpTotal, f.hitCount)}/max=${+f.efpMax.toFixed(1)}`
          + ` walk avg=${avg(f.walkTotal, f.hitCount)}/max=${+f.walkMax.toFixed(1)}`
          + ` els=${f.elsMax} targets=${f.dropTargets}]`
          + ` over16=${f.long16} over32=${f.long32}`
          + ` | DROP handler=${d(f.tDrop, f.tDropDone)}ms paint=${d(f.tDropDone, f.tDropPaint)}ms`
          + ` dropRenders=${(() => {
              if (!f.tallyDrop || typeof window === "undefined" || !window.__renderDiff) return -1;
              const dd = window.__renderDiff(f.tallyDrop);
              const tot = Object.values(dd.renders || {}).reduce((a, n) => a + n, 0);
              const top = Object.entries(dd.renders || {}).filter(([, n]) => n)
                .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, n]) => `${k}:${n}`).join(",");
              return `${tot}${top ? `(${top})` : ""} opSweeps=${dd.ops?.runs ?? 0}`;
            })()}`
          + ` | renders=${rTot}${rTop ? `(${rTop})` : ""}`
          + ` opSweeps=${tally?.ops?.runs ?? -1} opMs=${Math.round(tally?.ops?.ms ?? -1)}`
          // WHAT SET THEM OFF. `diffOps` has tallied sweeps BY TRIGGER since
          // the scroll work; this line printed only the total, so ~1s of
          // operation sweeps landing mid-drag read as unattributable noise
          // across several captures. A sweep on `load` is the documented
          // post-paint tail — a drag taken inside it is measuring the load;
          // one on a write echo during the drag is the drag's own cost.
          + `${(() => {
              const by = tally?.ops?.by;
              if (!by) return "";
              const top = Object.entries(by).sort((a, b) => b[1].ms - a[1].ms).slice(0, 3)
                .map(([k, v]) => `${k}:${v.runs}x${Math.round(v.ms)}ms/${v.fx ?? "?"}fx`).join(" ");
              return top ? ` opBy=[${top}]` : "";
            })()}`
          + ` longTasks=${f.longTasks}(${Math.round(f.longTaskMs)}ms)`
          + ` firstTask=${f.firstTaskMs >= 0 ? Math.round(f.firstTaskMs) : -1}ms`
          + `@${f.firstTaskAt >= 0 ? Math.round(f.firstTaskAt) : -1}ms`
          + ` dom=${typeof document !== "undefined" ? document.getElementsByTagName("*").length : -1}`

          + `${(() => {
              if (!f.attr0 || typeof window === "undefined" || !window.__renderAttrDiff) return "";
              const a = window.__renderAttrDiff(f.attr0);
              const bits = [];
              for (const [kind, causes] of Object.entries(a || {})) {
                const top = Object.entries(causes).sort((x, y) => y[1] - x[1]).slice(0, 2)
                  .map(([c, n]) => `${c.slice(0, 34)}=${n}`).join(" ");
                if (top) bits.push(`${kind}{${top}}`);
              }
              return bits.length ? ` causes=${bits.join(" ")}` : "";
            })()}`
          // WAS THE GRID SETTLED WHEN THIS DRAG STARTED? The first capture read
          // 5,790 renders and 23 op sweeps during a drag — within noise of what
          // an idle LOAD produces (3,794 / 23-25), so "the drag is slow" and
          // "everything is slow because the load is still draining" are not
          // separable without this. Milliseconds since the page began.
          + ` sinceLoad=${Math.round(f.tStarted)}ms`;
      } catch (err) {
        // Report SOMETHING. The phase timings are plain arithmetic and cannot
        // throw; only the two derived breakdowns can.
        line = `[drag] ${Math.round(dur)}ms "${f.label}" mode=${f.mode}`
          + ` | START hold=${d(f.tTouch, f.tActivate)}ms work=${d(f.tActivate, f.tStarted)}ms`
          + ` | DURING moves=${f.moves} frames=${f.frames}`
          + ` | DROP handler=${d(f.tDrop, f.tDropDone)}ms paint=${d(f.tDropDone, f.tDropPaint)}ms`
          + ` | REPORT-PARTIAL: ${err?.message || err}`;
      }
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
