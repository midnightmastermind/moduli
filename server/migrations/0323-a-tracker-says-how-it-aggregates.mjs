// A tracker now SAYS whether it is a running balance or a sum of movement.
//
// User, 2026-09-08: *"maybe add another field if that may help. something called
// aggregation. total and current would be the values. that would determine if we
// use 0 as the baseline or set"* -> *"current wouldnt be today. current would
// just be current balance"* -> *"the current vs total thing is more for the
// nondate but since we would have it set either way, it would determine if its a
// current up through that day we set or total for that day."*
//
//     current   start from the last `replace` you set, apply everything after
//               -> WHAT YOU HAVE.  With a date filter: as of the END of it.
//     total     start at 0, add up the movement in scope, ignore any baseline
//               -> HOW MUCH MOVED. With a date filter: that period only.
//
// So `Aggregation` decides the ARITHMETIC and the date filter decides the
// CUT-OFF. Today those are tangled: whether a balance uses its baseline depends
// on whether the tile happens to carry its own date filter, so filtering a
// balance to a day silently turns it into that day's change (90 -> -10) with
// nothing on screen saying so.
//
// THIS MIGRATION ONLY ADDS THE FIELD AND THE VALUES. It changes no arithmetic —
// that is the next step, and separating them means the assignment below can be
// read and corrected before anything starts computing differently.
//
// ── WHICH TILES ARE `current` IS DERIVED, NOT LISTED ──────────────────────
//
// A tracker is a running balance exactly when its operation does a baseline
// scan — the `$baseDate` var that `supportsReplace` emits. That is a fact about
// the pipeline, so a tracker that gains or loses replace support is classified
// correctly without anyone remembering this file. Net Worth is `current` too:
// it sums balances, so it is one.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";

export const id = "0323-a-tracker-says-how-it-aggregates";
export const description = "Tracker tiles carry an Aggregation of current | total.";
export const touches = ["fields", "modules", "occurrences", "operations"];

const FIELD_NAME = "Aggregation";
const VALUES = ["current", "total"];
const rid = () => "g" + Math.random().toString(36).slice(2, 11);

const walk = (n, fn) => {
  if (Array.isArray(n)) return n.forEach((x) => walk(x, fn));
  if (n && typeof n === "object") { fn(n); Object.values(n).forEach((v) => walk(v, fn)); }
};

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const mods   = await Module.find({ gridId: gid }).lean();
  const occs   = await Occurrence.find({ gridId: gid }).lean();
  const ops    = await Operation.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const occById = Object.fromEntries(occs.map((o) => [o.id, o]));
  const labelOf = (o) => o && (o.label || modById[o.moduleId]?.label || "(unlabeled)");

  // ── 1. THE FIELD ────────────────────────────────────────────────────────
  let field = fields.find((f) => f.name === FIELD_NAME);
  if (field && field.type !== "select")
    throw new Error(`"${FIELD_NAME}" exists as type ${field.type}, expected select - refusing`);
  if (!field) {
    field = {
      id: rid(), gridId: gid, userId: mods[0]?.userId, name: FIELD_NAME, type: "select",
      inputEnabled: true, displayEnabled: false,
      meta: { multiple: false, optionsSource: { mode: "manual", values: VALUES } },
    };
    log(`  creating field "${FIELD_NAME}" (select: ${VALUES.join(" | ")})`);
    if (apply) await Field.create(field);
  } else log(`  field "${FIELD_NAME}" already exists (${field.id})`);

  // ── 2. WHICH TILE EACH OP WRITES, AND HOW IT AGGREGATES ─────────────────
  // `$baseDate` is emitted only by the replace-baseline scan, so its presence
  // IS "this tracker is a running balance".
  const plan = new Map();          // occurrenceId -> "current" | "total"
  for (const op of ops.filter((o) => o.enabled !== false)) {
    const usesBaseline = JSON.stringify(op.pipeline || {}).includes("$baseDate");
    const tiles = new Set();
    walk(op.pipeline, (n) => {
      const c = n.config || {};
      if (c.type !== "INIT_VAR" || typeof c.expr !== "string") return;
      const m = /^\$allItemsById\.([A-Za-z0-9_-]+)$/.exec(c.expr);
      if (m && occById[m[1]] && modById[occById[m[1]].moduleId]?.role === "instance") tiles.add(m[1]);
    });
    for (const t of tiles) {
      const want = usesBaseline ? "current" : "total";
      // `current` wins: a tile any balance op writes IS a balance, even if some
      // other op also reads it.
      if (plan.get(t) !== "current") plan.set(t, want);
    }
  }
  // Net Worth sums balances, so it is one — found by the fields it ADDS rather
  // than by its name.
  for (const op of ops.filter((o) => o.enabled !== false)) {
    const addsBalances = JSON.stringify(op.pipeline || {}).includes("$baseDate");
    if (addsBalances) continue;
    walk(op.pipeline, (n) => {
      const c = n.config || {};
      if (c.type !== "INIT_VAR" || typeof c.expr !== "string") return;
      const m = /^\$allItemsById\.([A-Za-z0-9_-]+)$/.exec(c.expr);
      if (!m) return;
      const tile = occById[m[1]];
      if (!tile) return;
      // A tile whose own op reads a field another op computes with a baseline.
      const reads = JSON.stringify(op.pipeline);
      const balanceFields = new Set();
      for (const other of ops) {
        if (!JSON.stringify(other.pipeline || {}).includes("$baseDate")) continue;
        walk(other.pipeline, (b) => {
          const bc = b.config || {};
          if (bc.type === "UPDATE" && typeof bc.path === "string") {
            const f = /\.fields\.([A-Za-z0-9_-]+)\.value/.exec(bc.path);
            if (f) balanceFields.add(f[1]);
          }
        });
      }
      if ([...balanceFields].some((f) => reads.includes(f))) plan.set(m[1], "current");
    });
  }

  const current = [...plan].filter(([, v]) => v === "current");
  const total   = [...plan].filter(([, v]) => v === "total");
  log(`  current (a running balance): ${current.map(([i]) => labelOf(occById[i])).join(" · ") || "none"}`);
  log(`  total   (a sum of movement): ${total.length} tile(s) — ${total.slice(0, 6).map(([i]) => labelOf(occById[i])).join(" · ")}${total.length > 6 ? " …" : ""}`);

  if (!current.length) throw new Error(`no tracker classified as "current" - refusing (nothing uses a baseline?)`);

  // ── 3. STAMP + BIND HIDDEN ──────────────────────────────────────────────
  let stamped = 0, bound = 0;
  for (const [oid, value] of plan) {
    const occ = occById[oid];
    if (occ.fields?.[field.id]?.value === value) continue;
    if (apply) await Occurrence.updateOne({ id: oid, gridId: gid },
      { $set: { [`fields.${field.id}`]: { value, flow: "in" } } });
    stamped++;
    const mod = modById[occ.moduleId];
    if (mod && !(mod.fieldBindings || []).some((b) => b.fieldId === field.id)) {
      const next = [...(mod.fieldBindings || []),
        { fieldId: field.id, role: "input", order: (mod.fieldBindings || []).length, hidden: true }];
      if (apply) await Module.updateOne({ id: mod.id, gridId: gid }, { $set: { fieldBindings: next } });
      bound++;
    }
  }
  log(`  ${stamped} tile(s) stamped, ${bound} module binding(s) added.`);
  log(`  NOTE: this changes no arithmetic yet — it records how each tracker aggregates.`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
