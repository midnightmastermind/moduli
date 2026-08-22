/**
 * 0181 — two day columns for the same date, one with every slot four times over.
 *
 * ── HOW IT HAPPENED, SAID PLAINLY: MY OWN PROBES ─────────────────────────────────────────────
 *
 * Today's column existed twice on poms grid, created eight minutes apart —
 *
 *     ed28971f  created 05:40:28   196 children · 38 distinct slots · each REPEATED ×4
 *     f63f2376  created 05:48:26    49 children · 38 distinct slots · no repeats
 *
 * — and 05:40 to 05:48 is exactly the window in which this session was driving repeated COLD
 * BROWSER LOADS against production to verify a skin fix. Every load runs `Schedule: Build Schedule`,
 * and its column-level existence check does not see a column another client is mid-way through
 * creating. That is the documented duplicate-day-column class (2026-08-05 `0038`, 2026-08-03
 * `0048`) reached from the concurrency side, and it is the same mixed-client hazard this queue
 * already records for feeds: **a probe that loads the live grid writes to it.**
 *
 * ── NOTHING IS AT RISK, AND THAT IS MEASURED RATHER THAN ASSUMED ────────────────────────────
 *
 * Both columns hold **the same 15 distinct rows**. A carries 36 row-placements because its slots
 * are quadrupled; B carries 15. The set difference is EMPTY in both directions, and **not one row
 * in either column is ticked**. So the duplicate holds nothing the keeper lacks and nothing the
 * user entered — which is the only condition under which a column may be removed at all.
 *
 * ── THE KEEPER IS CHOSEN STRUCTURALLY, NEVER BY AGE ─────────────────────────────────────────
 *
 * The survivor is the column whose slots are DISTINCT. Age would have picked the wrong one here —
 * the older column is the damaged one. "Most children" would also have picked it. The rule is the
 * shape a healthy column has: one row per slot value.
 *
 * ── IT REFUSES ON ANYTHING IT DOES NOT UNDERSTAND ───────────────────────────────────────────
 *
 * Per date it acts only when there are exactly two columns, exactly one is clean, the doomed one's
 * row set is a SUBSET of the keeper's, and nothing under it is ticked or holds text. Any other
 * shape is reported and left — a schedule is not something a migration gets to tidy on a guess.
 * The subtree is dumped to `backups/orphans/` before anything is removed.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export const id = "0181-dedupe-duplicate-day-column";
export const describe =
  "Remove a duplicate day column whose slots are repeated, keeping the clean one. Refuses unless " +
  "the doomed column's rows are a subset of the keeper's and nothing in it is ticked or written.";

const TS = "nSccAtADyUGW", FORMAT = "vQ0ELZP_zxnx", DATE = "Eh7oi4HKdbHB", COMPLETED = "tZWiPDQUDP74";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(), Module.find({ gridId }).lean(),
  ]);
  const mById = new Map(mods.map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const lbl = (o) => o?.label || mById.get(o?.moduleId)?.label || o?.id;

  const cols = occs.filter((o) => o.fields?.[FORMAT]?.value === "day-col");
  const byDate = new Map();
  for (const c of cols) {
    const d = c.fields?.[DATE]?.value || "(none)";
    (byDate.get(d) || byDate.set(d, []).get(d)).push(c);
  }

  /** Every row placed in a column, as "<slot> :: <label>" — order-free. */
  const rowsOf = (c) => {
    const out = [];
    for (const sid of c.occurrences || []) {
      const s = byId.get(sid); if (!s) continue;
      for (const kid of s.occurrences || []) {
        const k = byId.get(kid); if (!k) continue;
        out.push(`${s.fields?.[TS]?.value || "?"} :: ${lbl(k)}`);
      }
    }
    return out;
  };
  const slotCounts = (c) => {
    const m = {};
    for (const sid of c.occurrences || []) {
      const v = byId.get(sid)?.fields?.[TS]?.value; if (!v) continue;
      m[v] = (m[v] || 0) + 1;
    }
    return m;
  };
  const isClean = (c) => Object.values(slotCounts(c)).every((n) => n === 1);
  /** Anything the user could have entered, at full depth. */
  const carriesWork = (c) => {
    for (const sid of c.occurrences || []) {
      const s = byId.get(sid); if (!s) continue;
      for (const kid of s.occurrences || []) {
        const k = byId.get(kid); if (!k) continue;
        if (k.fields?.[COMPLETED]?.value === true) return `ticked: ${lbl(k)}`;
        if (k.textmap) return `text: ${lbl(k)}`;
      }
    }
    return null;
  };

  const plans = [];
  for (const [d, list] of byDate) {
    if (list.length < 2) continue;
    const clean = list.filter(isClean), dirty = list.filter((c) => !isClean(c));
    if (list.length !== 2 || clean.length !== 1 || dirty.length !== 1) {
      log(`  DECLINE ${d}: ${list.length} column(s), ${clean.length} clean — not the shape this handles`);
      continue;
    }
    const keep = clean[0], drop = dirty[0];
    const kSet = new Set(rowsOf(keep)), dRows = rowsOf(drop);
    const missing = [...new Set(dRows.filter((r) => !kSet.has(r)))];
    const work = carriesWork(drop);
    if (missing.length) { log(`  DECLINE ${d}: doomed column holds ${missing.length} row(s) the keeper lacks — ${missing.slice(0,4).join(" | ")}`); continue; }
    if (work) { log(`  DECLINE ${d}: doomed column carries work (${work})`); continue; }
    plans.push({ d, keep, drop, dRows: dRows.length, kRows: kSet.size });
  }

  log(`  dates with duplicate columns: ${[...byDate.values()].filter((l) => l.length > 1).length} · repairable: ${plans.length}`);
  for (const p of plans)
    log(`    ${p.d}: KEEP ${p.keep.id} (${(p.keep.occurrences || []).length} children, ${p.kRows} rows) · ` +
        `DROP ${p.drop.id} (${(p.drop.occurrences || []).length} children, ${p.dRows} rows, subset, nothing ticked)`);
  if (!plans.length) { log("  nothing to do"); return; }
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  for (const p of plans) {
    // Collect the whole subtree: the column, its slots, and their rows.
    const ids = new Set([p.drop.id]);
    for (const sid of p.drop.occurrences || []) {
      ids.add(sid);
      for (const kid of byId.get(sid)?.occurrences || []) ids.add(kid);
    }
    const dump = [...ids].map((i) => byId.get(i)).filter(Boolean);
    const dir = path.join(process.cwd(), "backups", "orphans");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `0181-dup-day-column-${p.drop.id}.json`);
    writeFileSync(file, JSON.stringify(dump, null, 1));
    log(`    dumped ${dump.length} occurrence(s) to ${file}`);

    // Unlist from every parent first, so nothing is left naming a deleted row.
    await Occurrence.updateMany({ gridId }, { $pull: { occurrences: { $in: [...ids] } } });
    await Occurrence.deleteMany({ gridId, id: { $in: [...ids] } });
    log(`    removed ${ids.size} occurrence(s) for ${p.d}`);
  }
  log("  RESTART pm2 so the warm cache re-reads.");
}
