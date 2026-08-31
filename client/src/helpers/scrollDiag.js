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

// Default ON for touch again (2026-08-05, by request), but only after the
// stacking that caused "freezing up like crazy" was properly closed. The first
// guard only blocked a new measurement while one was awaiting commit — once
// committed, a further tap could still start a SECOND 2s rAF loop, so rapid
// tapping stacked them anyway. `_measuring` below is the real one-at-a-time
// latch, and the window is shorter. Desktop stays off; opt out with
// `window.__scrollDiag = false`.
const on = () => {
  if (typeof window === "undefined") return false;
  if (window.__scrollDiag === false) return false;
  return window.__scrollDiag === true || isTouchDevice() || urlOrStoredVerbose();
};
// VERBOSE = the on-screen overlay. It used to require setting a global from a
// console — which is exactly what the device that needs it does not have. A
// tablet is the whole reason this file exists, so it is reachable by URL now:
// visit `?scrollDiag=1`, scroll the list that feels wrong, read the summary.
// The flag is remembered for the tab so a reload (or the app's own navigation)
// keeps it on; `?scrollDiag=0` clears it. The explicit global still wins, so
// nothing that already sets it changes behaviour.
export const SCROLL_DIAG_KEY = "moduli-scroll-diag";

/**
 * The decision, pure so it can be tested without a browser: given the query
 * string and what was remembered, is the overlay on?
 * @returns {{ on: boolean, remember: "set"|"clear"|null }}
 */
export function scrollDiagFlagFrom(search, stored) {
  const q = new URLSearchParams(search || "").get("scrollDiag");
  if (q === "0" || q === "false") return { on: false, remember: "clear" };
  if (q === "1" || q === "true") return { on: true, remember: "set" };
  return { on: stored === "1", remember: null };
}

function urlOrStoredVerbose() {
  if (typeof window === "undefined") return false;
  try {
    const { on, remember } = scrollDiagFlagFrom(window.location.search, sessionStorage.getItem(SCROLL_DIAG_KEY));
    if (remember === "set") sessionStorage.setItem(SCROLL_DIAG_KEY, "1");
    if (remember === "clear") sessionStorage.removeItem(SCROLL_DIAG_KEY);
    return on;
  } catch { return false; }   // storage denied — the global still works
}
const verbose = () => {
  if (typeof window === "undefined") return false;
  if (window.__scrollDiag === true) return true;
  if (window.__scrollDiag === false) return false;
  return urlOrStoredVerbose();
};

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

// ── HOW MUCH SCROLLING THIS BURST ACTUALLY DID ─────────────────────────────
// Every arm is a separate hand-scroll, so nothing forces two of them to be the
// same gesture — and on 2026-08-29 they were not. Baseline flung the WHOLE page
// (15,364px of 15,374 in 5,240ms ≈ 2,930px/s) while the three "fixed" arms
// crawled 425-2,580px at 207-348px/s. Read naively that says the marquee costs
// 92ms a frame. It says nothing of the kind: the arms differ by 8-14x in how
// fast they moved, which is the only variable big enough to explain the gap.
// So the rate is printed, and an arm too far from baseline is MARKED, because
// this repo's history is one long record of a before/after that measured two
// different things.
export function scrollRate(s) {
  if (!s || !s.durationMs) return 0;
  return Math.round(Math.abs(s.endTop - s.startTop) / (s.durationMs / 1000));
}
// ── WHERE THE RENDERS LANDED, not just how many ────────────────────────────
// `diffRenders` measures a snapshot against NOW, which can only ever give a
// total. That total is ambiguous in exactly the place the cell-switch capture
// needs precision: 1,165 component renders were recorded around a tap whose
// React commit took 16ms, and nothing said whether they happened inside that
// commit or in the 6,486ms block that followed it. Those are different bugs
// with different fixes, so the tally is split at the commit instead.
export function subtractTally(after, before) {
  const out = {};
  for (const k of Object.keys(after || {})) out[k] = (after[k] || 0) - (before?.[k] || 0);
  return out;
}

export function comparability(rate, baseRate, tolerance = 2) {
  if (!rate || !baseRate) return "unknown";
  const ratio = rate > baseRate ? rate / baseRate : baseRate / rate;
  return ratio <= tolerance ? "comparable" : "not comparable";
}

// ── A MOUNT VERDICT NEEDS ENOUGH MOUNTING TO EXPLAIN THE BURST ─────────────
// This fired on `rowsAdded > 0`, so ONE row crowned MOUNT and shadowed the real
// story. It did exactly that on 2026-08-29: a full-page fling that was 86%
// main-thread blocked (16 long tasks, 4,481ms of 5,240ms, median frame 109ms)
// reported MOUNT because a single row landed mid-gesture — while the
// progressive catalogue load was still growing the page underneath it. One row
// is not why a five-second gesture stuttered, and crowning it sends the next
// round after the mount path instead of the main thread.
//
// The floor is DERIVED rather than picked: "rows were missing as I scrolled"
// means at least a screenful arrived late, and the session already records both
// numbers, so the threshold follows the device's own geometry instead of a
// constant that is wrong on the next screen size.
export function mountFloor(s) {
  const perScreen = s && s.realPx > 0 ? Math.round(s.clientHeight / s.realPx) : 0;
  return Math.max(2, perScreen);
}

export function verdictFor(s) {
  // A sub-threshold mount is REPORTED rather than hidden — the count still
  // matters, it just cannot be the headline.
  const minor = s.rowsAdded > 0
    ? ` (${s.rowsAdded} row(s) also entered the DOM — too few to explain it)`
    : "";
  if (s.rowsAdded >= mountFloor(s)) {
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
        + `deferred their layout to the moment you reached them.` + minor,
    };
  }
  // requestAnimationFrame runs ON the main thread, so a long gap between two
  // callbacks IS main-thread blockage — in every browser, no API required.
  // This is the signal that survives when longtask is unavailable.
  if (s.frameMedian > 100) {
    return {
      code: "MAIN-THREAD",
      text: `frames ${s.frameMedian}ms apart — the main thread was blocked in `
        + `style/layout/paint${SUPPORTS_LONGTASK ? ` (${s.longTasks} long task(s), ${Math.round(s.longTaskMs)}ms of ${s.durationMs}ms)` : " (longtask API unavailable here, so JS vs paint is not separable)"}.` + minor,
    };
  }
  if (SUPPORTS_LONGTASK && s.longTaskMs > s.durationMs * 0.3) {
    return {
      code: "PAINT",
      text: `Main thread blocked ${Math.round(s.longTaskMs)}ms of ${s.durationMs}ms.` + minor,
    };
  }
  if (s.slowFrames > 0) {
    return {
      code: SUPPORTS_LONGTASK ? "RASTER" : "UNKNOWN",
      text: SUPPORTS_LONGTASK
        ? `DOM complete and main thread mostly idle, yet ${s.slowFrames} frames missed — GPU/raster bound.${minor}`
        : `${s.slowFrames} frames missed, but this browser reports no long-task data, so the cause is not attributable.${minor}`,
    };
  }
  return { code: "CLEAN", text: "Nothing anomalous recorded in this burst." };
}

function endSession() {
  if (!active) return;
  const s = active;
  active = null;
  s.durationMs = Math.round(performance.now() - s.t0);
  // Attribute the block. `__renderDiff` returns only the counters that MOVED,
  // so an idle burst reports nothing rather than a wall of zeros.
  try {
    const d = window.__renderDiff?.(s.tally0);
    const total = (o) => Object.values(o || {}).reduce((a, v) => a + (typeof v === "number" ? v : (v?.count || 0)), 0);
    s.rendersInBurst = total(d?.renders);
    // `diffOps` returns { runs, ms }, so summing its VALUES adds a count to a
    // duration — `ops=2301` could be 2,301 runs or one run taking 2,300ms, and
    // those are completely different findings. Reported separately.
    s.opRuns = d?.ops?.runs ?? 0;
    s.opMs = Math.round(d?.ops?.ms ?? 0);
    s.opsInBurst = total(d?.ops);
    s.topRenders = Object.entries(d?.renders || {})
      .map(([k, v]) => [k, typeof v === "number" ? v : (v?.count || 0)])
      .sort((a, b) => b[1] - a[1]).slice(0, 3);
    s.topOps = Object.entries(d?.ops || {})
      .map(([k, v]) => [k, typeof v === "number" ? v : (v?.count || 0)])
      .sort((a, b) => b[1] - a[1]).slice(0, 3);
  } catch { /* the probe must never break the scroll it is measuring */ }
  delete s.tally0;
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
      // Without the rate a server-side report is uncomparable in exactly the way
      // the overlay was: two arms at 2,930px/s and 207px/s look like an A/B.
      ratePxPerSec: scrollRate(s),
      // WAS THE A/B ARM ACTUALLY APPLIED? Verbose mode injects the arm's CSS
      // and paints an overlay; silent mode does neither. A burst from each is
      // measuring a different page, and until now nothing in the report said
      // which — so "the diagnostic was on" was indistinguishable from a real
      // regression when reading the log.
      verbose: verbose(),
      // AND THE VERDICT ON IT. The rate alone still has to be divided by hand
      // against another line of the log, which is precisely the step that did
      // not happen on 2026-08-31: four arms at 285 / 97 / 0 / 1,061px/s were
      // read as an A/B. The overlay has flagged this since 2026-08-29 — but
      // the overlay is on the tablet and the decision gets made from the pm2
      // log, so the guard was invisible exactly where it was needed.
      comparability: s.index === 1 ? "baseline" : comparability(scrollRate(s), scrollRate(sessions[0])),
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
    // WHAT the main thread was busy WITH. The device reported PAINT — 8,680ms of
    // long tasks in a 12,117ms scroll (2026-08-29) — and the verdict names the
    // LAYER but not the culprit. `__renderTally` already counts React renders
    // per component and operation fires per op; diffing it across the burst says
    // whether the block is rendering, ops, or neither.
    tally0: (typeof window !== "undefined" && window.__renderTally) ? window.__renderTally() : null,
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

// WHAT the main thread was busy with during the burst. The verdict names the
// LAYER (PAINT / MOUNT / RASTER); this names the culprit. Empty for an idle
// burst, so a quiet scroll reports nothing rather than a wall of zeros.
function busyLine(s) {
  if (!s.rendersInBurst && !s.opsInBurst) return "";
  const pairs = (list) => (list || []).map(([k, n]) => `${k}:${n}`).join(", ");
  const top = s.topRenders?.length ? ` — top ${pairs(s.topRenders)}` : "";
  const ops = s.topOps?.length ? ` — ops ${pairs(s.topOps)}` : "";
  return `<span style="opacity:.85">busy with <b style="color:#ffd479">${s.rendersInBurst}</b> renders, `
       + `<b style="color:#ffd479">${s.opsInBurst}</b> op fires${top}${ops}</span><br>`;
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

  // The A/B rests entirely on the arms being the same gesture, so baseline's
  // rate is the yardstick every later arm is measured against.
  const baseRate = scrollRate(sessions[0]);
  const rows = sessions.map((s) => {
    const rate = scrollRate(s);
    const cmp = s.index === 1 ? "baseline" : comparability(rate, baseRate);
    const colour = s.verdict.code === "MOUNT" ? "#ffd479"
      : s.verdict.code === "SKIPPED" ? "#c9a0ff"
      : s.verdict.code === "PAINT" ? "#ff9d9d"
      : s.verdict.code === "RASTER" ? "#9ad0ff" : "#9ae6b4";
    const seedBad = s.seedPx && s.realPx && Math.abs(s.realPx - s.seedPx) / s.realPx > 0.15;
    return `
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.12)">
        <b style="color:${colour}">#${s.index} ${s.verdict.code}</b> <span style="opacity:.7">[${s.arm}]</span>
        <span style="opacity:.8"> ${s.verdict.text}</span><br>
        ${busyLine(s)}
        rows in DOM at start <b>${s.rowsAtStart}</b> ·
        skipped at start <b style="color:#c9a0ff">${s.skippedAtStart}</b> ·
        un-skipped while scrolling <b style="color:${s.unskipped ? "#c9a0ff" : "#9ae6b4"}">${s.unskipped}</b><br>
        added to DOM <b style="color:${s.rowsAdded ? "#ffd479" : "#9ae6b4"}">${s.rowsAdded}</b> ·
        removed <b>${s.rowsRemoved}</b> ·
        seed <b style="color:${seedBad ? "#ffd479" : "#9ae6b4"}">${s.seedPx || "?"}px</b> vs real <b>${s.realPx || "?"}px</b><br>
        frames: median <b>${s.frameMedian}ms</b>, missed <b>${s.slowFrames}</b>/${s.frames.length} ·
        long tasks <b>${s.longTasks}</b> (<b>${s.longTaskMs}ms</b>)<br>
        scrolled <b>${Math.round(Math.abs(s.endTop - s.startTop))}px</b> of ${s.scrollHeight - s.clientHeight} · ${s.durationMs}ms ·
        <b>${rate}px/s</b> <span style="color:${cmp === "not comparable" ? "#ffd479" : "#9ae6b4"}">${cmp}</span>
      </div>`;
  }).join("");

  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <b>[scroll] Routines diagnostic</b>
      <span style="opacity:.65">tap to dismiss</span>
    </div>${rows}
    <div style="margin-top:8px;opacity:.6">
      Scroll again — each pass disables one suspect (marquee / backdrop / shadow).<br>
      The pass whose frame median drops is the cause — but ONLY among arms marked
      <b>comparable</b>: scroll each one the same way, or the rate is the variable
      you measured. <b>${sessions.length}/${MAX_SESSIONS} done.</b>
      ${sessions.length >= MAX_SESSIONS
        ? "<br><b style=\"color:#ffd479\">Capture complete — RELOAD THE PAGE to run it again.</b>"
        : ""}
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
let _measuring = false;
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
    // A layout effect runs after the WHOLE subtree has committed, so anything
    // rendered in this pass is already counted here — and anything counted
    // later is not React reacting to the tap. That is the split.
    _pendingSwitch.rAtCommit = snapshotRenders();
    _gridRenderStart = null;
  }
}

function armCellSwitchDiag() {
  document.addEventListener("pointerup", (e) => {
    if (!on()) return;
    if (!e.target?.closest?.(".mobile-rail-btn")) return;

    // Exactly ONE measurement at a time. A stacked rAF loop per tap is how this
    // tool started causing the jank it was looking for — and a tap is cheap to
    // skip, since the next one measures the same thing.
    if (_measuring) return;
    _measuring = true;
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
      if (now - t0 < 1200) { requestAnimationFrame(tick); return; }
      _measuring = false;

      const payload = {
        kind: "cell-switch",
        renders: diffRenders(rBefore),
        ops: diffOps(oBefore),
        // The discriminator. IN-COMMIT renders are the tap's own re-render
        // cascade (fix: narrow what subscribes). AFTER-COMMIT renders are work
        // that lands once the screen has already painted (fix: whatever
        // schedules them). The 2026-08-31 capture could not tell them apart.
        rendersInCommit: sw.rAtCommit ? subtractTally(sw.rAtCommit, rBefore) : null,
        rendersAfterCommit: sw.rAtCommit ? diffRenders(sw.rAtCommit) : null,
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
    if (!on()) return;
    // THE CAPTURE IS SPENT — SAY SO INSTEAD OF GOING QUIET. Four bursts is the
    // whole run (baseline + one per suspect), and the fifth scroll used to
    // return here silently. On a tablet, with no console, that is
    // indistinguishable from a diagnostic that never armed — reported as
    // "nothing is popping up for capture" 2026-08-31, when in fact all four
    // arms had already been recorded. Re-showing the results costs nothing
    // (only when the overlay is not already on screen) and the panel now
    // carries the one instruction that gets a fresh run: reload.
    if (sessions.length >= MAX_SESSIONS) {
      if (verbose() && !document.getElementById("scroll-diag-overlay")) renderOverlay();
      return;
    }
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
