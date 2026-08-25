/**
 * 0247 — the Schedule Canvas goes, and "the op for it" was already gone.
 *
 * User, 2026-08-25: *"you can get rid of the schedule canvas and the op for it btw"*
 *
 * ── THERE IS NO OP, AND THE SEED SAYS SO IN AS MANY WORDS ────────────────
 *
 * `Canvas: Build` was DELETED on 2026-07-07 and replaced by an occurrence
 * FEED. `createLiveData.js` still carries the note:
 *
 *     "The `Table: Build` + `Canvas: Build` mirror OPS are gone — both pages
 *      now carry an occurrence FEED (occurrence.feed, synced by the client's
 *      generic helpers/feedSync.js engine)"
 *
 * Measured rather than trusted: on poms grid **no operation mentions the
 * canvas at all** — not by name, not by its occurrence id, not by its module
 * id, and not by any of its 29 children's ids.
 *
 *     "Schedule Canvas"  -> (none)      z9lntG03zNIP -> (none)
 *     9ROzuzrNcw7Q       -> (none)      children      -> (none)
 *
 * So the thing that still RUNS for this page is the feed, and a feed is a
 * field ON the occurrence. Deleting the occurrence deletes the op. There is
 * no second artifact to hunt down — which is worth stating, because looking
 * for an Operation record and finding none reads exactly like a missed step.
 *
 * ── WHY DELETING 29 CHILDREN DESTROYS NOTHING ────────────────────────────
 *
 * Every one of the canvas's children is a feed COPY, and each copy's source
 * lives OUTSIDE the canvas:
 *
 *     parented children 29   feed copies 29   NOT copies 0
 *     sources outside the canvas 29   inside 0   missing 0
 *     copies having children 0
 *
 * And nothing was ever typed onto a copy — every copy's fields are byte-equal
 * to its source's:
 *
 *     copies whose fields MATCH their source exactly   29 / 29
 *     shuffled pairing (the control)                   27 differ   <- the comparator works
 *
 * That control matters: comparing each copy to its own source AND to the
 * Schedule Table's copies both read "0 differ", so the check had to be shown
 * reporting non-zero before its zero meant anything.
 *
 * ── IT REFUSES RATHER THAN ORPHANS ───────────────────────────────────────
 *
 * A child that is NOT a feed copy is something a person put there, and
 * deleting the page under it would strand it. The migration refuses the whole
 * removal and reports, instead of deleting the page and re-homing on a guess.
 * Zero such children exist on poms grid today; the guard is for the next grid.
 *
 * ── BOTH PANELS ARE UNLISTED, AND NEITHER IS LEFT EMPTY ──────────────────
 *
 *     Panel C  lists 17 pages  -> 16      Panel D  lists 4 -> 3
 *
 * Unlisting uses `$pull` rather than a whole-array write: a read-modify-write
 * on `occurrences[]` is what a connected client's stale echo clobbers
 * (2026-08-13 (2)), and it is what the 2026-08-04 dangling-ref hunt landed on.
 * Leaving a panel listing a deleted id is the dangling-child-ref class this
 * repo has swept five times.
 *
 * The module is placed by exactly ONE occurrence, so it is swept too —
 * deleting an occurrence never removes its module (2026-08-13 (3)).
 *
 * The seed half ships in the same pass, or a reseeded grid would mint the
 * canvas straight back and the two would drift (the `0043` / `0064` rule).
 */
import fs from "fs";
import path from "path";
import { decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0247-drop-the-schedule-canvas";
export const describe =
  "Deletes the Schedule Canvas page, its feed (which IS 'the op for it' — Canvas: Build was retired 2026-07-07), and its 29 feed copies; unlists it from every panel and sweeps the orphaned module. Refuses if any child is not a feed copy.";
export const touches = ["occurrences", "modules"];

export function textCharsOf(occ) {
  const tm = decompressTextmap(occ?.textmap);
  if (!tm) return 0;
  let n = 0;
  (function walk(node) {
    if (!node) return;
    if (typeof node.text === "string") n += node.text.length;
    for (const c of node.content || []) walk(c);
  })(tm);
  return n;
}

/**
 * The whole selection rule, pure so it can be tested without a database.
 *
 * Resolves the page by module label AND type, refusing if ambiguous — the
 * house rule for a grid that carries duplicate labels (0212 / 0230). Returns
 * `{ canvas, copies, unlistFrom, orphanModuleId, refusals }`; a non-empty
 * `refusals` means DO NOTHING.
 */
export function planCanvasRemoval({ occurrences, modules, operations, gridMeta }) {
  const modById = new Map(modules.map((m) => [m.id, m]));
  const refusals = [];

  const matches = occurrences.filter((o) => {
    const m = modById.get(o.moduleId);
    return m?.role === "page" && m?.kind === "canvas" && m?.label === "Schedule Canvas";
  });
  if (matches.length === 0) return { canvas: null, copies: [], unlistFrom: [], orphanModuleId: null, refusals };
  if (matches.length > 1) {
    refusals.push(`${matches.length} page/canvas occurrences are labelled "Schedule Canvas" — ambiguous, refusing`);
    return { canvas: null, copies: [], unlistFrom: [], orphanModuleId: null, refusals };
  }
  const canvas = matches[0];

  // Every child, by BOTH edges — parented to it, or listed by it. A node
  // reachable either way is a node this delete would strand.
  const listed = new Set(canvas.occurrences || []);
  const children = occurrences.filter((o) => o.parentId === canvas.id || listed.has(o.id));

  const copies = [];
  for (const c of children) {
    const why = [];
    if (!c.meta?.feedSourceId) why.push("not a feed copy");
    else {
      const src = occurrences.find((o) => o.id === c.meta.feedSourceId);
      if (!src) why.push("feed source no longer exists");
      else if (src.parentId === canvas.id) why.push("its feed source lives inside the canvas");
    }
    if (occurrences.some((o) => o.parentId === c.id)) why.push("has children of its own");
    if ((c.occurrences || []).length) why.push(`lists ${c.occurrences.length} child(ren)`);
    if (textCharsOf(c)) why.push(`carries ${textCharsOf(c)} character(s) of text`);
    const otherParents = occurrences.filter(
      (o) => o.id !== canvas.id && (o.occurrences || []).includes(c.id)
    );
    if (otherParents.length) why.push("listed by another occurrence");

    if (why.length) refusals.push(`child ${c.id} ("${c.label ?? modById.get(c.moduleId)?.label ?? "?"}"): ${why.join("; ")}`);
    else copies.push(c);
  }

  // Nothing outside may name the page or its children.
  const opBlob = JSON.stringify(operations || []);
  const doomed = [canvas.id, ...copies.map((c) => c.id)];
  for (const oid of doomed) if (opBlob.includes(oid)) refusals.push(`occurrence ${oid} is named by an operation`);
  if (opBlob.includes(canvas.moduleId)) refusals.push(`module ${canvas.moduleId} is named by an operation`);
  const metaBlob = JSON.stringify(gridMeta || {});
  for (const oid of doomed) if (metaBlob.includes(oid)) refusals.push(`occurrence ${oid} is named in grid.meta`);
  for (const o of occurrences) {
    const tm = decompressTextmap(o.textmap);
    if (!tm) continue;
    const s = JSON.stringify(tm);
    for (const oid of doomed) if (s.includes(oid)) refusals.push(`occurrence ${oid} is embedded in ${o.id}'s textmap`);
  }

  // Who lists the page — every one must be unlisted or it dangles.
  const unlistFrom = occurrences.filter((o) => (o.occurrences || []).includes(canvas.id)).map((o) => o.id);

  // The module is swept UNCONDITIONALLY, and the A/B is why. A "is this the
  // module's last placement?" test here guards nothing: every occurrence
  // carrying this moduleId resolves to the same page/canvas/"Schedule Canvas"
  // module, so a second placement would already have tripped the ambiguity
  // refusal above and returned. Removing that condition fails 0 of 11 tests —
  // a guard nobody can watch fire is one that gets trusted without earning it.
  const orphanModuleId = canvas.moduleId;

  return { canvas, copies, unlistFrom, orphanModuleId, refusals };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Operation, Grid } = models;
  const [occurrences, modules, operations, grid] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
    Operation.find({ gridId }).lean(),
    Grid.findById(gridId).lean(),
  ]);

  const plan = planCanvasRemoval({ occurrences, modules, operations, gridMeta: grid?.meta });

  if (!plan.canvas && !plan.refusals.length) { log("no Schedule Canvas on this grid — nothing to do."); return; }
  if (plan.refusals.length) {
    log("REFUSING — the canvas holds something this migration will not delete:");
    for (const r of plan.refusals) log(`   ! ${r}`);
    log("nothing written.");
    return;
  }

  const modById = new Map(modules.map((m) => [m.id, m]));
  log(`Schedule Canvas ${plan.canvas.id}  (module ${plan.canvas.moduleId})`);
  log(`  feed: ${plan.canvas.feed?.enabled ? "ENABLED" : "none"} — this is "the op for it"; Canvas: Build was retired 2026-07-07`);
  log(`  feed copies to delete: ${plan.copies.length}   (all verified copies whose sources live elsewhere)`);
  for (const pid of plan.unlistFrom) {
    const p = occurrences.find((o) => o.id === pid);
    log(`  unlist from "${p.label ?? modById.get(p.moduleId)?.label}" (${pid}) — lists ${(p.occurrences || []).length} -> ${(p.occurrences || []).length - 1}`);
  }
  log(`  orphaned module to sweep: ${plan.orphanModuleId ?? "(none — module has other placements)"}`);

  if (dryRun) { log("DRY RUN — nothing written."); return; }

  const dir = path.resolve(process.cwd(), "backups/orphans");
  fs.mkdirSync(dir, { recursive: true });
  const dump = path.join(dir, `0247-schedule-canvas-${Date.now()}.json`);
  fs.writeFileSync(
    dump,
    JSON.stringify(
      { canvas: plan.canvas, copies: plan.copies, module: modById.get(plan.canvas.moduleId), unlistFrom: plan.unlistFrom },
      null, 2
    )
  );
  log(`dumped the page, its module and ${plan.copies.length} copies to ${dump}`);

  // $pull, never a whole-array write: a read-modify-write on occurrences[] is
  // exactly what a connected client's stale echo clobbers (2026-08-13 (2)).
  for (const pid of plan.unlistFrom) {
    await Occurrence.updateOne({ gridId, id: pid }, { $pull: { occurrences: plan.canvas.id } });
  }
  log(`unlisted from ${plan.unlistFrom.length} parent(s).`);

  const ids = [plan.canvas.id, ...plan.copies.map((c) => c.id)];
  await Occurrence.deleteMany({ gridId, id: { $in: ids } });
  log(`deleted ${ids.length} occurrence(s) — the page and its ${plan.copies.length} feed copies.`);

  if (plan.orphanModuleId) {
    await Module.deleteOne({ gridId, id: plan.orphanModuleId });
    log(`swept the orphaned module ${plan.orphanModuleId}.`);
  }
}
