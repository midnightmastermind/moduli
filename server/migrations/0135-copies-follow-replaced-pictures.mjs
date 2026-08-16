// server/migrations/0135-copies-follow-replaced-pictures.mjs
//
// The other half of `0134`. That migration REPLACED Apple's pictures at the
// source; the Ingredients and Grocery boards render feedSync COPIES, whose
// field values are a snapshot taken when they were minted — so the board still
// showed the laptops.
//
// ── WHY `0132` DOES NOT COVER THIS, AND WHY THAT IS STILL RIGHT ────────────
// `0132` syncs a copy only when it STRICTLY helps: the source offers MORE
// files, or what the copy points at no longer resolves. Apple went from four
// pictures to four, all resolving, so it is invisible to that rule. Loosening
// `0132` to "any difference" is the wrong fix — its own header records why:
// for books and courses a same-count difference is drift where the copy's
// artifact is as likely to be the good one, and overwriting that would swap a
// working picture for another on a hunch.
//
// So this is SCOPED TO THE NAMES `0134` ACTUALLY REPLACED. It imports that
// list rather than restating it, so the two cannot drift; adding a name there
// covers it here for free. Everything else on the grid is untouched.
//
// Idempotent: a copy already matching its source is skipped.
import { AMBIGUOUS } from "./0134-apple-fruit-and-zucchini-row.mjs";

export const id = "0135-copies-follow-replaced-pictures";
export const describe = "Feed copies of the re-searched ingredients take their source's new pictures.";

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

  const isTarget = (o) => !!AMBIGUOUS[nameOf(o).trim().toLowerCase()];
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  const plan = [];
  for (const c of occs) {
    const srcId = c.meta?.feedSourceId;
    if (!srcId) continue;
    const src = byId.get(srcId);
    if (!src || !isTarget(src)) continue;
    const set = {}; const detail = [];
    ids.forEach((f, i) => {
      const from = src.fields?.[f], cur = c.fields?.[f];
      if (same(from?.value, cur?.value)) return;
      // A source with nothing must never blank a copy that has something.
      if (from?.value == null || (Array.isArray(from.value) && !from.value.length)) return;
      set[`fields.${f}`] = { ...from };
      detail.push(SYNCED[i]);
    });
    if (Object.keys(set).length) plan.push({ copy: c, src, set, detail });
  }

  log(`names 0134 re-searched: ${Object.keys(AMBIGUOUS).join(", ")}`);
  log(`feed copies of those, out of date: ${plan.length}`);
  for (const p of plan) log(`   ${nameOf(p.copy).padEnd(20)} <- its source   (${p.detail.join(", ")})`);
  if (!plan.length) { log(`every copy already matches its source.`); return; }
  if (dryRun) { log(`WOULD update ${plan.length} copy(ies).`); return; }

  for (const p of plan) await Occurrence.updateOne({ gridId, id: p.copy.id }, { $set: p.set });
  log(`updated ${plan.length} copy(ies).`);

  // Read the result back: does the copy now point at the same pictures as its
  // source? That is the thing the board renders.
  const after = await Occurrence.find({ gridId, id: { $in: plan.map((p) => p.copy.id) } }).lean();
  const am = new Map(after.map((o) => [o.id, o]));
  const FILES = fid("Files");
  for (const p of plan) {
    const c = am.get(p.copy.id);
    log(`  check: ${nameOf(p.copy)} matches its source: ${same(c.fields?.[FILES]?.value, p.src.fields?.[FILES]?.value)}`);
  }
}
