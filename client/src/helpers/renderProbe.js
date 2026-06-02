// DIAG: render tally — counts component renders so we can measure how much of
// the grid re-renders on a single interaction (e.g. one drop). Zero cost when
// off: enable in the console with `window.__RENDER_PROBE = true`.
//
// Usage: components call `bumpRender("panel")` in their render body; the drop
// stopwatch snapshots before the drop and diffs after paint to report how many
// panels / containers / instances re-rendered for a change that should have
// touched only one.

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
