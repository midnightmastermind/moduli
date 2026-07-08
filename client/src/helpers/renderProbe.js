// DIAG: render tally — counts component renders so we can measure how much of
// the grid re-renders on a single interaction (e.g. one drop). Zero cost when
// off: enable in the console with `window.__RENDER_PROBE = true`.
//
// Usage: components call `bumpRender("panel")` in their render body; the drop
// stopwatch snapshots before the drop and diffs after paint to report how many
// panels / containers / instances re-rendered for a change that should have
// touched only one.

import { useRef } from "react";

const _tally = { panel: 0, container: 0, instance: 0, page: 0, field: 0 };

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

// ── Render-cause attribution (opt-in: window.__RENDER_ATTR = true) ─────────
// Answers WHY a memo'd component re-rendered: which prop / subscribed
// selector output changed identity since its previous render. Each render's
// changed-key set becomes a "cause" bucket; the drop stopwatch diffs the
// buckets across the frame-1 window. `(none)` = no captured input changed —
// i.e. a local state / uncaptured subscription fired.
const _attrs = {}; // { kind: { "keyA+keyB": count } }

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
