// 0346 — clear the Check Ins picked on the day columns, for a fresh test.
//
// User, 2026-09-19: *"remove all the moods from the db so we can have a fresh
// test. the existing moods arent really important"* — *"the ones i selected on
// daycol i mean"*.
//
// SCOPE, and each half is load-bearing:
//   - the Check In MODULE is read off `Mood: Record Selection`'s own COPY_LINK
//     source — never matched by a label;
//   - only occurrences of it whose `parentId` is a DAY COLUMN
//     (`daypage:col:*`), which is where the op creates them;
//   - the SOURCE template itself is never touched (it is what every pick copies).
// Each deleted id is also pulled from every parent's `occurrences[]` and every
// textmap's top-level embeds, or it would be left as `embed: <id>`.

import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0346-clear-day-column-check-ins";
export const describe = "Deletes the Check Ins picked on day columns (user asked for a fresh test), with their listings and embeds.";
export const touches = ["occurrences"];

const MOOD_OP = "Mood: Record Selection";

export function findCopyLinkSource(pipeline) {
  let found = null;
  const walk = (steps) => (steps || []).forEach((s) => {
    if ((s?.actionType || s?.config?.type) === "COPY_LINK" && s?.config?.sourceId) found ||= s.config.sourceId;
    walk(s?.then); walk(s?.else); walk(s?.body);
  });
  walk(pipeline?.steps);
  return found;
}

export async function up({ gridId, models, log = console.log, dryRun = true }) {
  const { Occurrence, Operation } = models;
  const gid = String(gridId);
  const op = await Operation.findOne({ gridId: gid, name: MOOD_OP }).lean();
  const sourceId = findCopyLinkSource(op?.pipeline);
  const source = sourceId ? await Occurrence.findOne({ gridId: gid, id: sourceId }).lean() : null;
  if (!source?.moduleId) { log(`  REFUSING: no Check In source on "${MOOD_OP}" — nothing written.`); return { changed: 0 }; }

  const cols = await Occurrence.find({ gridId: gid, identitySignature: /^daypage:col:/ }).select("id identitySignature").lean();
  const colIds = new Set(cols.map((c) => c.id));
  const doomed = (await Occurrence.find({ gridId: gid, moduleId: source.moduleId, id: { $ne: sourceId } }).lean())
    .filter((o) => colIds.has(o.parentId));
  const ids = new Set(doomed.map((o) => o.id));

  const byDay = {};
  for (const o of doomed) { const d = cols.find((c) => c.id === o.parentId).identitySignature.slice(12); byDay[d] = (byDay[d] || 0) + 1; }
  log(`  Check In module ${source.moduleId} (source ${sourceId} kept) · ${doomed.length} on day columns`);
  for (const [d, n] of Object.entries(byDay).sort()) log(`    ${d}: ${n}`);

  const listers = await Occurrence.find({ gridId: gid, occurrences: { $in: [...ids] } }).lean();
  const holders = (await Occurrence.find({ gridId: gid, id: { $in: [...colIds] } }).lean())
    .map((o) => ({ o, doc: decompressTextmap(o.textmap) }))
    .filter(({ doc }) => (doc?.content || []).some((n) => n?.type === "moduleEmbed" && ids.has(n.attrs?.occurrenceId)));
  log(`  unlist from ${listers.length} parent(s) · strip embeds from ${holders.length} column(s)`);
  if (dryRun || !ids.size) { if (dryRun) log("  Dry run — nothing written."); return { changed: 0 }; }

  for (const l of listers) await Occurrence.updateOne({ gridId: gid, id: l.id }, { $pull: { occurrences: { $in: [...ids] } } });
  for (const { o, doc } of holders) {
    const content = doc.content.filter((n) => !(n?.type === "moduleEmbed" && ids.has(n.attrs?.occurrenceId)));
    await Occurrence.updateOne({ gridId: gid, id: o.id }, { $set: { textmap: compressTextmap({ ...doc, content }) } });
  }
  await Occurrence.deleteMany({ gridId: gid, id: { $in: [...ids] } });

  const left = await Occurrence.countDocuments({ gridId: gid, id: { $in: [...ids] } });
  const stillListed = await Occurrence.countDocuments({ gridId: gid, occurrences: { $in: [...ids] } });
  const sourceAlive = await Occurrence.countDocuments({ gridId: gid, id: sourceId });
  if (left || stillListed || !sourceAlive) throw new Error(`0346: left=${left} stillListed=${stillListed} sourceAlive=${sourceAlive}`);
  log(`  ${ids.size} Check In(s) deleted; source kept.`);
  return { changed: ids.size };
}
