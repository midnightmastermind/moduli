// Two trackers stopped recomputing when you change the date, and a rename in
// July is why.
//
// User, 2026-09-08: *"would it be easier not to look at labels since those
// change but to mark occurances with a certain field like we do with a lot of
// them"* — and the measurement says yes. **48 of 74 enabled operations scope a
// trigger by a page's literal LABEL** (`ancestorLabel: "Trackers"` on 43,
// `"Schedule"` on 35). Rename either page and those triggers silently stop
// matching; nothing errors.
//
// IT HAS ALREADY HAPPENED. The Goals page became "Trackers" on 2026-07-25 and
// a post-save pass rescoped the ops it knew about — these two were missed:
//
//     Completed Habits   onFilterChange / filterNav   ancestorLabel="Goals"
//     Sleep Time         onFilterChange / filterNav   ancestorLabel="Goals"
//
// The only occurrences still labelled "Goals" are **Project Scope sections
// inside project pages**, so that trigger entry cannot fire for a Trackers
// navigation. Both ops still recompute on load and on a `Completed` write, so
// this is a PARTIAL silent failure — the worst kind: navigate to another day
// and those two tiles keep the number they already had.
//
// ── `ancestorId` ALREADY EXISTS, and that is the whole fix ────────────────
//
// `matchAncestorScope` checks `ancestorId` against the transaction's
// `_ancestorIds` before it ever looks at labels. An id survives a rename; a
// label does not. This repoints these two and leaves the other 46 alone — a
// 48-op trigger rewrite is worth doing and is not something to bundle into a
// repair of two.
//
// ── THE TARGET IS DERIVED, NOT NAMED ──────────────────────────────────────
//
// Resolving "Trackers" by label would repeat the mistake in the same commit —
// TWO occurrences carry that label (the real page/board with 10 children and an
// empty page/folder). So the scope is the page that actually CONTAINS the op's
// own goal tile, which has exactly one answer in the data.
//
// Idempotent.
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0318-a-trigger-scoped-by-a-name-that-changed";
export const description =
  "Two trackers were scoped to a page name that no longer exists; scope by id instead.";
export const touches = ["modules", "occurrences", "operations"];

const STALE = "Goals";

const walk = (n, fn) => {
  if (Array.isArray(n)) return n.forEach((x) => walk(x, fn));
  if (n && typeof n === "object") { fn(n); Object.values(n).forEach((v) => walk(v, fn)); }
};

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const occs = await Occurrence.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const ops  = await Operation.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const occById = Object.fromEntries(occs.map((o) => [o.id, o]));
  const labelOf = (o) => o && (o.label || modById[o.moduleId]?.label || "(unlabeled)");

  const parentOf = new Map();
  for (const o of occs) for (const c of o.occurrences || []) parentOf.set(c, o.id);
  const ancestorsOf = (id) => { const out = []; let c = parentOf.get(id), n = 0;
    while (c && n++ < 50) { out.push(c); c = parentOf.get(c); } return out; };

  // Everything still carrying the dead label, so the log says WHY it is dead.
  const carriers = occs.filter((o) => labelOf(o) === STALE);
  log(`  occurrences still labelled "${STALE}": ${carriers.length}` +
      carriers.slice(0, 4).map((o) => `\n      ${modById[o.moduleId]?.role}/${modById[o.moduleId]?.kind || "-"}  under ${labelOf(occById[parentOf.get(o.id)])}`).join(""));

  let fixed = 0, skipped = 0;
  for (const op of ops.filter((o) => o.enabled !== false)) {
    const stale = (op.triggerObjects || []).filter((t) => t?.ancestorLabel === STALE);
    if (!stale.length) continue;

    // The page that holds this op's own goal tile — one answer in the data,
    // and it cannot be confused by a second occurrence sharing a label.
    let tileId = null;
    walk(op.pipeline, (n) => {
      const c = n.config || {};
      if (c.type === "INIT_VAR" && c.name === "$goalItem" && typeof c.expr === "string") {
        const m = /^\$allItemsById\.([A-Za-z0-9_-]+)$/.exec(c.expr);
        if (m && occById[m[1]]) tileId = m[1];
      }
    });
    if (!tileId) { log(`  ${op.name}: no goal tile to derive a scope from - SKIPPED`); skipped++; continue; }

    const pages = ancestorsOf(tileId).filter((a) => modById[occById[a]?.moduleId]?.role === "page");
    if (pages.length !== 1) {
      log(`  ${op.name}: "${labelOf(occById[tileId])}" sits under ${pages.length} page(s) - refusing to guess`);
      skipped++; continue;
    }
    const page = pages[0];

    const next = (op.triggerObjects || []).map((t) => {
      if (t?.ancestorLabel !== STALE) return t;
      const { ancestorLabel, ...rest } = t;
      return { ...rest, ancestorId: page };
    });
    log(`  ${op.name}: ${stale.length} trigger(s) ancestorLabel="${STALE}" -> ancestorId=${page} (${labelOf(occById[page])})`);
    if (apply) await Operation.updateOne({ id: op.id, gridId: gid }, { $set: { triggerObjects: next } });
    fixed++;
  }

  // THE CONTROL: this must not touch the other scoped triggers. 46 ops are
  // still scoped by a live label and are a separate, deliberate pass.
  const remaining = ops.filter((o) => o.enabled !== false)
    .filter((o) => (o.triggerObjects || []).some((t) => t?.ancestorLabel)).length;
  log(`  ${fixed} op(s) ${apply ? "repointed" : "would be repointed"}, ${skipped} skipped.`);
  log(`  still scoped by a LIVE label (left alone, their own pass): ${remaining} op(s)`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
