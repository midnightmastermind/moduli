// server/migrations/0132-feed-copies-carry-their-source-files.mjs
//
// User, 2026-08-16: "im only seeing one image file in these."
//
// `0131` attached 93 alternative photos — to the SOURCE rows. The Ingredients
// and Grocery List boards render feedSync COPIES, and a copy's field values are
// a snapshot taken when it was minted:
//
//     sources       31/33 carry 4 files
//     feed copies    3/19 carry more than one
//
// So every picture opened as a one-window spread, which is exactly what the user
// saw. **The alternatives were never missing; the row being clicked was a stale
// copy of the row they were attached to.**
//
// ── WHY THIS IS A MIGRATION AND NOT A FEEDSYNC FIX ─────────────────────────
// `feedSync` mints a copy when one is missing and sweeps it when the source
// stops matching — it does NOT re-copy field values into a copy that already
// exists. That is defensible (a copy the user has edited should not be silently
// reverted) and it is why these went stale rather than self-healing. Teaching it
// to reconcile values is a real design change to the engine, with a real
// question attached — which side wins on a conflict — so it is not something to
// decide inside a photo fix. This brings the existing copies level; the standing
// rule that a write to a copy is a write to something that may be overwritten
// still holds.
//
// ── IT COPIES THE PICTURE FIELDS ONLY ───────────────────────────────────────
// `Poster` and `Files`, nothing else. A copy's other values (its own tags, any
// per-placement edits) are left exactly as they are, so this cannot quietly
// revert anything but the pictures it is here to fix. Idempotent: a copy already
// matching its source is skipped.
export const id = "0132-feed-copies-carry-their-source-files";
export const describe = "Feed copies of ingredients carry their source's Poster and Files.";

export const SYNCED = ["Poster", "Files"];

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Field.find({ gridId }).lean(),
  ]);
  const modById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const nameOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "?";
  const fid = (n) => fields.find((f) => f.name === n && !f.displayEnabled)?.id;
  const ids = SYNCED.map(fid);
  if (ids.some((x) => !x)) { log(`REFUSING: missing ${SYNCED.join(" / ")}.`); return; }

  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const plan = [];
  for (const c of occs) {
    const srcId = c.meta?.feedSourceId;
    if (!srcId) continue;
    const src = byId.get(srcId);
    if (!src) { log(`  skipping "${nameOf(c)}" — its source ${String(srcId).slice(0, 8)} is gone`); continue; }
    const set = {};
    const detail = [];
    ids.forEach((f, i) => {
      const from = src.fields?.[f];
      const cur = c.fields?.[f];
      if (same(from?.value, cur?.value)) return;
      // A source with no picture must not blank a copy that has one.
      if (from?.value == null || (Array.isArray(from.value) && !from.value.length)) return;
      // ONLY WHEN IT STRICTLY HELPS: the source offers MORE files, or what the
      // copy points at no longer resolves. A same-count difference is drift
      // (books and courses show ten of them) where the copy's artifact is as
      // likely to be the good one — overwriting that would swap a working
      // picture for another on a hunch, which is not what was reported.
      const curIds = Array.isArray(cur?.value) ? cur.value : cur?.value ? [cur.value] : [];
      const fromIds = Array.isArray(from.value) ? from.value : [from.value];
      const curBroken = curIds.length > 0 && curIds.some((id) => !byId.get(id));
      if (fromIds.length <= curIds.length && !curBroken) return;
      set[`fields.${f}`] = { ...from };
      const n = Array.isArray(from.value) ? from.value.length : 1;
      detail.push(`${SYNCED[i]} ${Array.isArray(cur?.value) ? cur.value.length : (cur?.value ? 1 : 0)}->${n}`);
    });
    if (!Object.keys(set).length) continue;
    plan.push({ copy: c, src, set, detail });
  }

  for (const p of plan.slice(0, 12)) {
    log(`  ${nameOf(p.copy).padEnd(24)} <- ${nameOf(p.src).padEnd(24)} ${p.detail.join(" · ")}`);
  }
  if (plan.length > 12) log(`   … ${plan.length - 12} more`);
  const copies = occs.filter((o) => o.meta?.feedSourceId).length;
  log(`feed copies on the grid: ${copies} · out of date on pictures: ${plan.length}`);
  if (!plan.length) { log(`every copy already matches its source.`); return; }
  if (dryRun) { log(`WOULD refresh pictures on ${plan.length} copy(ies).`); return; }

  for (const p of plan) await Occurrence.updateOne({ gridId, id: p.copy.id }, { $set: p.set });
  log(`refreshed ${plan.length} copy(ies).`);

  const after = await Occurrence.find({ gridId, id: { $in: plan.map((p) => p.copy.id) } }).lean();
  const FILES = fid("Files");
  const multi = after.filter((o) => (o.fields?.[FILES]?.value || []).length > 1).length;
  log(`  check: ${multi}/${after.length} refreshed copies now carry more than one file.`);
}
