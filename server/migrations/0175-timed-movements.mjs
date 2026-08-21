/**
 * 0175 — `Time 1/2/3` on a movement that is HELD rather than counted.
 *
 * USER, 2026-08-21: *"also add in a time field to put on things like planks and side planks instead
 * of weight"*, then naming them: *"Time 1 Time 2 Time 3"* — the per-set shape `Set N` / `Weight N`
 * already uses.
 *
 * **THIS CLOSES AN ITEM THIS REPO FLAGGED AND DELIBERATELY LEFT TO THE USER.** 2026-08-20 (3):
 * *"Planks and Side Planks read `Set 1: 1 reps`, because `0119` backfilled the catalog prescription
 * and a plank is TIMED rather than counted. It is the prescription the catalog holds, so changing it
 * is the user's call, not a migration's."* This is that call.
 *
 * ── "TIMED" IS SELF-DESCRIBING, so there is no marker field to keep in sync ────────────────────
 *
 * A movement is timed when its CATALOG OPTION carries a `Time 1` prescription. Nothing else has to
 * be maintained: give a movement a time and it is timed; the migration re-run picks it up. The
 * alternative — a `Timed` boolean bound on 24 option modules — is a second thing that can disagree
 * with the first, which is the inert-field class this repo keeps removing.
 *
 * The two the plan names are seeded here BECAUSE THE MIGRATION IS AUTHORING DATA, which is the one
 * place a domain concept may be named (`noDomainKnowledge` guards the generic RENDERER, not this).
 * Values are the plan's own, read out of `Fitness Plan.md` rather than invented:
 *
 *     Planks       "3 sets of 1 minute"                 -> 60 sec
 *     Side Planks  "3 sets of 30-45 seconds per side"   -> 45 sec   <- A RANGE, and the TOP of it
 *
 * **The 45 is the one number that is a choice rather than a reading, and it is flagged as such.**
 * The plan gives a band; a prescription needs one figure; the target end of the band is the one you
 * work toward. It is one value in a catalog the user can edit.
 *
 * ── THE BOGUS `1 reps` IS CLEARED, and only where nobody entered it ───────────────────────────
 *
 * `0119` backfilled `Set 1/2/3 = 1` onto both, which renders as "1 reps" on a movement that has no
 * reps. Cleared on the catalog options, and on a ROW only when its value still EQUALS the catalog's
 * — `0109`'s discriminator. **A row is a LOG as well as a prescription**, so a set count the user
 * typed is never touched, and neither is a ticked row's record.
 *
 * ── THE BINDING SWAP IS WHAT "INSTEAD OF WEIGHT" MEANS ───────────────────────────────────────
 *
 * On a row whose Movement pick is timed, each `Weight N` binding is REPLACED by `Time N` in place,
 * so the row reads `Set 1 · Time 1 · Set 2 · Time 2 …` in the same order the counted rows read.
 * Binding order is render order, so replacing in place rather than appending is what keeps the two
 * kinds of row looking like each other.
 *
 * **IT LANDS ON THE TEMPLATE, AND THAT IS WHY IT KEEPS WORKING.** Both live plank rows sit on the
 * Thursday weekday template, and `APPLY_TEMPLATE`'s clone copies the source module's
 * `fieldBindings` — so every column built from Thursday inherits the swap without an operation
 * having to re-derive it each morning. Rows already placed elsewhere are swapped too.
 *
 * ── THE HONEST GAP ───────────────────────────────────────────────────────────────────────────
 *
 * Picking Planks by hand on a FRESH Exercise row still gives that row `Weight N`, because bindings
 * are decided when the row is minted and nothing re-derives them on a pick. Making that automatic
 * needs an op writing `fieldVisibility` per row — the capability `0171` just introduced — and it is
 * stated here rather than half-shipped.
 */
const uid = () => Math.random().toString(36).slice(2, 14);

/** The plan's own prescriptions. Seeds the first run; later runs derive from the data. */
const SEED = { "Planks": 60, "Side Planks": 45 };
const SETS = 3;

export const id = "0175-timed-movements";
export const describe =
  "Time 1/2/3 (seconds) replace Weight N on movements that are held rather than counted.";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const [occs, mods, fields] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(), Field.find({ gridId }).lean(),
  ]);
  const mById = new Map(mods.map((m) => [m.id, m]));
  const oById = new Map(occs.map((o) => [o.id, o]));
  const lbl = (o) => o?.label || mById.get(o?.moduleId)?.label || o?.id;

  const MOVEMENT = fields.find((f) => f.name === "Movement" && !f.displayEnabled)?.id;
  const setIds = [1, 2, 3, 4].map((n) => fields.find((f) => f.name === `Set ${n}` && !f.displayEnabled)?.id);
  const wtIds = [1, 2, 3, 4].map((n) => fields.find((f) => f.name === `Weight ${n}` && !f.displayEnabled)?.id);
  const exemplar = fields.find((f) => f.name === "Weight 1" && !f.displayEnabled);
  if (!MOVEMENT || !exemplar) { log("  REFUSING: no Movement / Weight 1 field to work from"); return; }

  // ── 1. the Time fields, shaped like the Weight field beside them ──────────
  const timeIds = [];
  const toCreate = [];
  for (let n = 1; n <= SETS; n++) {
    const existing = fields.find((f) => f.name === `Time ${n}` && !f.displayEnabled);
    if (existing) { timeIds.push(existing.id); continue; }
    const doc = {
      id: uid(), gridId, userId: exemplar.userId, name: `Time ${n}`, type: "number",
      inputEnabled: true, displayEnabled: false, folderId: exemplar.folderId ?? null,
      // Seconds, in 5s steps. NOT the `duration` type: that renders hours+minutes
      // and cannot express 45 seconds at all.
      meta: { postfix: " sec", increment: 5, flow: "in", min: 0 },
    };
    toCreate.push(doc); timeIds.push(doc.id);
  }
  log(`  Time fields: ${SETS - toCreate.length} existing · ${toCreate.length} to create`);

  // ── 2. which movements are timed ──────────────────────────────────────────
  // Self-describing: an option carrying a Time 1 prescription. Seeded by name on
  // the first run only, because the first run is what authors the data.
  const isOption = (o) => mById.get(o.moduleId)?.role === "instance" && !o.meta?.feedSourceId;
  const carriesTime = (o) => timeIds[0] && o.fields?.[timeIds[0]]?.value != null && o.fields[timeIds[0]].value !== "";
  const picked = new Set();
  for (const o of occs) {
    const v = o.fields?.[MOVEMENT]?.value;
    if (v) for (const x of (Array.isArray(v) ? v : [v])) picked.add(x);
  }
  const timedOptions = occs.filter((o) =>
    isOption(o) && picked.has(o.id) && (carriesTime(o) || SEED[String(lbl(o))] != null));
  if (!timedOptions.length) { log("  no timed movements found — nothing to do"); return; }
  log(`  timed movements: ${timedOptions.map((o) => `${lbl(o)} (${SEED[String(lbl(o))] ?? "already set"}s)`).join(" · ")}`);

  const timedIds = new Set(timedOptions.map((o) => o.id));
  const rows = occs.filter((o) => {
    const v = o.fields?.[MOVEMENT]?.value;
    return v && (Array.isArray(v) ? v : [v]).some((x) => timedIds.has(x)) && !o.meta?.feedSourceId;
  });
  log(`  rows picking one: ${rows.length}${rows.length ? " — " + rows.map((r) => `${lbl(oById.get(r.parentId))}/${lbl(oById.get(oById.get(r.parentId)?.parentId))}`).join(", ") : ""}`);

  // ── 3. plan the writes ────────────────────────────────────────────────────
  const bindSwap = (m) => {
    const bs = [...(m.fieldBindings || [])];
    let changed = false, ti = 0;
    for (let i = 0; i < bs.length; i++) {
      const w = wtIds.indexOf(bs[i].fieldId);
      if (w < 0) continue;
      if (ti < timeIds.length) { bs[i] = { fieldId: timeIds[ti++], role: "input" }; }
      else { bs.splice(i, 1); i--; }               // a 4th weight has no 4th time
      changed = true;
    }
    // Already swapped on a previous run? Then nothing above matched and the Time
    // bindings are present — leave it alone.
    return changed ? bs : null;
  };

  const modPlan = [];
  for (const m of new Map([...timedOptions, ...rows].map((o) => [o.moduleId, mById.get(o.moduleId)])).values()) {
    if (!m) continue;
    const isOpt = timedOptions.some((o) => o.moduleId === m.id);
    if (isOpt) {
      // The option needs somewhere to HOLD the prescription; its Weight bindings
      // are as meaningless as the row's.
      const bs = bindSwap(m) || [...(m.fieldBindings || [])];
      for (const tid of timeIds) if (!bs.some((b) => b.fieldId === tid)) bs.push({ fieldId: tid, role: "input" });
      if (JSON.stringify(bs) !== JSON.stringify(m.fieldBindings || [])) modPlan.push({ m, bs });
    } else {
      const bs = bindSwap(m);
      if (bs) modPlan.push({ m, bs });
    }
  }

  const occPlan = [];
  const catalogSet = new Map();     // option id -> its Set N values, for the "nobody entered this" test
  for (const opt of timedOptions) {
    catalogSet.set(opt.id, setIds.map((f) => (f ? opt.fields?.[f]?.value : undefined)));
    const set = {}, unset = {};
    const secs = SEED[String(lbl(opt))] ?? opt.fields?.[timeIds[0]]?.value;
    for (const tid of timeIds) {
      if (opt.fields?.[tid]?.value == null || opt.fields[tid].value === "") set[`fields.${tid}`] = { value: secs, flow: "in" };
    }
    // The bogus "1 rep" prescription.
    for (const f of setIds) if (f && opt.fields?.[f]?.value != null) unset[`fields.${f}`] = "";
    if (Object.keys(set).length || Object.keys(unset).length) occPlan.push({ o: opt, set, unset, why: "catalog" });
  }
  for (const r of rows) {
    const v = r.fields[MOVEMENT].value;
    const optId = (Array.isArray(v) ? v : [v]).find((x) => timedIds.has(x));
    const opt = oById.get(optId);
    const secs = SEED[String(lbl(opt))] ?? opt?.fields?.[timeIds[0]]?.value;
    const set = {}, unset = {};
    for (const tid of timeIds) {
      // 0119's rule: fill only what is EMPTY. A performed time is a record.
      if (r.fields?.[tid]?.value == null || r.fields[tid].value === "") set[`fields.${tid}`] = { value: secs, flow: "in" };
    }
    const cat = catalogSet.get(optId) || [];
    setIds.forEach((f, i) => {
      if (!f) return;
      const val = r.fields?.[f]?.value;
      if (val == null) return;
      // ONLY when it still equals what the catalog prescribed — anything the user
      // typed, or a different number, is left exactly as it is and reported.
      if (val === cat[i]) unset[`fields.${f}`] = "";
      else log(`    KEEPING ${lbl(opt)} Set ${i + 1} = ${JSON.stringify(val)} — differs from the catalog's ${JSON.stringify(cat[i])}, so somebody entered it`);
    });
    if (Object.keys(set).length || Object.keys(unset).length) occPlan.push({ o: r, set, unset, why: "row" });
  }

  log(`  modules to re-bind: ${modPlan.length} · occurrences to write: ${occPlan.length}`);
  for (const p of modPlan) log(`    ${p.m.label || p.m.id}: ${(p.m.fieldBindings || []).length} -> ${p.bs.length} binding(s)`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const f of toCreate) await Field.create(f);
  for (const p of modPlan) await Module.updateOne({ id: p.m.id, gridId }, { $set: { fieldBindings: p.bs } });
  for (const p of occPlan) {
    const update = {};
    if (Object.keys(p.set).length) update.$set = p.set;
    if (Object.keys(p.unset).length) update.$unset = p.unset;
    if (Object.keys(update).length) await Occurrence.updateOne({ id: p.o.id, gridId }, update);
  }
  log(`  created ${toCreate.length} field(s), re-bound ${modPlan.length} module(s), wrote ${occPlan.length} occurrence(s) — RESTART pm2 and reload.`);
}
