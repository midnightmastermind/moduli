// 0490 — A block embedded in a text and owned by nothing gets that text as its owner (2026-11-10).
//
// Deleting a page cascades through children that are LISTED and PARENTED. The importer embedded quotes in their
// lead-in textblocks (and an article's root section in its page's text) without either, so deleting the page
// left them behind, owned by nothing — found cleaning up the smarter-imports probe. The importer now owns them
// (utils/inlineChipOwnership.ownEmbeddedBlocks); this applies the same rule to what is already stored:
//   a `moduleEmbed` target with no parentId, listed by no occurrence, embedded by exactly ONE text
//   -> parentId = that text, and the text lists it.
// Embedded by two texts: left alone and reported (no single owner). Measured first: 547 on poms, 0 embedded twice.
import { decompressTextmap } from "../utils/textmapCompression.js";
import { embeddedBlockIds } from "../utils/inlineChipOwnership.js";

export const id = "0490-own-embedded-blocks";
export const describe = "A block embedded in a text and owned by nothing is parented to and listed by that text, so deleting the page takes it.";
export const description = describe;
export const touches = ["occurrences"];

/** Pure: [{ blockId, holderId }] for every block one text embeds and nothing owns; `shared` = embedded twice. */
export function planOwnEmbeds(occs) {
  const byId = new Map(occs.map((o) => [o.id, o]));
  const listed = new Set(occs.flatMap((o) => o.occurrences || []));
  const holderOf = new Map(); const shared = new Set();
  for (const h of occs) {
    if (!h.textmap) continue;
    let tm; try { tm = decompressTextmap(h.textmap); } catch { continue; }
    for (const bid of embeddedBlockIds(tm)) {
      const b = byId.get(bid);
      if (!b || b === h || b.parentId != null || listed.has(bid)) continue;
      if (holderOf.has(bid) && holderOf.get(bid) !== h.id) shared.add(bid); else holderOf.set(bid, h.id);
    }
  }
  const plan = [...holderOf].filter(([bid]) => !shared.has(bid)).map(([blockId, holderId]) => ({ blockId, holderId }));
  return { plan, shared: [...shared] };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const occs = await Occurrence.find({ gridId }, { id: 1, parentId: 1, moduleId: 1, occurrences: 1, textmap: 1 }).lean();
  const { plan, shared } = planOwnEmbeds(occs);
  const mods = new Map((await Module.find({ gridId }, { id: 1, role: 1, kind: 1 }).lean()).map((m) => [m.id, m]));
  const byId = new Map(occs.map((o) => [o.id, o]));
  const kinds = {};
  for (const p of plan) { const m = mods.get(byId.get(p.blockId)?.moduleId); const k = `${m?.role}/${m?.kind || "-"}`; kinds[k] = (kinds[k] || 0) + 1; }
  log(`  ${plan.length} block(s) to own in ${new Set(plan.map((p) => p.holderId)).size} text(s) ${JSON.stringify(kinds)}; ${shared.length} embedded twice (left)`);
  if (dryRun) return;
  const now = new Date();
  for (const { blockId, holderId } of plan) {
    await Occurrence.updateOne({ gridId, id: blockId, parentId: null }, { $set: { parentId: holderId, updatedAt: now } });
    await Occurrence.updateOne({ gridId, id: holderId, occurrences: { $ne: blockId } }, { $push: { occurrences: blockId }, $set: { updatedAt: now } });
  }
  const left = planOwnEmbeds(await Occurrence.find({ gridId }, { id: 1, parentId: 1, occurrences: 1, textmap: 1 }).lean()).plan.length;
  if (left) throw new Error(`${left} block(s) still owned by nothing after the write`);
  log("  read back: 0 left. RESTART pm2.");
}
