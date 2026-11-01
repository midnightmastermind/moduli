/**
 * 0480 — the Danny Documentaries board is parented to its page.
 *
 * 0479 created the board container with `parentId: null` while its page listed it; 0472's Episodes board (and every
 * page the app makes) parents its container to the page, and a page delete cascades only into children whose
 * parentId points back — so deleting the page would have stranded the board and every row on it. 0479 is fixed for
 * new grids; this sets the one field on grids where 0479 already ran. Changes nothing else.
 */
export const id = "0480-danny-board-parent";
export const describe = "Sets parentId of the Danny Documentaries board container to the page that lists it. Nothing else.";
export const touches = ["occurrences"];

export const DANNY_SIGNATURE = "jellyfin:danny";

/** Pure: { id, parentId } to set, or null when there is nothing to do. Throws unless exactly one page lists it. */
export function planParentFix(occurrences) {
  const box = occurrences.find((o) => o.identitySignature === DANNY_SIGNATURE);
  if (!box) return null;
  const listers = occurrences.filter((o) => (o.occurrences || []).includes(box.id));
  if (listers.length !== 1) throw new Error(`REFUSING: ${listers.length} occurrences list the Danny board (want 1)`);
  if (box.parentId === listers[0].id) return null;
  return { id: box.id, parentId: listers[0].id };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence } = models;
  const occs = await Occurrence.find({ gridId }, { id: 1, identitySignature: 1, parentId: 1, occurrences: 1 }).lean();
  const fix = planParentFix(occs);
  log(fix ? `  board ${fix.id}: parentId -> ${fix.parentId}` : "  nothing to do");
  if (!fix || dryRun) return;
  await Occurrence.updateOne({ gridId, id: fix.id, identitySignature: DANNY_SIGNATURE }, { $set: { parentId: fix.parentId, updatedAt: new Date() } });
  const after = await Occurrence.findOne({ gridId, id: fix.id }).lean();
  if (after?.parentId !== fix.parentId) throw new Error("readback: parentId not set");
  log("  applied and read back — RESTART pm2.");
}
