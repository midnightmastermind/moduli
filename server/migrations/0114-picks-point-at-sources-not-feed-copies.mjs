// server/migrations/0114-picks-point-at-sources-not-feed-copies.mjs
//
// User, 2026-08-13: "the meal dropdown is showing the ids and not the names."
//
// MY BUG, AND THE MECHANISM IS WORTH KEEPING. `0108` resolved each meal and
// movement by walking the **Meals / Movements BOARD's children** — but those
// boards are FEED-BACKED materialized views, so their children are feedSync
// COPIES with client-minted `<epoch-ms>-<rand>` ids. Two consequences, and the
// second is what was on screen:
//
//   1. `feedSync` re-mints its copies. When the servers restarted and clients
//      reconnected, every copy got a NEW id — so all **72** stored picks became
//      dangling references to occurrences that no longer exist.
//   2. Every occurrence dropdown's own predicate ends `meta.feedSourceId
//      IS_EMPTY` — it offers the SOURCES, never the copies. So even before they
//      went stale, the stored value was not in the option list, the renderer had
//      no label to show for it, and it fell back to printing the raw id.
//
// **A REFERENCE TO A FEED COPY IS VALID ONLY UNTIL THE NEXT SYNC.** My own
// verification reported "72 picks, 0 unresolved" and was true when measured and
// false twenty minutes later. CLAUDE.md 2026-08-10 states the rule for WRITES —
// "a tag written on a copy is a write to something about to be overwritten" —
// and this is the same rule for POINTERS. The durable target is the source: the
// occurrence carrying the board tag with `meta.feedSourceId` empty, which is
// exactly what the dropdown offers.
//
// THE INTENT SURVIVED THE IDS. `0112` signed every placed row
// `identitySignature: "cycle:<pick label>"`, so what each row MEANT is
// recoverable by name even though its pointer is dead. Without that signature
// this would have needed guesswork; with it the repair is a lookup.
//
// It rewrites ONLY a value that fails to resolve, so a pick the user has since
// set by hand — which would resolve, being a source — is never touched.
export const id = "0114-picks-point-at-sources-not-feed-copies";
export const describe =
  "Meal / Movement picks point at the SOURCE occurrence the dropdown offers, not a feed copy.";

export const SIG_PREFIX = "cycle:";
const norm = (s) => String(s ?? "").trim().toLowerCase();

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
  const MEAL = fid("Meal"), MOV = fid("Movement");
  const TAG = fields.find((f) => f.name === "Board Category")?.id;
  if (!MEAL || !MOV || !TAG) { log(`REFUSING: missing Meal / Movement / Board Category.`); return; }

  // The pool the DROPDOWN itself offers: tagged, not a feed copy, a real row.
  const sourcePool = (tag) => {
    const m = new Map();
    for (const o of occs) {
      const v = o.fields?.[TAG]?.value;
      const a = Array.isArray(v) ? v : v ? [v] : [];
      if (!a.includes(tag)) continue;
      if (o.meta?.feedSourceId) continue;                 // a copy — re-minted every sync
      if (modById.get(o.moduleId)?.role !== "instance") continue;  // the board container
      m.set(norm(nameOf(o)), o);
    }
    return m;
  };
  const meals = sourcePool("meal"), movements = sourcePool("movement");
  log(`source pool: ${meals.size} meal(s), ${movements.size} movement(s)`);

  const fixes = [], unresolvable = [];
  for (const o of occs) {
    for (const [f, pool, multi] of [[MEAL, meals, false], [MOV, movements, true]]) {
      const raw = o.fields?.[f]?.value;
      const ids = Array.isArray(raw) ? raw : raw ? [raw] : [];
      if (!ids.length) continue;
      // Only a value that fails to resolve — a hand-set pick already resolves.
      if (ids.every((i) => byId.get(i))) continue;
      const sig = String(o.identitySignature || "");
      if (!sig.startsWith(SIG_PREFIX)) {
        unresolvable.push({ o, why: "no cycle signature to recover the name from" });
        continue;
      }
      const want = sig.slice(SIG_PREFIX.length);
      const src = pool.get(norm(want));
      if (!src) { unresolvable.push({ o, why: `"${want}" is not in the source pool` }); continue; }
      fixes.push({ occ: o, fieldId: f, value: multi ? [src.id] : src.id, label: want, srcId: src.id });
    }
  }

  const byName = new Map();
  for (const f of fixes) byName.set(f.label, (byName.get(f.label) || 0) + 1);
  log(`dangling picks to repoint: ${fixes.length}`);
  [...byName.entries()].slice(0, 10).forEach(([k, v]) => log(`   ${String(v).padStart(2)}× ${k}`));
  if (byName.size > 10) log(`   … ${byName.size - 10} more distinct name(s)`);
  for (const u of unresolvable) log(`  REFUSING "${nameOf(u.o)}" — ${u.why}`);
  if (!fixes.length) { log(`every pick already resolves — no change.`); return; }
  if (dryRun) { log(`WOULD repoint ${fixes.length} pick(s) at their source occurrence.`); return; }

  for (const f of fixes) {
    await Occurrence.updateOne({ gridId, id: f.occ.id },
      { $set: { [`fields.${f.fieldId}`]: { value: f.value, flow: "in" } } });
  }
  log(`repointed ${fixes.length} pick(s).`);

  // Read the result back — the check that matters is that every pick now
  // resolves AND names a source the dropdown will actually offer.
  const after = await Occurrence.find({ gridId }).lean();
  const now = new Map(after.map((o) => [o.id, o]));
  let ok = 0, bad = 0, copy = 0;
  for (const o of after) {
    for (const f of [MEAL, MOV]) {
      const v = o.fields?.[f]?.value;
      const ids = Array.isArray(v) ? v : v ? [v] : [];
      for (const i of ids) {
        const t = now.get(i);
        if (!t) bad++; else if (t.meta?.feedSourceId) copy++; else ok++;
      }
    }
  }
  log(`after: ${ok} resolve to a SOURCE · ${copy} still a feed copy · ${bad} dangling.`);
}
