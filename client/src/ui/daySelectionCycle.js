// client/src/ui/daySelectionCycle.js
// Pure "on → link → off" tri-state day-selection model for the filter date
// picker. Each day cycles by repeated clicks:
//   unselected  --click-->  distinct  (an isolated selected day)
//   distinct    --click-->  range     (links/fills to nearest selected
//                                       neighbor(s); if none → off)
//   range       --click-->  off       (removed — trims/punches the bar)
//
// State shape: { keys: string[] (sorted ISO "YYYY-MM-DD"),
//                kind: { [iso]: "distinct" | "range" } }
//
// Invariant: a "range" run is >=2 contiguous range-keys. A lone range-key is
// demoted to "distinct" (a bar can't be one day). Adjacent *distinct* days
// stay distinct (they do NOT auto-merge into a range) — only an explicit
// link (the 2nd click on a distinct day) forms a range.

function toDate(k) {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(k, n) {
  const d = toDate(k);
  d.setDate(d.getDate() + n);
  return iso(d);
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function emptySelection() {
  return { keys: [], kind: {} };
}

// Re-derive a working state from a flat list of ISO days (e.g. on reopen):
// contiguous runs of >=2 days → range; isolated days → distinct.
export function seedSelection(dates) {
  const keys = [...new Set((dates || []).map((s) => String(s).slice(0, 10)))].filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)).sort(cmp);
  const kind = {};
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const prevContig = i > 0 && keys[i - 1] === addDays(k, -1);
    const nextContig = i < keys.length - 1 && keys[i + 1] === addDays(k, 1);
    kind[k] = prevContig || nextContig ? "range" : "distinct";
  }
  return { keys, kind };
}

// Normalize: sort/unique keys, and demote any lone "range" key (no contiguous
// range neighbor) back to "distinct". Neighbor checks read the INCOMING kind
// snapshot so there's no demotion cascade through a valid bar.
function normalize(state) {
  const keys = [...new Set(state.keys)].sort(cmp);
  const src = state.kind || {};
  const kind = {};
  for (const k of keys) {
    let kk = src[k] || "distinct";
    if (kk === "range") {
      const prev = addDays(k, -1);
      const next = addDays(k, 1);
      if (src[prev] !== "range" && src[next] !== "range") kk = "distinct";
    }
    kind[k] = kk;
  }
  return { keys, kind };
}

// Advance one day through its cycle.
export function cycleDay(state, day) {
  const keys = state.keys || [];
  const kind = { ...(state.kind || {}) };
  const current = kind[day];

  // unselected → distinct
  if (current === undefined) {
    kind[day] = "distinct";
    return normalize({ keys: [...keys, day], kind });
  }

  // range → off (remove just this day; bar trims/splits, lone remnants demote)
  if (current === "range") {
    delete kind[day];
    return normalize({ keys: keys.filter((k) => k !== day), kind });
  }

  // distinct → link (fill to nearest selected neighbor(s)); if none → off
  const left = keys.filter((k) => k < day).sort(cmp).pop() || null;
  const right = keys.filter((k) => k > day).sort(cmp).shift() || null;
  if (!left && !right) {
    delete kind[day];
    return normalize({ keys: keys.filter((k) => k !== day), kind });
  }
  const lo = left || day;
  const hi = right || day;
  const nextKeys = new Set(keys);
  let cur = lo;
  while (cur <= hi) {
    nextKeys.add(cur);
    kind[cur] = "range";
    cur = addDays(cur, 1);
  }
  return normalize({ keys: [...nextKeys], kind });
}


// For rendering a connected bar: where this day sits within its range run.
// Returns null for unselected/distinct days.
export function barPosition(state, key) {
  if (state?.kind?.[key] !== "range") return null;
  const leftRange = state.kind[addDays(key, -1)] === "range";
  const rightRange = state.kind[addDays(key, 1)] === "range";
  if (leftRange && rightRange) return "mid";
  if (leftRange) return "end";
  if (rightRange) return "start";
  return "single"; // shouldn't happen post-normalize, but safe
}
