// Two Day Page columns for today, and the sweep threw on every load.
//
// Found by the guard that exists for it: `pomsGridOps` asserts the load sweep
// runs with no operation erroring, and it went red with
//
//     Day Page: Build: $col is not a record (no .id) — UPDATE needs a FOUND occurrence
//
// which is the documented multi-match failure (2026-08-31 (3), 2026-09-03 (12)):
// the FIND matches BOTH columns, binds an ARRAY, and the UPDATE below it throws.
// It lands in the sweep's per-op catch, so it is SILENT — and everything after
// it in that op (the daily question, the Todo link, the page-body rebuild) never
// runs.
//
// ── THE GUARD THAT SHOULD HAVE STOPPED IT DID NOT ─────────────────────────
//
// Both columns carry the SAME signature under the SAME parent and BOTH carry
// `meta.signatureUnique`, which is exactly the state `0303`'s server-side
// refusal was written to reject:
//
//   124c4b49…  08:38:16  sig daypage:col:2026-09-07  signatureUnique  6 children
//   89be213b…  08:40:06  sig daypage:col:2026-09-07  signatureUnique  4 children
//
// 110 SECONDS APART, so this is not the sub-second persistence race 2026-09-03
// (12) measured — it is two sweeps two minutes apart each concluding the column
// did not exist. Why the refusal did not fire is NOT established here and is
// reported rather than guessed at; this migration repairs the data and says so.
//
// ── NEITHER COLUMN HOLDS WRITING, AND THAT IS MEASURED, NOT ASSUMED ───────
//
// My first measurement said 768 and 841 characters and was WRONG: it stringified
// the whole textmap, so it was counting JSON node types. Walking the decompressed
// textmap for TEXT NODES finds zero in both. That distinction is the whole safety
// of this migration — `0038` refused for a year because it scored the app's own
// field values as the user's writing, and its header records making that mistake
// twice. Anything holding real prose is KEPT and REPORTED.
//
// The keeper is the column with the most children (6 vs 4 — it has Todo and the
// Emotions Wheel the other lacks), never the older or the newer: what matters is
// which one the day was actually built into.
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import fs from "node:fs";
import path from "node:path";
import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0317-one-day-page-column-per-day";
export const description = "Removes duplicate day-page columns that hold no writing.";
export const touches = ["modules", "occurrences"];

/** Characters of REAL PROSE in a subtree — text nodes only, at full depth. */
function proseIn(occById, rootId, depth = 0) {
  const occ = occById[rootId];
  if (!occ || depth > 8) return 0;
  let n = 0;
  try {
    const t = decompressTextmap(occ.textmap);
    const walk = (node) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      if (node.type === "text" && typeof node.text === "string") n += node.text.trim().length;
      Object.values(node).forEach(walk);
    };
    if (t) walk(t);
  } catch { /* an unreadable textmap is not evidence of emptiness — see below */ }
  for (const c of occ.occurrences || []) n += proseIn(occById, c, depth + 1);
  return n;
}

export async function up({ gridId, dryRun = true, log = console.log } = {}) {
  const apply = !dryRun;
  const gid = String(gridId);

  const occs = await Occurrence.find({ gridId: gid }).lean();
  const mods = await Module.find({ gridId: gid }).lean();
  const modById = Object.fromEntries(mods.map((m) => [m.id, m]));
  const occById = Object.fromEntries(occs.map((o) => [o.id, o]));
  const labelOf = (o) => o && (o.label || modById[o.moduleId]?.label || "(unlabeled)");

  // Duplicates are (parent, signature) pairs — the identity the merge and the
  // server refusal both key on, so this repairs exactly what they were meant to
  // prevent rather than a lookalike keyed on a label or a date.
  //
  // UNIQUENESS IS OPT-IN, and the dry run is the only reason this migration is
  // not data loss. Keyed on the signature ALONE it matched the Schedule
  // Template's seven weekday templates — which deliberately SHARE a signature
  // as a marker — and proposed deleting 400+ occurrences of the user's own
  // templates. `0303` drew exactly this line for the server-side refusal and
  // I had to be shown it again: *a signature is also a shared MARKER.* Only a
  // node whose caller declared the signature as its IDENTITY takes part.
  const groups = new Map();
  for (const parent of occs) {
    for (const cid of parent.occurrences || []) {
      const c = occById[cid];
      if (!c?.identitySignature) continue;
      if (c.meta?.signatureUnique !== true) continue;
      const key = `${parent.id}::${c.identitySignature}`;
      if (!groups.has(key)) groups.set(key, { parent, sig: c.identitySignature, kids: [] });
      groups.get(key).kids.push(c);
    }
  }

  const doomed = [];
  for (const { parent, sig, kids } of groups.values()) {
    if (kids.length < 2) continue;
    const scored = kids.map((k) => ({ k, prose: proseIn(occById, k.id), n: (k.occurrences || []).length }));
    const written = scored.filter((s) => s.prose > 0);
    log(`  ${labelOf(parent)} / ${sig}: ${kids.length} columns` +
        scored.map((s) => `\n      ${s.k.id}  ${s.n} children · ${s.prose} chars of prose`).join(""));

    // MORE THAN ONE holding writing is a human call — merging two days of the
    // user's journal is not something a migration gets to decide.
    if (written.length > 1) { log(`      SKIPPED — ${written.length} hold writing; merging is your call`); continue; }
    // Keep whichever holds writing; otherwise the one the day was built into.
    const keep = written[0] || scored.slice().sort((a, b) => b.n - a.n)[0];
    for (const s of scored) if (s.k.id !== keep.k.id) doomed.push({ parent, occ: s.k, keep: keep.k.id });
    log(`      keeping ${keep.k.id} (${keep.n} children, ${keep.prose} chars)`);
  }

  if (!doomed.length) { log("  no duplicate columns to remove."); return; }

  // Subtree ids, so nothing is orphaned behind the delete.
  const subtree = (rootId, out = [], d = 0) => {
    if (d > 8 || out.includes(rootId)) return out;
    out.push(rootId);
    for (const c of occById[rootId]?.occurrences || []) subtree(c, out, d + 1);
    return out;
  };

  for (const d of doomed) {
    const ids = subtree(d.occ.id);
    log(`  removing ${d.occ.id} (${ids.length} occurrence(s) incl. children) from ${labelOf(d.parent)}`);
    if (!apply) continue;

    const dir = path.resolve("backups/orphans");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_duplicate-day-column.json`),
      JSON.stringify(ids.map((i) => occById[i]).filter(Boolean), null, 1));

    // UNLINK FIRST — a delete that leaves the parent listing the child mints the
    // dangling-child-ref class this file has swept five times.
    await Occurrence.updateMany({ gridId: gid, occurrences: { $in: ids } },
      { $pull: { occurrences: { $in: ids } } });
    await Occurrence.deleteMany({ gridId: gid, id: { $in: ids } });
  }

  log(`  ${doomed.length} duplicate column(s) ${apply ? "removed" : "would be removed"}.`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
