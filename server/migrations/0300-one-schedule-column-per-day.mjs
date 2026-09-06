// Four Schedule day columns for one date, three of them two seconds apart.
//
// Found by the fixture re-export growing by 322 occurrences between two runs
// fourteen minutes apart, which turned three suites red at once - the load
// sweep stopped converging, the Routine layer stopped merging, and the workout
// session stopped filling. All three are the same cause: `Schedule: Build
// Schedule` FINDs today's column by `Schedule Format IS "day-col" AND Date
// SAME_DAY $day`, four columns make that FIND bind an ARRAY, and everything
// downstream of it either throws into the sweep's per-op catch or builds a
// fifth column.
//
//     72c5326a  created 05:13:22   98 children   <- 49 slots, twice
//     8693a42d  created 05:50:07   49 children
//     7578cb30  created 05:50:09   49 children
//     9c07d753  created 05:50:11   49 children
//
// ── THE CAUSE IS KNOWN AND IT WAS ME ───────────────────────────────────────
//
// 05:50:07/09/11 is three sweeps racing, and the gap between them is the gap
// between pm2 restarts: this session restarted the server three times in a few
// minutes (each migration's warm cache invalidation), every restart drops the
// client, and every reconnect asks for `full_state` and runs the load sweep.
// A create from sweep N had not persisted before sweep N+1 built its payload,
// so each one's FIND correctly saw nothing. That is the 2026-09-03 (12)
// finding exactly, and this file's own standing rule names the remedy:
// **do not restart while the grid may be loading.** The structural fix is a
// dated root signature plus a server-side refusal (0284/0285 did this for the
// Day Page column); the Schedule column has no such signature yet, and adding
// one is a change to the shared create path that wants its own pass.
//
// ── WHICH COLUMN SURVIVES IS A PROPERTY OF THE COLUMN, NOT ITS AGE ─────────
//
// A healthy day column holds each time slot ONCE. 72c5326a holds 98 children
// for 49 slots - every slot twice - so "keep the oldest" would keep the only
// broken one. The keeper is the earliest column whose slots are DISTINCT;
// only if none is distinct does it fall back to the earliest, and it says so.
//
// ── AND IT REFUSES ON ANYTHING THE USER ENTERED ────────────────────────────
//
// Measured at full subtree depth BEFORE writing: 0 ticked rows and 0
// characters of text across all four. The routines are the app's own daily
// build and are placed again on the next load, which is what makes this
// safe - a ticked row or a line of prose is not, and a column holding either
// is KEPT and reported. `0038`'s header records making the opposite mistake
// twice: a guard that scores the app's OWN footprint refuses forever.
import Field from "../models/Field.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import fs from "node:fs";
import path from "node:path";

export const id = "0300-one-schedule-column-per-day";
export const description = "One Schedule day column per date; the duplicates a restart race minted are removed.";
export const touches = ["fields", "modules", "occurrences"];

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const fields = await Field.find({ gridId: gid }).lean();
  const one = (name) => {
    const hits = fields.filter((f) => f.name === name);
    if (hits.length !== 1) throw new Error(`field "${name}": ${hits.length} matches - refusing`);
    return hits[0];
  };
  const fmt = one("Schedule Format");
  const done = one("Completed");
  const slot = one("Time Slot");
  const dateIds = fields.filter((f) => f.name === "Date").map((f) => f.id);

  const occs = await Occurrence.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const byId = Object.fromEntries(occs.map((o) => [o.id, o]));
  const labelOf = (o) => o?.label || modById[o?.moduleId]?.label || o?.id;

  const subtree = (rootId) => {
    const seen = new Set([rootId]);
    const stack = [rootId];
    while (stack.length) for (const k of byId[stack.pop()]?.occurrences || []) if (!seen.has(k)) { seen.add(k); stack.push(k); }
    seen.delete(rootId);
    return [...seen];
  };

  const cols = occs.filter((o) => o.fields?.[fmt.id]?.value === "day-col");
  const dateOf = (o) => dateIds.map((d) => o.fields?.[d]?.value).find(Boolean) || "(undated)";
  const groups = {};
  for (const c of cols) (groups[dateOf(c)] ||= []).push(c);

  let removed = 0;
  for (const [date, list] of Object.entries(groups).sort()) {
    if (list.length < 2) continue;

    const scored = list.map((c) => {
      const kids = subtree(c.id);
      const slots = (c.occurrences || []).map((k) => byId[k]?.fields?.[slot.id]?.value).filter(Boolean);
      const ticked = kids.filter((k) => byId[k]?.fields?.[done.id]?.value === true).length;
      const chars = kids.reduce((n, k) => n + (typeof byId[k]?.textmap === "string" ? byId[k].textmap.length : 0), 0);
      return { c, kids, ticked, chars, distinct: slots.length > 0 && new Set(slots).size === slots.length,
               created: c.createdAt ? new Date(c.createdAt).getTime() : 0 };
    });

    const holding = scored.filter((s) => s.ticked > 0 || s.chars > 0);
    if (holding.length) {
      log(`  ${date}: ${list.length} columns and ${holding.length} hold something entered (${holding.map((s) => `${s.ticked} ticked / ${s.chars} chars`).join(", ")}) - KEPT, reported`);
      continue;
    }

    const healthy = scored.filter((s) => s.distinct).sort((a, b) => a.created - b.created);
    const keeper = healthy[0] || [...scored].sort((a, b) => a.created - b.created)[0];
    if (!healthy.length) log(`  ${date}: no column has distinct slots - keeping the earliest and saying so`);

    const doomed = scored.filter((s) => s.c.id !== keeper.c.id);
    log(`  ${date}: keeping ${keeper.c.id} (${(keeper.c.occurrences || []).length} children, slots distinct: ${keeper.distinct}); removing ${doomed.length}`);

    for (const d of doomed) {
      const ids = [d.c.id, ...d.kids];
      // A child shared with the keeper (the Schedule multi-parents its slots)
      // must never be deleted with a doomed column.
      const keep = new Set([keeper.c.id, ...keeper.kids]);
      const mine = ids.filter((x) => !keep.has(x));
      const shared = ids.length - mine.length;
      log(`     ${d.c.id}: ${ids.length} in subtree, ${shared} shared with the keeper, deleting ${mine.length}`);

      if (apply) {
        const dump = mine.map((x) => byId[x]).filter(Boolean);
        const dir = path.resolve("backups/orphans");
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_schedule-col-${d.c.id.slice(0, 8)}.json`);
        fs.writeFileSync(file, JSON.stringify(dump, null, 1));
        log(`     dumped ${dump.length} document(s) -> ${file}`);
        // UNLINK FIRST. Deleting a row a parent still lists mints the
        // dangling-child-ref class this repo has swept five times.
        await Occurrence.updateMany({ gridId: gid, occurrences: { $in: mine } }, { $pull: { occurrences: { $in: mine } } });
        await Occurrence.deleteMany({ gridId: gid, id: { $in: mine } });
      }
      removed += mine.length;
    }
  }

  log(`  ${removed} occurrence(s) ${apply ? "removed" : "would be removed"}.`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
