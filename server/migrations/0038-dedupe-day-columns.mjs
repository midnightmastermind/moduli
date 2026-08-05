// server/migrations/0038-dedupe-day-columns.mjs
//
// poms grid grew a SECOND day column for 2026-08-04 — same label, same date,
// same parent — and the surviving pair holds 4 children and 8 children
// respectively (the 8 being Journal/Notes/Tasks Completed/Highlights twice).
//
// The section signatures are NOT the problem: template and columns both read
// daypage:Journal / daypage:Notes / daypage:Tasks Completed / daypage:Highlights,
// identical on every column checked. What failed is the COLUMN-level existence
// check in `Day Page: Build` — it did not find the column that already existed
// for that date, minted another, and then merged into it a second time.
//
// This repairs the DATA. The build op's existence check is a separate fix and is
// deliberately not attempted here — see the task list.
//
// SAFETY, which is the whole design here:
//   * The keeper is whichever column holds the most WRITING (textmap length +
//     field values), never simply the first or the biggest child count.
//   * A loser is only ever deleted when it holds NO writing at all. If both
//     copies contain writing the pair is REPORTED AND SKIPPED — a duplicate
//     column is a nuisance, a deleted journal entry is not. Same rule the 0022 /
//     0023 repairs committed to.
//   * Within a kept column, duplicate sections are collapsed by signature under
//     the same rule: the copy with writing wins, and nothing containing writing
//     is dropped.
export const id = "0038-dedupe-day-columns";
export const describe =
  "Removes duplicate day columns (same date, same parent) and duplicate sections within a column, " +
  "keeping whichever copy holds writing and never deleting anything that contains any.";

/**
 * "Does this hold anything the USER typed" — textmap only, deliberately.
 *
 * The first version also counted field VALUES, and the first dry run refused to
 * delete a single duplicate because every container scored 10: the date that
 * migration 0037 had just stamped on all of them. Op-stamped fields are not
 * writing, and counting them made the safety rule fire on its own footprint and
 * protect empty clones. Textmap is where a journal entry actually lives.
 *
 * Raw documents store textmap COMPRESSED, so a decompress-free length check is
 * used: an empty doc still serialises to a small amount of scaffolding, and the
 * threshold sits above it. Erring high is the safe direction here — it protects
 * more, at the cost of leaving a duplicate behind for a human to look at.
 */
export function writingScore(occ) {
  const tm = occ?.textmap;
  if (!tm) return 0;
  const s = typeof tm === "string" ? tm : JSON.stringify(tm);
  return Math.max(0, s.length - 120);
}

/** Group by a key, returning only the groups with more than one member. */
export function duplicateGroups(items, keyOf) {
  const groups = new Map();
  for (const it of items) {
    const k = keyOf(it);
    if (k == null) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  return [...groups.entries()].filter(([, v]) => v.length > 1);
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Grid } = models;

  const grid = await Grid.findById(gridId).lean();
  const dateFieldId = grid?.meta?.scheduleFieldIds?.dateFieldId;
  if (!dateFieldId) { log("no scheduleFieldIds.dateFieldId — nothing to do"); return; }

  // textmap IS needed here: it is how "holds writing" is judged.
  const occs = await Occurrence.find({ gridId }).lean();
  const byId = new Map(occs.map(o => [o.id, o]));
  const scoreOf = (id) => {
    const o = byId.get(id);
    if (!o) return 0;
    let s = writingScore(o);
    for (const c of o.occurrences || []) s += scoreOf(c);   // children count too
    return s;
  };

  const applied = occs.filter(o => o.meta?.appliedFromTemplateId);
  let removed = 0, skipped = 0;

  // ── 1. Duplicate COLUMNS: same template + same date + same parent ─────────
  const dupCols = duplicateGroups(
    applied.filter(o => o.parentId && o.fields?.[dateFieldId]?.value),
    (o) => `${o.meta.appliedFromTemplateId}|${o.parentId}|${o.fields[dateFieldId].value}`
  );
  log(`${dupCols.length} duplicated day column(s)`);

  for (const [key, group] of dupCols) {
    const scored = group.map(o => ({ o, score: scoreOf(o.id) })).sort((a, b) => b.score - a.score);
    const keeper = scored[0];
    const losers = scored.slice(1);
    const withWriting = losers.filter(l => l.score > 0);
    log(`  ${key.split("|").pop()}: keeping ${keeper.o.id} (score ${keeper.score}); ` +
        `losers ${losers.map(l => `${l.o.id}:${l.score}`).join(", ")}`);

    if (withWriting.length) {
      log(`     SKIPPED — ${withWriting.length} loser(s) contain writing; refusing to delete`);
      skipped += withWriting.length;
      continue;
    }
    for (const l of losers) {
      if (!dryRun) {
        await Occurrence.updateOne({ gridId, id: l.o.parentId }, { $pull: { occurrences: l.o.id } });
        // Its children were empty clones too — remove them with it.
        const kids = l.o.occurrences || [];
        if (kids.length) await Occurrence.deleteMany({ gridId, id: { $in: kids } });
        await Occurrence.deleteOne({ gridId, id: l.o.id });
      }
      removed++;
    }
  }

  // ── 2. Duplicate SECTIONS inside a surviving column ───────────────────────
  for (const col of applied) {
    const kids = (col.occurrences || []).map(id => byId.get(id)).filter(Boolean);
    const dupSecs = duplicateGroups(kids, (k) => k.identitySignature || null);
    for (const [sig, group] of dupSecs) {
      const scored = group.map(o => ({ o, score: scoreOf(o.id) })).sort((a, b) => b.score - a.score);
      const losers = scored.slice(1);
      const withWriting = losers.filter(l => l.score > 0);
      log(`  ${col.label || col.id} › ${sig} ×${group.length}: keeping ${scored[0].o.id} (${scored[0].score})`);
      if (withWriting.length) {
        log(`     SKIPPED — ${withWriting.length} duplicate(s) contain writing`);
        skipped += withWriting.length;
        continue;
      }
      for (const l of losers) {
        if (!dryRun) {
          await Occurrence.updateOne({ gridId, id: col.id }, { $pull: { occurrences: l.o.id } });
          await Occurrence.deleteOne({ gridId, id: l.o.id });
        }
        removed++;
      }
    }
  }

  log(dryRun
    ? `(dry run — would remove ${removed}, skip ${skipped} that hold writing)`
    : `removed ${removed}, skipped ${skipped} that hold writing`);
}
