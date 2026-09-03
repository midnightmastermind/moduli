// helpers/loadDiag.js
//
// `[load]` instrumentation for the STAGED LOADING work
// (docs/superpowers/plans/2026-08-06-staged-loading.md, Task 1).
//
// WHY IT EXISTS. The plan's Task 2/3 (paint the grid shape first, per-panel
// spinners) is a change to the render path — and this codebase's record is
// blunt about that class of work: every perf fix that worked came from numbers,
// every one that came from reading code was wrong (CLAUDE.md 2026-08-05, four
// wrong diagnoses in one day). The docket already suspects the load cost is the
// on-load OP SWEEP (556ms, 58 ops) rather than rendering — a 4x-throttled load
// measured 7.8s to content WITH row-skipping on and off making no difference.
// If that still holds, staged mounting decorates the wait instead of shortening
// it. So this splits the wall clock four ways BEFORE anything is built:
//
//   (a) reducer dispatch   — FULL_STATE landing in the store
//   (b) React commit       — the tree actually committing (grid → panels)
//   (c) op sweep           — runMatchingOperations + applying its effects
//   (d) editor mounts      — every doc/textblock mounts a live TipTap instance
//
// It EXTENDS the `markFS` logging that `bindSocketToStore.onFullState` already
// had rather than adding a second timer, so the two can never disagree.
//
// OPT-IN (`window.__loadDiag = true`, set BEFORE the socket connects — a probe
// sets it in an init script). Off, every call here is a boolean check and a
// return; nothing is recorded and nothing is logged.

// STATE LIVES ON `window`, NOT IN MODULE SCOPE — and that is load-bearing, not
// style. Rollup can emit this helper into MORE THAN ONE chunk (the app entry and
// the page-preview entry both pull it in transitively), and a second copy has
// its own `started`/`t0`. The first version of this file kept them module-local
// and reported **0 editor mounts** on a grid with 241 rows: `Editor.jsx` landed
// in a different chunk, so its copy had never been started and every mark it
// made returned early. A diagnostic that silently drops half its marks is worse
// than none — this is the same "absent signal read as a zero" trap recorded in
// client/src/CLAUDE.md 2026-08-04.
const S = () => {
  if (typeof window === "undefined") return null;
  if (!window.__loadDiagState) {
    window.__loadDiagState = { t0: 0, marks: [], started: false, firstSeen: new Set() };
  }
  return window.__loadDiagState;
};

// ON BY DEFAULT, because the device that has the problem has no console.
// `dragPerf` learned this on 2026-09-01 — "INSTRUMENTED IS NOT MEASURED: it
// logged only to a console on the one device that has the problem, so nobody
// had ever read it." The same was true here: every `[load]` number quoted in
// CLAUDE.md came from a desktop probe, and the device's load is 3.3x longer.
// `?loadDiag=0` (or `window.__loadDiag = false`) turns it off; the cost when on
// is an array of marks and one PerformanceObserver.
const on = () => {
  if (typeof window === "undefined") return false;
  if (window.__loadDiag === false) return false;
  if (window.__loadDiag === true) return true;
  try {
    if (new URLSearchParams(window.location.search).get("loadDiag") === "0") {
      window.__loadDiag = false;
      return false;
    }
  } catch { /* a URL we cannot parse is not a reason to lose the capture */ }
  return true;
};

/**
 * The load timeline as ONE LINE, shipped to the server over the same channel
 * the drag probe uses, so a capture does not depend on the user reading an
 * overlay. Formatted HERE rather than on the server: that re-derivation kept
 * dropping fields the client had already computed (server.js:410).
 */
export function loadDiagLine(tag = "load") {
  if (!on()) return null;
  const r = loadReport();
  const m = (label) => S()?.marks?.find((x) => x.label === label)?.t ?? null;
  const efx = S()?.marks?.find((x) => x.label === "effects:end");
  const ms = (v) => (v == null ? "?" : `${Math.round(v)}ms`);
  const top = (r.topLongTasks || [])
    // `{ t, ms }` — `t` is already relative to full_state, which is the clock
    // every other figure on this line uses.
    .map((x) => `${Math.round(x.ms)}ms@${Math.round(x.t)}`)
    .join(" ");
  return `[${tag}] `
    + `dispatch=${ms(r.dispatchMs)} gridCommit=${ms(r.gridCommitAt)} `
    + `panels=${r.panelCount}@${ms(r.firstPanelAt)}-${ms(r.lastPanelAt)} `
    + `contentReady=${ms(m("panel:content-ready"))} `
    // The three that decide where the load tail goes.
    + `ops:start=${ms(r.opSweepStartedAt)} sweep=${ms(r.opSweepMs)} effects=${ms(r.opEffectsMs)} `
    + `opsDone=${ms(r.opsDoneAt)} `
    // SLICES vs EFFECTS is the tell for a degenerate budget. `sliceWork`'s own
    // header records the failure: "8ms against items that measured ~9ms EACH,
    // so every item blew the budget and the loop yielded after every one — 194
    // slices for 195 effects, ~3s of pure scheduling overhead". The budget was
    // then tuned to 32ms against a ~9ms item ON A DESKTOP. If slices ~= effects
    // here, the same degeneracy is back because the device's item cost is
    // several times the budget — and every yield also ends React's auto-batching
    // window, so each effect gets its own synchronous render.
    + `effectCount=${efx?.count ?? "?"} slices=${efx?.slices ?? "?"} `
    // Which arm this capture is, so two lines in the log cannot be confused.
    + `adaptiveSlice=${typeof window !== "undefined" && window.__adaptiveSliceUsed === true} `
    + `editors=${r.editorCount}@${ms(r.firstEditorAt)}-${ms(r.lastEditorAt)} `
    // An ABSENT long-task API must not read as "nothing blocked" — the
    // 2026-08-04 trap, where a Firefox capture with no Long Tasks support fell
    // through to a RASTER verdict by construction.
    + `blocked=${r.longTasksSupported ? `${ms(r.blockedMs)}/${r.longTaskCount}tasks` : "UNSUPPORTED"} `
    + `top=[${top}] `
    + `dom=${typeof document !== "undefined" ? document.getElementsByTagName("*").length : "?"} `
    + `sinceNav=${ms(typeof performance !== "undefined" ? performance.now() : null)}`;
}

/** Zero the clock. Called when `full_state` arrives — everything is relative to that. */
export function startLoadDiag(label = "full_state arrived") {
  if (!on()) return;
  const st = S();
  st.t0 = performance.now();
  st.marks = [];
  st.started = true;
  st.firstSeen = new Set();
  st.marks.push({ t: 0, label });
  window.__loadMarks = st.marks;
  // Absolute origin, so a probe can express its own DOM timings (e.g. "when did
  // 20 rows exist") on the same clock as everything below.
  window.__loadT0 = st.t0;
  observeLongTasks();
}

/** Record a mark. `extra` is merged into the row so a probe can group/count. */
export function markLoad(label, extra) {
  if (!on()) return;
  const st = S();
  if (!st.started) return;
  st.marks.push({ t: +(performance.now() - st.t0).toFixed(1), label, ...(extra || {}) });
  window.__loadMarks = st.marks;
}

/**
 * Record a mark only the FIRST time a given key is seen.
 * Components re-render constantly during load; "first Grid commit" has to mean
 * the first one, not the last render that happened to fire an effect.
 */
export function markLoadOnce(key, label, extra) {
  if (!on()) return;
  const st = S();
  if (!st.started || st.firstSeen.has(key)) return;
  st.firstSeen.add(key);
  markLoad(label, extra);
}

/** Wrap a synchronous block and record how long it took. Returns its value. */
export function timeLoad(label, fn) {
  const st = S();
  if (!on() || !st?.started) return fn();
  const a = performance.now();
  const out = fn();
  const b = performance.now();
  st.marks.push({ t: +(a - st.t0).toFixed(1), label: `${label}:start` });
  st.marks.push({ t: +(b - st.t0).toFixed(1), label: `${label}:end`, ms: +(b - a).toFixed(1) });
  window.__loadMarks = st.marks;
  return out;
}

// ---------------------------------------------------------------------------
// Long tasks. Chrome only — Firefox implements neither Long Tasks nor (until
// recently) contentvisibility events, and reading an ABSENT signal as a zero is
// exactly the trap recorded in client/src/CLAUDE.md 2026-08-04. So this reports
// `supported:false` rather than `0ms` when the entry type does not exist.
// ---------------------------------------------------------------------------
function observeLongTasks() {
  const st = S();
  if (st.longTaskObserver) return;
  const types = PerformanceObserver.supportedEntryTypes || [];
  if (!types.includes("longtask")) {
    window.__loadLongTasks = { supported: false, tasks: [] };
    return;
  }
  const tasks = [];
  window.__loadLongTasks = { supported: true, tasks };
  try {
    st.longTaskObserver = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        tasks.push({ t: +(e.startTime - st.t0).toFixed(1), ms: +e.duration.toFixed(1) });
      }
    });
    st.longTaskObserver.observe({ entryTypes: ["longtask"] });
  } catch {
    window.__loadLongTasks = { supported: false, tasks: [] };
  }
}

// ---------------------------------------------------------------------------
// Report. `window.__loadReport()` returns the four numbers plus the raw marks,
// so a probe asserts on structure rather than parsing console text.
// ---------------------------------------------------------------------------
function span(marks, startLabel, endLabel) {
  const a = marks.find((m) => m.label === startLabel);
  const b = marks.find((m) => m.label === endLabel);
  if (!a || !b) return null;
  return +(b.t - a.t).toFixed(1);
}

export function loadReport() {
  const marks = S()?.marks || [];
  const panels = marks.filter((m) => m.label === "panel:commit");
  const editors = marks.filter((m) => m.label === "editor:mount");
  const last = (rows) => (rows.length ? rows[rows.length - 1].t : null);
  const lt = window.__loadLongTasks || { supported: false, tasks: [] };
  const blocked = lt.supported
    ? +lt.tasks.reduce((s, x) => s + x.ms, 0).toFixed(1)
    : null;
  return {
    // (a)
    dispatchMs: span(marks, "dispatch:start", "dispatch:end"),
    // (b)
    gridCommitAt: marks.find((m) => m.label === "grid:commit")?.t ?? null,
    firstPanelAt: panels.length ? panels[0].t : null,
    lastPanelAt: last(panels),
    panelCount: panels.length,
    // (c)
    opSweepMs: span(marks, "ops:start", "ops:end"),
    opEffectsMs: span(marks, "ops:end", "effects:end"),
    opSweepStartedAt: marks.find((m) => m.label === "ops:start")?.t ?? null,
    opsDoneAt: marks.find((m) => m.label === "effects:end")?.t ?? null,
    // (d)
    editorCount: editors.length,
    firstEditorAt: editors.length ? editors[0].t : null,
    lastEditorAt: last(editors),
    // main-thread blocking, or an honest "not measurable here"
    longTasksSupported: lt.supported,
    longTaskCount: lt.supported ? lt.tasks.length : null,
    blockedMs: blocked,
    // The biggest blocks, with WHEN they happened — a total alone cannot say
    // whether the cost sits before or after the op sweep.
    topLongTasks: lt.supported
      ? lt.tasks.slice().sort((a, b) => b.ms - a.ms).slice(0, 8)
      : [],
    marks: marks.slice(),
  };
}

if (typeof window !== "undefined") {
  window.__loadReport = loadReport;
}
