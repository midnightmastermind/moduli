/**
 * 0273 — twelve tasks a PROBE ticked, restored to what the user left.
 *
 * User, 2026-08-28: *"im missing most of my tasks too btw"*, then *"they still
 * arent showing up"*. Nothing was deleted — all 33 Tasks-page rows are present.
 * Each dimension container carries a local filter `hide-completed-*`
 * (`Completed IS_NOT true`, `hides: true`) and the `Completed` container is a
 * feed on `Completed IS true`, so a ticked task LEAVES its dimension and shows
 * up at the bottom of the page. That filter has been on the grid since
 * 2026-08-22 and is working exactly as authored — it is not the defect.
 *
 * THE DEFECT IS THAT TWELVE OF THEM WERE NEVER TICKED BY THE USER. The
 * pre-migration backups date it to the minute:
 *
 *     every snapshot 08-25 .. 08-27T15:59Z   21 rows in page,  3 dimension tasks complete
 *     08-28T01:25Z snapshot                  33 rows in page, 15 dimension tasks complete
 *
 * The twelve flips all land between **17:28Z and 19:13Z on 2026-08-27** — inside
 * the probe session CLAUDE.md 2026-08-27 (2) records, which hit its limit at
 * 19:04Z. That entry's own debris sweep found and restored `Text Terrell`
 * (19:02Z) and `Text Shelly` (19:09Z) — **the last two rows it touched**. The
 * dozen it had ticked EARLIER in the same session were never audited. Two
 * independent probe signatures confirm the shape: `Text Shelly` was toggled
 * eight times at ~2-minute intervals that evening, and `Organize files` the same
 * way on 08-22 and 08-23.
 *
 * *A probe that edits is a probe that can damage — and a debris sweep that only
 * checks the rows you remember touching is a sweep of your memory, not of the
 * grid.*
 *
 * WHY `actionId` IS NOT THE DISCRIMINATOR, recorded because it looks like one
 * and cost a pass: a user gesture mints an action id and a derived write does
 * not, so `actionId: null` reads exactly like "an op did this". But these are
 * **MeasureOps, and a MeasureOp carries no `actionId` at all** — the null is a
 * property of the RECORD TYPE, not of the origin. Every flip on this grid reads
 * null, the ones known to be the user's included. *A field that is constant
 * across both arms cannot separate them.*
 *
 * THREE INDEPENDENT CONDITIONS GATE EVERY RESTORE, and any row failing one is
 * KEPT and REPORTED rather than cleared:
 *   1. the pre-damage SNAPSHOT says the row was not complete, and
 *   2. the row is complete NOW, and
 *   3. `fieldUpdatedAt[Completed]` falls inside the damage window.
 * (3) is the one that matters most: it is what protects a task the user has
 * genuinely ticked SINCE, whose value would otherwise look identical to the
 * damage. Deleting a real completion to tidy a report is the damage, not the
 * fix — the `0038` rule, which this file has paid for twice.
 *
 * IT RESTORES, IT DOES NOT CLEAR. Each row is written back to EXACTLY what the
 * snapshot held: a key that was absent is `$unset`, a stored `false` is written
 * as `false`. Clearing both alike would erase the difference between "never
 * touched" and "explicitly un-ticked", which is a real distinction on this grid
 * (`Text Shelly` carries a deliberate `false`).
 *
 * THE FEED COPIES NEED NO PASS OF THEIR OWN. The `Completed` container is a
 * materialized feed and `feedSync` is a scan-based self-healing diff, so a copy
 * whose source stops matching `Completed IS true` is swept on the next client
 * load. Minting a second removal here would fight the engine that already owns
 * it — the 2026-08-13 lesson about pushing into a feed's `occurrences[]`.
 *
 * AFTER APPLYING: restart pm2 (the warm cache is authoritative for reads) and
 * reload the tab.
 */
export const id = "0273-restore-probe-ticked-tasks";
export const describe = "Restore Completed on the 12 Tasks-page rows a probe ticked on 2026-08-27.";
export const touches = ["occurrences"];

/** The probe session's window, from the transaction log (UTC). */
export const DAMAGE_FROM = Date.parse("2026-08-27T17:20:00.000Z");
export const DAMAGE_TO   = Date.parse("2026-08-27T19:20:00.000Z");

/**
 * ONE ROW THE SNAPSHOT MISSES BY SIX MINUTES, and the transaction log answers
 * instead. `Appointment with Physical Therapist` was CREATED at 16:05:01Z —
 * after the 15:59:02Z snapshot was taken — so the snapshot has nothing to say
 * about it and the guard below correctly refuses to guess. The pruned
 * transaction log states its prior value outright:
 *
 *     2026-08-27T17:09:24Z  fields set (Date, Location, Type, Time Slot, 60m)  — no Completed
 *     2026-08-27T17:32:58Z  tZWiPDQUDP74 = true   prev=undefined      <- the tick
 *     2026-08-27T17:34:03Z  "Completed On" = 2026-08-27               <- the op's stamp
 *
 * `prev=undefined` on the flip record IS the prior state, from a source
 * independent of the snapshot. So the row gets an explicitly-evidenced
 * exception rather than the guard being loosened for everything — a strict
 * guard with one cited exception is auditable; a widened one is not.
 * (It is also the row whose `Date` is 2026-08-28 — it was marked complete the
 * day BEFORE the appointment, which is its own tell.)
 */
export const PRIOR_FROM_TX = new Map([
  ["ae62665a-d0b0-43e0-8d94-3859dfee6264", null],   // null => the key was ABSENT
]);

/** Pre-damage snapshot: the last backup taken before the window opened. */
export const SNAPSHOT =
  "backups/poms-grid/2026-08-27T15-59-02-513Z_pre-migration-0265-dedupe-book-rows/occurrences.json";

const isComplete = (v) => v === true;

/**
 * PURE. Decide what to restore. Exported so the rule is testable without a
 * database or a backup file (the `0048` shape).
 *
 * @param {Array}  live      occurrences as they are now
 * @param {Map}    priorById occurrence id -> the snapshot's occurrence (or absent)
 * @param {string} completedFieldId
 * @param {Set}    scope     occurrence ids eligible for repair (the dimension tasks)
 * @param {{from:number,to:number}} window  the damage window, in ms
 * @returns {{ restore: Array, kept: Array }}
 *   restore — { id, priorField|null }  priorField null means the key was ABSENT
 *   kept    — { id, why }              reported, never written
 */
export function planTaskRestore(live, priorById, completedFieldId, scope, window, priorFromTx = new Map()) {
  const restore = [], kept = [];
  for (const occ of live) {
    if (!scope.has(occ.id)) continue;
    const now = occ?.fields?.[completedFieldId]?.value;
    if (!isComplete(now)) continue;                     // not complete — nothing to undo

    const prior = priorById.get(occ.id);
    const txPrior = priorFromTx.has(occ.id);
    if (!prior && !txPrior) { kept.push({ id: occ.id, why: "absent from the pre-damage snapshot" }); continue; }

    // The transaction log's `previousValue` is the same claim the snapshot
    // makes, from an independent source. Only ever used for a row the snapshot
    // cannot cover, and only for ids listed with their evidence above.
    const was = prior ? prior?.fields?.[completedFieldId]?.value : priorFromTx.get(occ.id)?.value;
    if (isComplete(was)) { kept.push({ id: occ.id, why: "was ALREADY complete before the window" }); continue; }

    // The guard that protects a genuine completion made since.
    const at = occ?.fieldUpdatedAt?.[completedFieldId];
    const ms = at ? new Date(at).getTime() : NaN;
    if (!Number.isFinite(ms)) { kept.push({ id: occ.id, why: "no fieldUpdatedAt — cannot place it in time" }); continue; }
    if (ms < window.from || ms > window.to) {
      kept.push({ id: occ.id, why: `ticked ${new Date(ms).toISOString()} — OUTSIDE the probe window` });
      continue;
    }

    restore.push({
      id: occ.id,
      priorField: prior ? (prior.fields?.[completedFieldId] ?? null) : (priorFromTx.get(occ.id) ?? null),
      source: prior ? "snapshot" : "transaction log",
    });
  }
  return { restore, kept };
}

/** The Tasks-page rows eligible for repair: children of a container that HIDES completed. */
export function dimensionTaskIds(occurrences) {
  const byId = new Map(occurrences.map(o => [o.id, o]));
  const scope = new Set();
  for (const o of occurrences) {
    const hides = (o.filters || []).some(f => f?.active && f?.hides);
    if (!hides) continue;
    for (const kid of o.occurrences || []) if (byId.has(kid)) scope.add(kid);
  }
  return scope;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const fs = await import("node:fs");

  const fields = await Field.find({ gridId }).lean();
  const completed = fields.filter(f => f.name === "Completed" && f.type === "boolean");
  if (completed.length !== 1) {
    log(`  REFUSING: expected exactly one boolean field named "Completed", found ${completed.length}`);
    return;
  }
  const CF = completed[0].id;
  log(`  Completed field: ${CF}`);

  if (!fs.existsSync(SNAPSHOT)) { log(`  REFUSING: pre-damage snapshot not found at ${SNAPSHOT}`); return; }
  const snapRaw = JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
  const snapArr = Array.isArray(snapRaw) ? snapRaw : (snapRaw.occurrences || snapRaw.docs || []);
  if (!snapArr.length) { log("  REFUSING: the snapshot parsed to zero occurrences"); return; }
  const priorById = new Map(snapArr.map(o => [o.id, o]));
  log(`  snapshot: ${snapArr.length} occurrences from ${SNAPSHOT.split("/")[2]}`);

  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const byId = new Map(occs.map(o => [o.id, o]));
  const modById = new Map(mods.map(m => [m.id, m]));
  const labelOf = id => { const o = byId.get(id); return o?.label || modById.get(o?.moduleId)?.label || id; };

  const scope = dimensionTaskIds(occs);
  log(`  ${scope.size} row(s) live under a container that hides completed items`);
  if (!scope.size) { log("  REFUSING: no hide-completed container found — the scope would be empty"); return; }

  const { restore, kept } = planTaskRestore(occs, priorById, CF, scope,
    { from: DAMAGE_FROM, to: DAMAGE_TO }, PRIOR_FROM_TX);

  if (!restore.length) { log("  nothing to restore — already converged"); return; }

  log(`  RESTORING ${restore.length} row(s) ticked inside the probe window:`);
  for (const r of restore) {
    const at = byId.get(r.id)?.fieldUpdatedAt?.[CF];
    log(`      "${labelOf(r.id)}"  ticked ${new Date(at).toISOString()}  -> ${r.priorField ? JSON.stringify(r.priorField.value) : "(key absent)"}   [${r.source}]`);
  }
  if (kept.length) {
    log(`  KEEPING ${kept.length} completed row(s) — not attributable to the probe:`);
    for (const k of kept) log(`      "${labelOf(k.id)}"  ${k.why}`);
  }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  // `Completed On` is stamped by `Schedule: Stamp Completed On` when Completed
  // goes true, so it is part of the same footprint and is restored with it.
  const stampField = fields.find(f => f.name === "Completed On");
  let n = 0;
  for (const r of restore) {
    const set = {}, unset = {};
    if (r.priorField) set[`fields.${CF}`] = r.priorField;
    else unset[`fields.${CF}`] = "";

    if (stampField) {
      // A row restored from the tx log has no snapshot to read a stamp from —
      // and the log shows the stamp was absent before the tick, so unset it.
      const priorStamp = priorById.get(r.id)?.fields?.[stampField.id];
      if (priorStamp) set[`fields.${stampField.id}`] = priorStamp;
      else unset[`fields.${stampField.id}`] = "";
    }
    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(unset).length) update.$unset = unset;
    await Occurrence.updateOne({ id: r.id, gridId }, update);
    n += 1;
  }
  log(`  done — restored ${n} row(s) to their pre-probe state`);
}
