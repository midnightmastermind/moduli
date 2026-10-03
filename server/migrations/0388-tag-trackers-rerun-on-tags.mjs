// server/migrations/0388-tag-trackers-rerun-on-tags.mjs
//
// A tracker that counts rows by a LITERAL tag ("Tags CONTAINS intellectual" — Time
// Spent, Total Reading Time, Work / Creative / Practice Duration, Connection Time,
// Environment Care) did not re-run when a row's Tags changed: none of the 31
// operations that read Tags listed it as a trigger. Tagging a 30-minute Study
// "intellectual" left Reading Time at 0 until the next load (watched on the
// rebuild grid, 2026-10-03). These seven gain an onChange · Tags trigger at their
// own priority. The 24 that read Tags only against the tile's own category filter
// ($goalCategory) are left alone — no tile on poms sets one.

export const id = "0388-tag-trackers-rerun-on-tags";
export const describe = "Trackers that count by a literal tag re-run when a row's Tags change (onChange · Tags trigger).";
export const touches = ["operations"];

/** PURE. Does the pipeline compare Tags against a literal tag? */
export function readsLiteralTag(pipeline, tagsFieldId) {
  let hit = false;
  const walk = (steps) => { for (const s of steps || []) {
    for (const r of s.condition?.rules || []) visit(r);
    walk(s.then); walk(s.else); walk(s.body);
  } };
  const visit = (r) => { if (r.rules) return r.rules.forEach(visit); if (String(r.left || "").endsWith(`fields.${tagsFieldId}.value`) && r.comparator === "CONTAINS" && r.right && !String(r.right).startsWith("$")) hit = true; };
  walk(pipeline?.steps);
  return hit;
}

/** PURE. The triggers plus onChange · Tags, once. */
export function withTagsTrigger(triggers, tagsFieldId) {
  const list = triggers || [];
  if (list.some((t) => t.eventType === "onChange" && t.targetId === tagsFieldId)) return null;
  const priority = list.find((t) => t.eventType === "onChange")?.priority ?? list[0]?.priority ?? 3;
  return [...list, { eventType: "onChange", subjectType: "field", targetId: tagsFieldId, priority }];
}

export async function up({ gridId, models, log, dryRun }) {
  const { Operation, Field } = models;
  const tags = (await Field.find({ gridId, name: "Tags" }).lean());
  if (tags.length !== 1) throw new Error(`0388: expected one Tags field, found ${tags.length}`);
  const tagsId = tags[0].id;
  const ops = await Operation.find({ gridId }).lean();
  const changes = ops.filter((o) => readsLiteralTag(o.pipeline, tagsId)).map((o) => [o, withTagsTrigger(o.triggerObjects, tagsId)]).filter(([, t]) => t);
  for (const [o] of changes) log(`+ onChange · Tags on "${o.name}"`);
  if (!changes.length) log("nothing to add");
  if (dryRun) return;
  for (const [o, t] of changes) await Operation.updateOne({ gridId, id: o.id }, { $set: { triggerObjects: t, triggerTypes: [...new Set([...(o.triggerTypes || []), "onChange"])] } });
  log("done. Restart the server (pm2).");
}
