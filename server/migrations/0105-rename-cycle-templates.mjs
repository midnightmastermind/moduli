// server/migrations/0105-rename-cycle-templates.mjs
//
// User, 2026-08-13: "dont call them by the workout name, call it Schedule -
// Day 1, etc" … "the templates i mean".
//
// `0104` named them after the training split — "Day 1 — Push". The user wants
// them named by their POSITION IN THE CYCLE, not by what they train. That is
// the more durable name: the split is a fact about today's Fitness Plan and
// will change the next time the plan does; "Day 1" is a fact about the
// rotation, which is the thing `Schedule: Place Cycle Day` selects on.
//
// THE RENAME IS ON THE MODULE, and only the module. Nothing resolves these
// templates by label — `0106` and the rotation op both hold occurrence ids —
// so this cannot break a lookup. It is checked rather than asserted: the
// migration REFUSES if anything else on the grid names one of them by label.
//
// IT RUNS AFTER 0104 AND THAT ORDER IS LOAD-BEARING. 0104's own existence
// check keys on the old label, so a fresh seed builds "Day 1 — Push" and this
// renames it. Re-running 0104 against an already-renamed grid would build four
// MORE templates — which is exactly what the applied-ledger exists to prevent,
// and why the rename is a separate migration rather than an edit to 0104.
export const id = "0105-rename-cycle-templates";
export const describe =
  'The four cycle templates are named "Schedule - Day N", not by their training split.';

// old label -> new label. Keyed by the cycle number, which is the durable part.
export const RENAMES = [
  ["Day 1 — Push", "Schedule - Day 1"],
  ["Day 2 — Legs", "Schedule - Day 2"],
  ["Day 3 — Pull", "Schedule - Day 3"],
  ["Day 4 — Rest", "Schedule - Day 4"],
];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";

  // Resolve each template as the MODULE carrying the template marker, so a
  // same-named occurrence elsewhere on the grid can never be picked up.
  const plan = [];
  for (const [from, to] of RENAMES) {
    const already = mods.find((m) => m.label === to && m.meta?.templateModule === true);
    if (already) { log(`  "${to}" already renamed`); continue; }
    const mod = mods.find((m) => m.label === from && m.meta?.templateModule === true);
    if (!mod) { log(`  REFUSING "${from}" — no template module with that label`); continue; }
    plan.push({ mod, from, to });
  }

  // A label is only safe to change when nothing resolves BY it. Checked, not
  // assumed: an occurrence carrying its own label override, or an operation
  // naming it, would keep reading the old string after the rename.
  const opJson = JSON.stringify(
    await models.Operation.find({ gridId }).lean().then((o) => o ?? []),
  );
  for (const p of plan) {
    const overrides = occs.filter((o) => o.label === p.from);
    if (overrides.length) {
      log(`  REFUSING "${p.from}" — ${overrides.length} occurrence(s) carry it as a label override`);
      p.skip = true;
    }
    if (opJson.includes(p.from)) {
      log(`  REFUSING "${p.from}" — an operation names it`);
      p.skip = true;
    }
  }
  const go = plan.filter((p) => !p.skip);

  for (const p of go) {
    const occCount = occs.filter((o) => o.moduleId === p.mod.id).length;
    log(`  "${p.from}" -> "${p.to}"   module ${p.mod.id} · ${occCount} placement(s)`);
  }
  if (!go.length) { log(`nothing to rename.`); return; }
  if (dryRun) { log(`WOULD rename ${go.length} template module(s).`); return; }

  for (const p of go) {
    await Module.updateOne({ gridId, id: p.mod.id }, { $set: { label: p.to } });
  }
  log(`renamed ${go.length} cycle template(s).`);
  // Read back rather than trust the writes — the check that matters is that
  // each new name resolves to exactly one template module.
  const after = await Module.find({ gridId, meta: { $ne: null } }).lean();
  for (const [, to] of RENAMES) {
    const hits = after.filter((m) => m.label === to && m.meta?.templateModule === true);
    log(`  ${to}: ${hits.length} template module(s)`);
  }
  void nameOf;
}
