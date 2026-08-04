// helpers/scrollDiag.js
//
// `[scroll]` diagnostics for the mobile Routines report (user 2026-08-03/04:
// "its slowish when i scroll the first time and shows blank containers waiting
//  for content ... after that, it seems better" → clarified: the blank things
// are the INSTANCE ROWS inside the Routines containers).
//
// WHY THIS EXISTS RATHER THAN ANOTHER PROBE. Three headless probes failed to
// reproduce it (see client/src/CLAUDE.md docket): one metric could not tell a
// structurally-empty container from one waiting for content, another reported a
// result from a scroll that never moved, and none of them ran on hardware
// anything like the reporting device (a Samsung A15). More importantly, if the
// rows are in the DOM the whole time and the blank is the compositor not having
// rasterized them, then EVERY DOM-based metric reports "content present" and
// finds nothing — the measurement has to happen on the device.
//
// THE DISCRIMINATOR. Three competing explanations, one number each:
//
//   A. MOUNT   — rows are genuinely absent and get added as you scroll.
//                → MutationObserver sees `.instance-wrap` nodes ADDED.
//   B. SKIPPED — the rows are in the DOM but the browser deliberately skipped
//                laying them out, because `.instance-wrap` carries
//                `content-visibility: auto` (index.css:954, the "#24 perf"
//                off-screen skip we shipped to cut LOAD time). Scrolling one
//                into view forces its layout+paint in that frame, which on a
//                slow device is visible as a row that fills in late — and it
//                is better the second time because the browser then remembers
//                the real size (`contain-intrinsic-size: auto 60px`).
//                → `contentvisibilityautostatechange` fires as you scroll.
//   C. PAINT   — DOM complete, nothing skipped, main thread simply too busy.
//                → long tasks dominate the burst.
//   D. RASTER  — DOM complete, nothing skipped, main thread mostly idle, but
//                frames still miss. GPU/raster bound.
//
// These need completely different fixes (defer mounting / retune the skip /
// cut main-thread work / cut paint area), so guessing between them is what has
// cost the last two rounds. B is the leading suspect and is the one no probe
// so far could even see.
//
// OPT-IN (`window.__scrollDiag = true`). It shipped ON while the bug was live —
// a user-facing bug needs zero setup to capture — and that is how it was found;
// it is off now that the fix is verified. Keep the file: it is the only thing
// that has successfully measured this surface, and the arms below are reusable
// for the next paint regression.

import { socket } from "../socket.js";
import { safeEmit } from "./offlineQueue.js";
import { snapshotRenders, diffRenders, snapshotOps, diffOps } from "./renderProbe";

// TWO modes, because a phone has no console but also should not have a debug
// panel thrown over the app it is trying to use:
//
//   default on TOUCH devices — measure and report to the server SILENTLY. No
//     overlay, and no A/B arms (those change what you see, which is fine for a
//     deliberate experiment and rude in normal use).
//   `window.__scrollDiag = true` — verbose: overlay + the A/B arms.
//
// Desktop stays off entirely; every problem this has found was mobile-only.
// Opt out with `window.__scrollDiag = false`.
const isTouchDevice = () => typeof window !== "undefined"
  && typeof window.matchMedia === "function"
  && window.matchMedia("(pointer: coarse)").matches;

// OFF by default again (2026-08-04). It was default-on for touch while the bug
// was being chased, and the user reported the app "freezing up like crazy"
// immediately after — every rail tap arms a 2s rAF loop, so rapid tapping
// stacks overlapping loops, and a measurement tool that degrades the thing it
// measures is worse than no tool. Re-enable deliberately with
// `window.__scrollDiag = true`.
const on = () => typeof window !== "undefined" && window.__scrollDiag === true;
const verbose = () => typeof window !== "undefined" && window.__scrollDiag === true;

const MAX_SESSIONS = 4;        // baseline + one per suspect (see ARMS)

// ── On-device attribution ──────────────────────────────────────────────────
// Guessing which style is expensive has now cost several rounds, and headless
// raster does not resemble this hardware. So each successive scroll burst runs
// with ONE suspect neutralised and reports its own frame median: the arm that
// drops it is the cause, measured on the device that actually has the problem.
// Nothing here changes what ships — the overrides live only for the duration
// of the measurement and are removed after the last burst.
const ARMS = [
  { name: "baseline", css: "" },
  { name: "no-marquee", css: ".auto-marquee-inner{animation:none !important}" },
  { name: "no-backdrop", css: "*{backdrop-filter:none !important;-webkit-backdrop-filter:none !important}" },
  { name: "no-shadow", css: ".container-shell,.instance-wrap>.instance-row{box-shadow:none !important}" },
];

function applyArm(i) {
  document.getElementById("scroll-diag-arm")?.remove();
  const css = ARMS[i]?.css;
  if (!css) return;
  const el = document.createElement("style");
  el.id = "scroll-diag-arm";
  el.textContent = css;
  document.head.appendChild(el);
}
const IDLE_END_MS = 700;       // a burst ends after this much stillness
const MAX_BURST_MS = 12000;    // hard stop so a long scroll can't record forever
const SLOW_FRAME_MS = 50;      // a frame this long is a visibly dropped one

// Firefox implements NEITHER of these. Without the check, a missing API reads
// as "zero long tasks" / "zero un-skips" and the verdict silently falls through
// to RASTER — which is exactly what happened on 2026-08-04 (Firefox 153 on a
// Samsung A15) and would have sent me optimising the GPU on the strength of an
// unimplemented API. An absent signal is NOT a measurement of zero.
const SUPPORTS_LONGTASK = (() => {
  try { return (PerformanceObserver.supportedEntryTypes || []).includes("longtask"); }
  catch { return false; }
})();
const SUPPORTS_CV_EVENT = typeof document !== "undefined"
  && "oncontentvisibilityautostatechange" in document.documentElement;

const sessions = [];
let active = null;
let armed = false;

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.floor(s.length / 2)]);
}

function verdictFor(s) {
  if (s.rowsAdded > 0) {
    return {
      code: "MOUNT",
      text: `${s.rowsAdded} rows entered the DOM DURING the scroll — they really were missing.`,
    };
  }
  // Checked BEFORE the main-thread verdict: the un-skip work IS main-thread
  // work, so a busy thread here is the symptom, not the cause.
  if (s.unskipped > 0) {
    return {
      code: "SKIPPED",
      text: `${s.unskipped} rows were un-skipped mid-scroll — content-visibility (index.css:954) `
        + `deferred their layout to the moment you reached them.`,
    };
  }
  // requestAnimationFrame runs ON the main thread, so a long gap between two
  // callbacks IS main-thread blockage — in every browser, no API required.
  // This is the signal that survives when longtask is unavailable.
  if (s.frameMedian > 100) {
    return {
      code: "MAIN-THREAD",
      text: `frames ${s.frameMedian}ms apart with nothing added to the DOM — the main thread `
        + `was blocked in style/layout/paint${SUPPORTS_LONGTASK ? "" : " (longtask API unavailable here, so JS vs paint is not separable)"}.`,
    };
  }
  if (SUPPORTS_LONGTASK && s.longTaskMs > s.durationMs * 0.3) {
    return {
      code: "PAINT",
      text: `DOM was complete; main thread blocked ${s.longTaskMs}ms of ${s.durationMs}ms.`,
    };
  }
  if (s.slowFrames > 0) {
    return {
      code: SUPPORTS_LONGTASK ? "RASTER" : "UNKNOWN",
      text: SUPPORTS_LONGTASK
        ? `DOM complete and main thread mostly idle, yet ${s.slowFrames} frames missed — GPU/raster bound.`
        : `${s.slowFrames} frames missed, but this browser reports no long-task data, so the cause is not attributable.`,
    };
  }
  return { code: "CLEAN", text: "Nothing anomalous recorded in this burst." };
}

function endSession() {
  if (!active) return;
  const s = active;
  active = null;
  s.durationMs = Math.round(performance.now() - s.t0);
  s.frameMedian = median(s.frames);
  s.verdict = verdictFor(s);
  s.longTaskMs = Math.round(s.longTaskMs);
  try { s.mo?.disconnect(); } catch { /* ignore */ }
  try { s.po?.disconnect(); } catch { /* ignore */ }
  sessions.push(s);
  // Set up the NEXT arm, or clean up once every suspect has had a turn.
  if (!verbose()) { document.getElementById("scroll-diag-arm")?.remove(); }
  else if (sessions.length < MAX_SESSIONS) applyArm(sessions.length);
  else document.getElementById("scroll-diag-arm")?.remove();

  // eslint-disable-next-line no-console
  console.log(`[scroll] burst #${s.index} ${s.verdict.code} — ${s.verdict.text}`, s);
  if (verbose()) renderOverlay();

  // Also REPORT IT. A phone has no console and screenshots keep going astray,
  // so the numbers ride the existing socket to the server, where they land in
  // the pm2 log. `safeEmit` means a burst captured while offline is queued
  // rather than lost. Strip the DOM node — it is not serialisable.
  try {
    const { scroller, mo, po, frames, verdict, ...rest } = s;
    safeEmit(socket, "save_scroll_diag", {
      ...rest,
      verdict: verdict.code,
      arm: s.arm,
      note: verdict.text,
      ua: navigator.userAgent,
      supportsLongTask: SUPPORTS_LONGTASK,
      supportsCvEvent: SUPPORTS_CV_EVENT,
      dpr: window.devicePixelRatio,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      path: location.pathname,
    });
  } catch { /* reporting must never break the page it is measuring */ }
}

function startSession(scroller) {
  const index = sessions.length + 1;
  const s = {
    index,
    arm: ARMS[Math.min(index - 1, ARMS.length - 1)].name,
    t0: performance.now(),
    scroller,
    startTop: scroller.scrollTop,
    endTop: scroller.scrollTop,
    rowsAdded: 0,
    rowsRemoved: 0,
    longTasks: 0,
    longTaskMs: 0,
    frames: [],
    slowFrames: 0,
    rowsAtStart: scroller.querySelectorAll(".instance-wrap").length,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    unskipped: 0,
    skippedAtStart: 0,
    seedPx: 0,
    realPx: 0,
  };

  // B — the decisive one. `contentvisibilityautostatechange` fires whenever the
  // browser starts or stops skipping an element's contents, so it reports the
  // deferral directly instead of inferring it. Also record how wrong the
  // `contain-intrinsic-size` seed is: a seed smaller than the real row height
  // makes the scroller grow as rows render, which drags the content under the
  // finger mid-scroll.
  try {
    const rows = [...scroller.querySelectorAll(".instance-wrap")];
    const cs = getComputedStyle(rows[0] || document.body);
    // `containIntrinsicHeight` came back empty (seed=0 in the field reports);
    // read the shorthand and take its last length.
    const seedRaw = cs.getPropertyValue("contain-intrinsic-size") || "";
    s.seedPx = Math.round(parseFloat((seedRaw.match(/[\d.]+px/g) || []).pop()) || 0);
    const heights = rows.map(r => r.getBoundingClientRect().height).filter(h => h > 4);
    s.realPx = median(heights);
    for (const r of rows) {
      if (typeof r.checkVisibility === "function"
        && !r.checkVisibility({ contentVisibilityAuto: true })) s.skippedAtStart++;
      r.addEventListener("contentvisibilityautostatechange", (ev) => {
        if (active === s && !ev.skipped) s.unskipped++;
      });
    }
  } catch { /* unsupported browser — verdict falls through to PAINT/RASTER */ }

  // A — did rows actually enter the DOM while scrolling?
  try {
    s.mo = new MutationObserver((records) => {
      for (const r of records) {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          s.rowsAdded += n.matches?.(".instance-wrap") ? 1 : 0;
          s.rowsAdded += n.querySelectorAll?.(".instance-wrap").length || 0;
        }
        for (const n of r.removedNodes) {
          if (n.nodeType !== 1) continue;
          s.rowsRemoved += n.matches?.(".instance-wrap") ? 1 : 0;
          s.rowsRemoved += n.querySelectorAll?.(".instance-wrap").length || 0;
        }
      }
    });
    s.mo.observe(scroller, { childList: true, subtree: true });
  } catch { /* MutationObserver always exists in practice */ }

  // B — was the main thread blocked?
  try {
    s.po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { s.longTasks++; s.longTaskMs += e.duration; }
    });
    s.po.observe({ entryTypes: ["longtask"] });
  } catch { /* longtask unsupported on some browsers — verdict falls back */ }

  // C — did frames actually miss?
  let last = performance.now();
  const tick = () => {
    if (active !== s) return;
    const now = performance.now();
    const dt = now - last;
    last = now;
    s.frames.push(dt);
    if (dt > SLOW_FRAME_MS) s.slowFrames++;
    if (now - s.t0 > MAX_BURST_MS) { endSession(); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

  active = s;
  return s;
}

function renderOverlay() {
  if (typeof document === "undefined") return;
  document.getElementById("scroll-diag-overlay")?.remove();

  const box = document.createElement("div");
  box.id = "scroll-diag-overlay";
  box.setAttribute("style", [
    "position:fixed", "left:8px", "right:8px", "bottom:8px", "z-index:2147483647",
    "background:rgba(12,16,24,0.94)", "color:#e8eefc", "font:11px/1.45 ui-monospace,Menlo,monospace",
    "padding:10px 12px", "border-radius:10px", "border:1px solid rgba(120,160,255,0.35)",
    "box-shadow:0 6px 24px rgba(0,0,0,0.5)", "max-height:52vh", "overflow:auto",
  ].join(";"));

  const rows = sessions.map((s) => {
    const colour = s.verdict.code === "MOUNT" ? "#ffd479"
      : s.verdict.code === "SKIPPED" ? "#c9a0ff"
      : s.verdict.code === "PAINT" ? "#ff9d9d"
      : s.verdict.code === "RASTER" ? "#9ad0ff" : "#9ae6b4";
    const seedBad = s.seedPx && s.realPx && Math.abs(s.realPx - s.seedPx) / s.realPx > 0.15;
    return `
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.12)">
        <b style="color:${colour}">#${s.index} ${s.verdict.code}</b> <span style="opacity:.7">[${s.arm}]</span>
        <span style="opacity:.8"> ${s.verdict.text}</span><br>
        rows in DOM at start <b>${s.rowsAtStart}</b> ·
        skipped at start <b style="color:#c9a0ff">${s.skippedAtStart}</b> ·
        un-skipped while scrolling <b style="color:${s.unskipped ? "#c9a0ff" : "#9ae6b4"}">${s.unskipped}</b><br>
        added to DOM <b style="color:${s.rowsAdded ? "#ffd479" : "#9ae6b4"}">${s.rowsAdded}</b> ·
        removed <b>${s.rowsRemoved}</b> ·
        seed <b style="color:${seedBad ? "#ffd479" : "#9ae6b4"}">${s.seedPx || "?"}px</b> vs real <b>${s.realPx || "?"}px</b><br>
        frames: median <b>${s.frameMedian}ms</b>, missed <b>${s.slowFrames}</b>/${s.frames.length} ·
        long tasks <b>${s.longTasks}</b> (<b>${s.longTaskMs}ms</b>)<br>
        scrolled <b>${Math.abs(s.endTop - s.startTop)}px</b> of ${s.scrollHeight - s.clientHeight} · ${s.durationMs}ms
      </div>`;
  }).join("");

  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <b>[scroll] Routines diagnostic</b>
      <span style="opacity:.65">tap to dismiss</span>
    </div>${rows}
    <div style="margin-top:8px;opacity:.6">
      Scroll again — each pass disables one suspect (marquee / backdrop / shadow).<br>The pass whose frame median drops is the cause. ${sessions.length}/${MAX_SESSIONS} done.
    </div>`;
  box.addEventListener("click", () => box.remove());
  document.body.appendChild(box);
}

/**
 * Arm the diagnostic. Idempotent; safe to call on every mount.
 * Listens in the CAPTURE phase because the scroller is a nested element and
 * scroll events do not bubble.
 */
/**
 * Measure a mobile RAIL TAP: how long the main thread is blocked between the
 * tap and the destination cell actually painting. The slider transform has been
 * immediate since 2026-07-27 (0.9ms on desktop), so what the user feels as "a
 * hot second" is the re-render behind it — and a desktop probe cannot feel that.
 * rAF gaps are the signal here for the same reason they are during a scroll:
 * rAF runs on the main thread, and it needs no browser API Firefox lacks.
 */
// Render attribution reuses helpers/renderProbe.js — `bumpRender` is ALREADY
// called by ModulePanel / ModulePage / ModuleContainer / ModuleInstance (built
// for the 2026-07-07 drop frame-1 flush work). React is ~99% of a rail tap
// (measured 2026-08-04: react=445-508ms, paint=1-6ms), so the question is WHICH
// components rebuild — and a count near the mounted total means React.memo is
// being defeated there, while a count near zero means it is holding. Reading
// that beats reading a props list, which is how several wrong turns started.

// Set by Grid's layout effect, which React runs AFTER it commits the new tree
// but BEFORE the browser paints. That single point splits the tap's cost in
// two — everything before it is React, everything after is layout+paint — and
// the two need opposite fixes, so guessing between them is not acceptable.
let _pendingSwitch = null;
// Grid calls this at the TOP of its render body. Nothing else renders on a tap
// (renders={all zero}) and no operations run (ops={runs:0}), so if the ~450ms
// is anywhere in React it is inside Grid's own render — its useMemos recompute
// over the whole grid state. This measures that directly.
let _gridRenderStart = null;
export function markGridRenderStart() {
  if (_pendingSwitch && _pendingSwitch.commitAt == null) _gridRenderStart = performance.now();
}

export function markCellSwitchCommit() {
  if (_pendingSwitch && _pendingSwitch.commitAt == null) {
    _pendingSwitch.commitAt = performance.now();
    // Time spent INSIDE Grid's render body, vs time before React even started.
    _pendingSwitch.gridRenderMs = _gridRenderStart != null
      ? Math.round(_pendingSwitch.commitAt - _gridRenderStart) : -1;
    _pendingSwitch.preReactMs = _gridRenderStart != null
      ? Math.round(_gridRenderStart - _pendingSwitch.t0) : -1;
    _gridRenderStart = null;
  }
}

function armCellSwitchDiag() {
  document.addEventListener("pointerup", (e) => {
    if (!on()) return;
    if (!e.target?.closest?.(".mobile-rail-btn")) return;

    // Never let two measurements overlap — a stacked rAF loop per tap is
    // exactly how a diagnostic starts causing the jank it is looking for.
    if (_pendingSwitch && _pendingSwitch.commitAt == null) return;
    const t0 = performance.now();
    _pendingSwitch = { t0, commitAt: null, paintAt: null };
    const rBefore = snapshotRenders();
    const oBefore = snapshotOps();
    const sw = _pendingSwitch;
    let last = t0, maxGap = 0, blocked = 0, frames = 0;
    const tick = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      frames++;
      if (dt > maxGap) maxGap = dt;
      if (dt > 50) blocked += dt;
      // First frame after React committed = the paint that the user waits for.
      if (sw.commitAt != null && sw.paintAt == null) sw.paintAt = now;
      if (now - t0 < 2000) { requestAnimationFrame(tick); return; }

      const payload = {
        kind: "cell-switch",
        renders: diffRenders(rBefore),
        ops: diffOps(oBefore),
        // The decomposition. reactMs is React building + committing the tree;
        // paintMs is the browser doing layout + paint afterwards.
        reactMs: sw.commitAt != null ? Math.round(sw.commitAt - t0) : -1,
        // The split that matters now: was the time spent INSIDE Grid's render,
        // or before React was even entered (i.e. in the tap handler / scheduling)?
        gridRenderMs: sw.gridRenderMs ?? -1,
        preReactMs: sw.preReactMs ?? -1,
        paintMs: (sw.commitAt != null && sw.paintAt != null) ? Math.round(sw.paintAt - sw.commitAt) : -1,
        index: 0, arm: "cell-switch", verdict: maxGap > 250 ? "MAIN-THREAD" : "OK",
        note: `rail tap → longest main-thread block ${Math.round(maxGap)}ms`,
        maxGapMs: Math.round(maxGap), blockedMs: Math.round(blocked), frames,
        rowsAtStart: document.querySelectorAll(".instance-wrap").length,
        // The blocking GROWS with every tap (607→404→2593→3992→5758ms measured
        // 2026-08-04), and a re-render is a FIXED cost — so something is
        // accumulating. These three separate the candidates:
        //   animations climbing  → AutoMarquee's `infinite` animations are not
        //                          being torn down (Gecko handles many badly)
        //   domNodes climbing    → a mount/unmount leak
        //   neither              → the work is per-switch and genuinely growing
        //                          for another reason
        animations: (() => { try { return document.getAnimations().length; } catch { return -1; } })(),
        domNodes: document.getElementsByTagName("*").length,
        editors: document.querySelectorAll(".ProseMirror").length,
        durationMs: Math.round(now - t0),
        ua: navigator.userAgent, dpr: window.devicePixelRatio,
        // Which BUILD sent this. The hashed chunk name changes every deploy, so
        // a stale tab is identifiable at a glance instead of looking like a
        // broken feature — `animations=undefined` on 2026-08-04 was a cached
        // bundle one deploy behind, not a bug, and it cost a round trip to
        // establish. This project has been caught by stale tabs before.
        build: (() => {
          try {
            const el = document.querySelector('script[src*="/assets/"]');
            return (el?.src || "").split("/").pop() || "?";
          } catch { return "?"; }
        })(),
        viewport: `${window.innerWidth}x${window.innerHeight}`,
      };
      // eslint-disable-next-line no-console
      console.log(`[scroll] cell-switch — blocked ${payload.maxGapMs}ms`, payload);
      try { safeEmit(socket, "save_scroll_diag", payload); } catch { /* never break the page */ }
    };
    requestAnimationFrame(tick);
  }, { capture: true, passive: true });
}

export function armScrollDiag() {
  if (armed || typeof window === "undefined" || !on()) return;
  armed = true;

  let idleTimer = null;

  const onScroll = (e) => {
    if (!on() || sessions.length >= MAX_SESSIONS) return;
    const el = e.target;
    // Only real content scrollers — ignore tiny menus and the document itself.
    if (!el || el === document || !el.scrollHeight) return;
    if (el.scrollHeight - el.clientHeight < 400) return;

    if (!active) startSession(el);
    if (active && active.scroller === el) active.endTop = el.scrollTop;

    clearTimeout(idleTimer);
    idleTimer = setTimeout(endSession, IDLE_END_MS);
  };

  window.addEventListener("scroll", onScroll, { capture: true, passive: true });

  armCellSwitchDiag();
  window.__scrollDiagShow = renderOverlay;
  window.__scrollDiagData = () => sessions;
  // eslint-disable-next-line no-console
  if (verbose()) console.log("[scroll] diagnostic armed — scroll Routines; a summary appears on screen. Mute: window.__scrollDiag = false");
}
