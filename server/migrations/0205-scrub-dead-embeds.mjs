// 0205 — an embed pointing at an occurrence that no longer exists paints
//        `embed: <uuid>` as raw text on the page.
//
// FOUND BY OPENING A PAGE, not by reading data. `ModuleEmbedNode` draws a dashed
// box reading `embed: <id>` when it cannot resolve the module behind the node —
// so a deleted occurrence leaves a visible error on whatever embedded it, for as
// long as that page exists.
//
// PROVENANCE, established rather than guessed: 28 nodes across 15 hosts, and the
// heaviest (Monday, August 10th, ×6) is precisely the day `0070` cleaned up on
// 2026-08-11 — it deleted 18 duplicate occurrences and 18 modules and did not
// touch the textmaps that embedded them. CLAUDE.md 2026-08-19 (2) fixed the live
// DELETE path to scrub as it goes; this is the residue from before that.
//
// ── THE SAFETY QUESTION THIS MIGRATION HAD TO ANSWER ────────────────────────
//
// CLAUDE.md 2026-08-01 (19) records a scrub of exactly this shape CAUSING the
// regression it was meant to fix: the removed embed was the only thing rendering
// a surviving sibling, so the Daily Question vanished from two day pages.
// *"Removing a dangling reference is not automatically safe."*
//
// Three measurements say this one cannot repeat that:
//
//   the target is GONE EVERYWHERE     checked against every Occurrence in the
//                                     database, not just this grid — 28 of 28
//                                     resolve nowhere, so no surviving sibling
//                                     is being drawn through them
//   nothing is hidden behind them     the 54 children these hosts LIST but do
//                                     not embed were measured for content:
//                                     52 hold nothing at all and 2 hold ONE
//                                     character. There is no writing to lose
//   a node is removed only if the     a target that resolves is KEPT and logged.
//   pointer resolves nowhere          The predicate is "points at nothing",
//                                     never "looks stale"
//
// AND IT DELIBERATELY DOES NOT RE-EMBED. The obvious companion repair — draw the
// listed-but-unembedded children — was measured and DROPPED: all but two are
// empty, so it would add 54 blank boxes to pages that currently look fine. Those
// are `sweepOrphans`' business, not a renderer's.
//
// The whole textmap is dumped before each write, because a textmap edit is not
// reversible from the result.
import fs from "fs";
import path from "path";
import { decompressTextmap, compressTextmap } from "../utils/textmapCompression.js";

export const id = "0205-scrub-dead-embeds";
export const description =
  "Remove embed nodes whose target occurrence does not exist anywhere — they render as `embed: <uuid>`";

const isEmbed = (type) => /embed/i.test(String(type || ""));
const targetOf = (node) => node?.attrs?.occurrenceId || node?.attrs?.id || null;

/**
 * Strip embed nodes whose target is not in `alive`.
 * PURE and exported so the decision is testable without a database.
 * @returns { next, removed: [ids], kept: [ids] } — `next` is null when nothing changed
 */
export function stripDeadEmbeds(doc, alive) {
  const removed = [], kept = [];
  let changed = false;
  const walk = (node) => {
    if (!node || !Array.isArray(node.content)) return node;
    const content = [];
    for (const child of node.content) {
      if (isEmbed(child?.type)) {
        const t = targetOf(child);
        // A node with NO target is left alone: it is a different defect and
        // guessing at it here would widen a repair whose safety rests on the
        // pointer being checkable.
        if (t && !alive.has(t)) { removed.push(t); changed = true; continue; }
        if (t) kept.push(t);
      }
      content.push(walk(child));
    }
    return { ...node, content };
  };
  const next = walk(doc);
  return { next: changed ? next : null, removed, kept };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  // GLOBAL, not grid-scoped. Occurrence ids are unique across the database, and
  // an id that resolves in another grid is a MOVE, not a deletion — scoping this
  // to one grid would delete the embed of something that still exists.
  const alive = new Set((await Occurrence.find({}, { id: 1 }).lean()).map((o) => o.id));
  const occs = await Occurrence.find({ gridId }).lean();
  const mods = await Module.find({ gridId }, { id: 1, label: 1 }).lean();
  const label = new Map(mods.map((m) => [m.id, m.label]));

  const dump = [];
  let hosts = 0, nodes = 0, keptTotal = 0;

  for (const occ of occs) {
    const doc = decompressTextmap(occ.textmap);
    if (!doc) continue;
    const { next, removed, kept } = stripDeadEmbeds(doc, alive);
    keptTotal += kept.length;
    if (!next) continue;
    hosts++; nodes += removed.length;
    log(`  ${(label.get(occ.moduleId) || "(no module)").slice(0, 30).padEnd(32)} removes ${removed.length}: ${removed.map((r) => r.slice(0, 8)).join(", ")}`);
    dump.push({ occurrenceId: occ.id, moduleLabel: label.get(occ.moduleId) || null, removed, textmap: occ.textmap });
    if (!dryRun) {
      await Occurrence.updateOne({ id: occ.id, gridId }, { $set: { textmap: compressTextmap(next) } });
    }
  }

  if (dump.length && !dryRun) {
    const dir = path.resolve("backups/orphans");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `0205-dead-embeds-${Date.now()}.json`);
    // The RAW stored textmap, compressed exactly as it sat in Mongo, so a
    // restore is byte-for-byte what was removed.
    fs.writeFileSync(file, JSON.stringify(dump, null, 2));
    log(`  dumped ${dump.length} textmaps to ${file}`);
  }

  log(`${dryRun ? "[dry run] " : ""}${nodes} dead embed nodes on ${hosts} hosts; ${keptTotal} live embeds untouched`);
  return { hosts, nodes, kept: keptTotal };
}
