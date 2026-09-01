// DIAG: render tally — counts component renders so we can measure how much of
// the grid re-renders on a single interaction (e.g. one drop). Zero cost when
// off: enable in the console with `window.__RENDER_PROBE = true`.
//
// Usage: components call `bumpRender("panel")` in their render body; the drop
// stopwatch snapshots before the drop and diffs after paint to report how many
// panels / containers / instances re-rendered for a change that should have
// touched only one.

import { useRef } from "react";

// ── ONE STORE, ON `window`, SHARED BY EVERY CHUNK COPY ────────────────────
//
// Rollup emits this helper into MORE THAN ONE chunk (4 of them carry
// `__renderAttrs`). With the tallies in module scope each copy keeps its own,
// and each sets `window.__renderTally`/`__renderAttrs` to ITS OWN reader — so
// whichever chunk initialises last wins the global, and it need not be the copy
// the components are writing to. The reader then returns a different instance's
// counters, or none.
//
// `loadDiag` has kept its state on `window` since 2026-08-06 for exactly this,
// after it "reported 0 editor mounts on a grid with 241 rows because
// Editor.jsx's copy had never been started". Same trap, same remedy.
const _store = (() => {
  const blank = () => ({
    tally: { panel: 0, container: 0, instance: 0, page: 0, field: 0 },
    ops: { runs: 0, ms: 0, by: {} },
    attrs: {},
  });
  if (typeof window === "undefined") return blank();
  if (!window.__moduliRenderStore) window.__moduliRenderStore = blank();
  return window.__moduliRenderStore;
})();

const _tally = _store.tally;

// Always counts — a single integer increment per render is negligible. The
// only console output is the per-drop diff logged by the drop stopwatch.
export function bumpRender(kind) {
  _tally[kind] = (_tally[kind] || 0) + 1;
}

export function snapshotRenders() {
  return { ..._tally };
}

export function diffRenders(prev) {
  const out = {};
  for (const k of Object.keys(_tally)) out[k] = _tally[k] - (prev?.[k] || 0);
  return out;
}

// ── Operation-run tally ────────────────────────────────────────────────────
// A rail tap blocks the main thread ~500ms with ZERO component re-renders
// (measured 2026-08-04), so the work is not rendering. The op drain is the
// documented ~580ms/124-effect job in this codebase, which makes it the
// remaining candidate — and this counts it rather than assuming it. Same cost
// as bumpRender: one increment plus one add.
const _ops = _store.ops;
// AND WHAT TRIGGERED EACH SWEEP. `bumpOpRun` fires once per
// `runMatchingOperations` — a whole SWEEP, not one operation — so "runs: 2"
// on a 14-second scroll means two full sweeps costing 2,563ms between them,
// and nothing said what set them off. A sweep on `load` is the documented
// post-paint tail; one on a scheduler tick while the user is scrolling is a
// different bug entirely, and the two need different fixes.
const _opsBy = _store.ops.by;
export function bumpOpRun(ms, label = "?") {
  _ops.runs++;
  _ops.ms += ms || 0;
  const e = (_opsBy[label] ||= { runs: 0, ms: 0 });
  e.runs++;
  e.ms += ms || 0;
}
export function snapshotOps() {
  const by = {};
  for (const [k, v] of Object.entries(_opsBy)) by[k] = { ...v };
  return { ..._ops, by };
}
export function diffOps(prev) {
  const by = {};
  for (const [k, v] of Object.entries(_opsBy)) {
    const p = prev?.by?.[k] || { runs: 0, ms: 0 };
    const runs = v.runs - p.runs;
    if (runs > 0) by[k] = { runs, ms: Math.round(v.ms - p.ms) };
  }
  return { runs: _ops.runs - (prev?.runs || 0), ms: Math.round(_ops.ms - (prev?.ms || 0)), by };
}

// ── Render-cause attribution (opt-in: window.__RENDER_ATTR = true) ─────────
// Answers WHY a memo'd component re-rendered: which prop / subscribed
// selector output changed identity since its previous render. Each render's
// changed-key set becomes a "cause" bucket; the drop stopwatch diffs the
// buckets across the frame-1 window. `(none)` = no captured input changed —
// i.e. a local state / uncaptured subscription fired.
const _attrs = _store.attrs; // { kind: { "keyA+keyB": count } }

export function useRenderAttribution(kind, inputs, tag) {
  const ref = useRef(null);
  if (typeof window === "undefined" || window.__RENDER_ATTR !== true) {
    ref.current = null;
    return;
  }
  const prev = ref.current;
  if (prev) {
    const changed = [];
    for (const k of Object.keys(inputs)) {
      if (!Object.is(inputs[k], prev[k])) changed.push(k);
    }
    // Unexplained renders get bucketed by the component's tag + a 250ms
    // time bin relative to the drop, so the probe shows WHERE they live and
    // WHEN they happened (frame-1 commit vs later drain chunks).
    let bin = "";
    if (!changed.length && typeof window.__probeDropT === "number") {
      bin = ` #${Math.floor((performance.now() - window.__probeDropT) / 250) * 250}ms`;
    }
    const cause = changed.length
      ? changed.sort().join("+")
      : `(none)${tag ? ` @${tag}` : ""}${bin}`;
    const m = (_attrs[kind] ||= {});
    m[cause] = (m[cause] || 0) + 1;
  }
  ref.current = inputs;
}

export function snapshotAttrs() {
  const out = {};
  for (const k of Object.keys(_attrs)) out[k] = { ..._attrs[k] };
  return out;
}

export function diffAttrs(prev) {
  const out = {};
  for (const kind of Object.keys(_attrs)) {
    const d = {};
    for (const cause of Object.keys(_attrs[kind])) {
      const n = _attrs[kind][cause] - (prev?.[kind]?.[cause] || 0);
      if (n > 0) d[cause] = n;
    }
    if (Object.keys(d).length) out[kind] = d;
  }
  return out;
}

// ── Console accessor ───────────────────────────────────────────────────────
// The tallies above have always been collected and were reachable only from
// inside DragProvider's drop stopwatch, so a question like "how much of the
// grid re-renders when I tick a checkbox?" could not be asked from the
// console. `window.__renderTally()` returns a snapshot; call it either side of
// an interaction and diff. Zero cost (the counters increment regardless), and
// the same opt-in-diagnostic shape as `window.__gapStuck()`.
if (typeof window !== "undefined") {
  window.__renderTally = () => ({ renders: snapshotRenders(), ops: snapshotOps() });
  window.__renderDiff = (prev) => ({
    renders: diffRenders(prev?.renders),
    ops: diffOps(prev?.ops),
  });
  // WHY those components re-rendered, not just how many. The buckets have been
  // collected since the frame-1 work and were reachable only from inside
  // DragProvider's drop stopwatch — so "3,794 field renders during a load"
  // could be counted and not explained. Costs nothing unless
  // `window.__RENDER_ATTR = true` (useRenderAttribution returns early).
  window.__renderAttrs = () => snapshotAttrs();
  window.__renderAttrDiff = (prev) => diffAttrs(prev);
}
