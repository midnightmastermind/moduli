// 0345 — remove the embeds un-picking left behind in day columns.
//
// User, 2026-09-19: un-picking an emotion on the wheel left `embed: 4edd87c8…`
// in the day column. The Check In was deleted, but the column's editor kept the
// dead node and saved it back after the server had scrubbed it. The client now
// removes the node on the delete itself (helpers/embedRegistry.dropEmbedsOf);
// this repairs the ones already saved.
//
// SCOPED THREE WAYS, because "does this pointer resolve?" has damaged data here
// before (2026-08-01 (19)): only DAY COLUMNS (`daypage:col:*`), only TOP-LEVEL
// moduleEmbed nodes (where a Check In is embedded), and only ids that name NO
// occurrence in the database — not "missing from a cache", which is normal for
// deferred artifacts. A dangling id renders nothing but the placeholder.

import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";

export const id = "0345-day-columns-drop-embeds-of-deleted-check-ins";
export const describe = "Day columns drop top-level embeds whose occurrence no longer exists (the ghosts un-picking left).";
export const touches = ["occurrences"];

const SINCE = "2026-09-19";

/** PURE — the doc without top-level embeds naming a dead id. */
export function dropDeadEmbeds(doc, isLive) {
  const content = Array.isArray(doc?.content) ? doc.content : [];
  const dead = content.filter((n) => n?.type === "moduleEmbed" && n.attrs?.occurrenceId && !isLive(n.attrs.occurrenceId));
  if (!dead.length) return { doc, dropped: [] };
  return { doc: { ...doc, content: content.filter((n) => !dead.includes(n)) }, dropped: dead.map((n) => n.attrs.occurrenceId) };
}

export async function up({ gridId, models, log = console.log, dryRun = true }) {
  const { Occurrence } = models;
  const gid = String(gridId);
  // FROM TODAY ON: that is where the Check In embeds live (`0343`, 2026-09-19).
  // Older columns carry a different ghost — `289583d9`, almost certainly the
  // wheel replaced on 2026-09-09 — and dropping it would leave those days with
  // no wheel rather than restore one. That is the user's decision, not this repair's.
  const cols = (await Occurrence.find({ gridId: gid, identitySignature: /^daypage:col:/ }).lean())
    .filter((c) => c.identitySignature.slice("daypage:col:".length) >= SINCE);
  const plans = [];
  const ids = new Set();
  const docs = new Map();
  for (const c of cols) {
    const doc = decompressTextmap(c.textmap);
    docs.set(c.id, doc);
    for (const n of doc?.content || []) if (n?.type === "moduleEmbed" && n.attrs?.occurrenceId) ids.add(n.attrs.occurrenceId);
  }
  const live = new Set((await Occurrence.find({ id: { $in: [...ids] } }).select("id").lean()).map((o) => o.id));
  for (const c of cols) {
    const { doc, dropped } = dropDeadEmbeds(docs.get(c.id), (x) => live.has(x));
    if (dropped.length) plans.push({ id: c.id, sig: c.identitySignature, doc, dropped });
  }
  log(`  ${cols.length} day columns · ${plans.length} carry a dead embed`);
  for (const p of plans) log(`    ${p.sig}  drops ${p.dropped.map((d) => d.slice(0, 8)).join(", ")}`);
  if (dryRun || !plans.length) { if (dryRun) log("  Dry run — nothing written."); return { changed: 0 }; }
  for (const p of plans) {
    await Occurrence.updateOne({ gridId: gid, id: p.id }, { $set: { textmap: compressTextmap(p.doc) } });
  }
  for (const p of plans) {
    const after = await Occurrence.findOne({ gridId: gid, id: p.id }).lean();
    const left = (decompressTextmap(after.textmap)?.content || []).filter((n) => p.dropped.includes(n?.attrs?.occurrenceId));
    if (left.length) throw new Error(`0345: ${p.sig} still embeds a dead id`);
  }
  log(`  ${plans.length} column(s) repaired.`);
  return { changed: plans.length };
}
