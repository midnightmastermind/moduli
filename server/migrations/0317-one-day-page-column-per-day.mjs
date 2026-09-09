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

// ── 2026-09-09: THIS MIGRATION DESTROYED A SHARED NODE, AND HAD A BLIND SPOT ──
//
// Run to clear duplicates, it deleted the grid's ONE `Emotions Wheel` — the
// occurrence `0297` deliberately multi-parented into every day column. It was a
// child of a doomed column, so the subtree walk took it; worse, the unlink was
// `$pull { occurrences: { $in: ids } }` across EVERY parent, so it was removed
// from the five columns that were staying before it was deleted. Caught by
// `checkGrid`'s `orphan-module` warning and restored verbatim from this
// migration's own pre-run snapshot.
//
//   A DOOMED COLUMN OWNS ONLY WHAT NOTHING ELSE LISTS. A child listed by any
//   parent outside the doomed subtree is SHARED — it is spared, and it keeps
//   its own subtree (the 2026-08-11 rule, and the same `listedElsewhere` guard
//   the hand-written sweep that morning had and this file did not).
//
// And it could only ever see duplicates the parent LISTS, because it grouped by
// walking `parent.occurrences`. A column that is parented but never listed was
// invisible — not hypothetical: one survived the same repair that morning and
// had to be removed by hand. Grouping now also keys on `parentId`.
//
// The decision is a pure `planDuplicateRemoval` so both rules are testable
// without a database; `up()` only writes what it returns.
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

/**
 * Pure. Decide which duplicate columns go and which children must survive.
 *
 * A group is (parent, signature) where the signature was declared as the node's
 * IDENTITY (`meta.signatureUnique`) — never a bare signature, which is also a
 * shared MARKER (`0303`; keyed on the signature alone this matched the seven
 * weekday templates and proposed deleting 400+ of the user's own rows).
 */
export function planDuplicateRemoval({ occurrences, modules = [] }) {
  const occById = Object.fromEntries(occurrences.map((o) => [o.id, o]));
  const modById = Object.fromEntries(modules.map((m) => [m.id, m]));
  const labelOf = (o) => o && (o.label || modById[o.moduleId]?.label || "(unlabeled)");
  const isCandidate = (c) => !!c?.identitySignature && c?.meta?.signatureUnique === true;

  // Group by (parent, signature) from BOTH directions: what a parent lists, and
  // what names it as `parentId`. The second is the blind spot that let a
  // duplicate survive — a column nobody lists renders nowhere but is still a
  // duplicate, and `gridIntegrity` flags it by parentId.
  const groups = new Map();
  const add = (parent, c) => {
    const key = `${parent.id}::${c.identitySignature}`;
    if (!groups.has(key)) groups.set(key, { parent, sig: c.identitySignature, kids: [], listed: new Set() });
    const g = groups.get(key);
    if (!g.kids.some((k) => k.id === c.id)) g.kids.push(c);
  };
  for (const parent of occurrences)
    for (const cid of parent.occurrences || []) {
      const c = occById[cid];
      if (isCandidate(c)) { add(parent, c); groups.get(`${parent.id}::${c.identitySignature}`).listed.add(c.id); }
    }
  for (const c of occurrences) {
    if (!isCandidate(c)) continue;
    const parent = c.parentId && occById[c.parentId];
    if (parent) add(parent, c);
  }

  // Every id the subtree of `rootId` reaches, tentatively.
  const reach = (rootId) => {
    const out = []; const seen = new Set();
    (function w(id, d) {
      if (d > 8 || seen.has(id)) return;
      seen.add(id); out.push(id);
      for (const c of occById[id]?.occurrences || []) w(c, d + 1);
    })(rootId, 0);
    return out;
  };
  const listersOf = (id) => occurrences.filter((o) => (o.occurrences || []).includes(id)).map((o) => o.id);

  const decisions = [];
  for (const { parent, sig, kids, listed } of groups.values()) {
    if (kids.length < 2) continue;
    const scored = kids.map((k) => ({
      k, prose: proseIn(occById, k.id), n: (k.occurrences || []).length, listed: listed.has(k.id),
    }));
    const written = scored.filter((s) => s.prose > 0);
    // MORE THAN ONE holding writing is a human call.
    if (written.length > 1) { decisions.push({ parent, sig, scored, skipped: `${written.length} hold writing` }); continue; }
    // Keep what holds writing; else what the day was actually built into — and
    // a LISTED column beats an unlisted one, because the listing is what renders.
    const keep = written[0]
      || scored.slice().sort((a, b) => (b.listed - a.listed) || (b.n - a.n))[0];
    const doomed = [];
    for (const s of scored) {
      if (s.k.id === keep.k.id) continue;
      const tentative = new Set(reach(s.k.id));
      // A child listed by anything OUTSIDE this subtree is shared. Tested
      // against the ORIGINAL set, never one being mutated (2026-09-03 (12)),
      // and a spared node KEEPS ITS OWN SUBTREE.
      const spared = new Set();
      for (const id of tentative) {
        if (id === s.k.id) continue;
        if (listersOf(id).some((p) => !tentative.has(p))) spared.add(id);
      }
      const keepAll = new Set();
      for (const sp of spared) for (const id of reach(sp)) keepAll.add(id);
      doomed.push({
        occ: s.k, parent, keep: keep.k.id,
        removeIds: [...tentative].filter((i) => !keepAll.has(i)),
        sparedIds: [...keepAll],
        sparedLabels: [...spared].map((i) => labelOf(occById[i])),
      });
    }
    decisions.push({ parent, sig, scored, keep: keep.k.id, doomed });
  }
  return { decisions, doomed: decisions.flatMap((d) => d.doomed || []) };
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
  const { decisions, doomed } = planDuplicateRemoval({ occurrences: occs, modules: mods });

  for (const d of decisions) {
    log(`  ${labelOf(d.parent)} / ${d.sig}: ${d.scored.length} columns` +
        d.scored.map((s) => `\n      ${s.k.id}  ${s.n} children · ${s.prose} chars of prose`
          + (s.listed ? "" : "  (parented but NOT listed)")).join(""));
    if (d.skipped) { log(`      SKIPPED — ${d.skipped}; merging is your call`); continue; }
    log(`      keeping ${d.keep}`);
  }

  if (!doomed.length) { log("  no duplicate columns to remove."); return; }

  for (const d of doomed) {
    const shared = d.sparedIds.length;
    log(`  removing ${d.occ.id} (${d.removeIds.length} occurrence(s) incl. children) from ${labelOf(d.parent)}`
      + (shared ? `  — SPARING ${shared} shared node(s): ${d.sparedLabels.slice(0, 4).join(", ")}` : ""));
    if (!apply) continue;

    const dir = path.resolve("backups/orphans");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}_duplicate-day-column.json`),
      JSON.stringify(d.removeIds.map((i) => occById[i]).filter(Boolean), null, 1));

    // UNLINK FIRST — a delete that leaves the parent listing the child mints the
    // dangling-child-ref class this file has swept five times. ONLY the doomed
    // ids: pulling the whole subtree took a shared node out of the five parents
    // that were keeping it (2026-09-09, see the header).
    await Occurrence.updateMany({ gridId: gid, occurrences: { $in: d.removeIds } },
      { $pull: { occurrences: { $in: d.removeIds } } });
    await Occurrence.deleteMany({ gridId: gid, id: { $in: d.removeIds } });

    // THE CONTROL: every node we spared must still be listed by something.
    if (d.sparedIds.length) {
      const orphaned = [];
      for (const sid of d.sparedIds) {
        const stillListed = await Occurrence.countDocuments({ gridId: gid, occurrences: sid });
        if (!stillListed) orphaned.push(sid);
      }
      if (orphaned.length)
        throw new Error(`spared ${orphaned.length} node(s) but nothing lists them now: ${orphaned.join(", ")}`);
      log(`      ${d.sparedIds.length} shared node(s) still listed elsewhere.`);
    }
  }

  log(`  ${doomed.length} duplicate column(s) ${apply ? "removed" : "would be removed"}.`);
  if (!apply) log("  DRY RUN - pass --apply to write.");
}
