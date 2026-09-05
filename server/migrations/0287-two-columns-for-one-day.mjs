// Two Day Page columns for one date, so `Day Page: Build` threw on every load.
//
// User, 2026-09-05. Driving the live sweep through the real executor, exactly
// one operation errored:
//
//     Day Page: Build: $col is not a record (no .id)
//
// That is the multi-match signature this repo has paid for four times: the op's
// FIND matches BOTH columns for today, binds an ARRAY, and the UPDATE below it
// throws - so everything after it (the Daily Question, the Todo link, the
// page-body rebuild) never runs, silently, inside the sweep's per-op catch.
//
//     4b9c92b7  created 11:29:33.520   4 children   0 chars of user text
//     620f5936  created 11:29:48.480   4 children   0 chars of user text
//
// Both carry identitySignature "daypage:col:2026-09-05" AND
// meta.signatureUnique - the exact state `refusedDuplicateCreates` (0284, two
// days earlier) exists to refuse. Driven against the CURRENT cache that guard
// DOES fire, so it is not broken: the second create could not see the first.
// The two are 15 seconds apart, which that morning is the gap between one
// session disconnecting mid-burst and the next connecting - and the create
// handler rolls its cache entry back on any path that does not reach
// `persisted = true`, while the row stays in Mongo. A guard seeded from the
// warm cache is blind to a row the cache has rolled back.
//
// SO THIS REPAIRS THE DAMAGE AND DOES NOT CLAIM TO FIX THE CAUSE. That is a
// cache/persistence divergence wanting instrumentation before any behavioural
// change - the same divergence that unlisted today's SCHEDULE column.
//
// THE RULE IS THE INVARIANT, NOT TODAY'S DATE: any parent holding two children
// with the same identitySignature where both declare meta.signatureUnique,
// which `gridIntegrity` already calls an ERROR. Nothing names a day page, a
// date or a board.
//
// IT REFUSES RATHER THAN GUESSES. Text is measured through decompressTextmap at
// full subtree depth - a raw scan reports "no text" for every row on this grid
// because textmaps are stored COMPRESSED (the 0032 rule, which nearly deleted
// journal entries). If more than one candidate holds text the group is REPORTED
// AND SKIPPED: two columns is a nuisance, a deleted journal entry is not. The
// keeper is the one with text, else the EARLIEST. Children are unlinked from
// the parent BEFORE deletion, or this mints the dangling-child-ref class swept
// five times here.
import Occurrence from "../models/Occurrence.js";
import { decompressTextmap } from "../utils/textmapCompression.js";
import { writeFileSync, mkdirSync } from "fs";

export const id = "0287-two-columns-for-one-day";
export const description =
  "Remove duplicate signature-unique siblings (a second day column for one date).";
export const touches = ["occurrences"];

const textOf = (tm) => {
  if (!tm) return "";
  let s = "";
  (function walk(n) {
    if (!n) return;
    if (typeof n.text === "string") s += n.text;
    (n.content || []).forEach(walk);
  })(decompressTextmap(tm));
  return s.trim();
};

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);
  const occs = await Occurrence.find({ gridId: gid }).lean();
  const byId = Object.fromEntries(occs.map((o) => [o.id, o]));

  const groups = new Map();
  for (const o of occs) {
    if (!o.identitySignature || !o.parentId || !o.meta?.signatureUnique) continue;
    const k = o.parentId + " " + o.identitySignature;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  }
  const dupes = [...groups.entries()].filter(([, v]) => v.length > 1);
  log("  signature-unique groups: " + groups.size + " | DUPLICATED: " + dupes.length);
  if (!dupes.length) { log("  nothing to repair - already converged."); return; }

  const subtree = (rootId) => {
    const out = [], seen = new Set();
    (function walk(id, d) {
      if (!id || seen.has(id) || d > 8) return;
      seen.add(id);
      const o = byId[id];
      if (!o) return;
      out.push(o);
      for (const c of (o.occurrences || [])) walk(c, d + 1);
    })(rootId, 0);
    return out;
  };

  const doomed = [];
  for (const [key, members] of dupes) {
    const scored = members.map((mm) => {
      const nodes = subtree(mm.id);
      return { occ: mm, nodes, chars: nodes.reduce((a, n) => a + textOf(n.textmap).length, 0) };
    });
    const withText = scored.filter((s) => s.chars > 0);
    log("  " + key + " - " + members.length + " siblings: " +
      scored.map((s) => s.occ.id.slice(0, 8) + "(" + s.nodes.length + " nodes, " + s.chars + " chars)").join(", "));
    if (withText.length > 1) { log("     REFUSING - " + withText.length + " hold user text"); continue; }
    const keep = withText[0] ||
      scored.slice().sort((a, b) => new Date(a.occ.createdAt) - new Date(b.occ.createdAt))[0];
    for (const s of scored) if (s.occ.id !== keep.occ.id) doomed.push(s);
    log("     keep " + keep.occ.id.slice(0, 8) + (keep.chars ? " (holds the text)" : " (earliest)") +
      " - removing " + (scored.length - 1));
  }
  if (!doomed.length) { log("  nothing removable."); return; }

  const rows = doomed.flatMap((d) => d.nodes);
  log("  " + doomed.length + " duplicate root(s), " + rows.length + " occurrence(s) in total");
  if (!apply) { log("  DRY RUN - pass --apply to write."); return; }

  mkdirSync("backups/orphans", { recursive: true });
  const dump = "backups/orphans/0287-" + Date.now() + ".json";
  writeFileSync(dump, JSON.stringify(rows, null, 1));
  log("  dumped " + rows.length + " raw document(s) to " + dump);

  for (const d of doomed) {
    await Occurrence.updateOne({ id: d.occ.parentId, gridId: gid }, { $pull: { occurrences: d.occ.id } });
  }
  const ids = rows.map((r) => r.id);
  const res = await Occurrence.deleteMany({ id: { $in: ids }, gridId: gid });
  log("  unlinked " + doomed.length + " root(s), deleted " + res.deletedCount + " occurrence(s).");
}
