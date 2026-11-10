// An inline chip belongs to the occurrence whose TEXT embeds it (an `instanceTextblockInline` node):
// parented to it and listed by it. Then deleting the text cascades into the chip, and the client's
// chip lifecycle (helpers/chipLifecycle) can delete a chip its text stops drawing. "Make inline
// textblock" has always done this; the importer minted chips listed by nothing (2026-10-09:
// 1,861 on poms, 1,573 on the rebuild). One rule for the importer and the migration that repairs.

/** Chip occurrence ids an (uncompressed) textmap embeds, in document order, once each. */
export function embeddedChipIds(textmap) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "instanceTextblockInline" && n.attrs?.occurrenceId && !out.includes(n.attrs.occurrenceId)) out.push(n.attrs.occurrenceId);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(textmap);
  return out;
}

/** MUTATES `occurrences` (uncompressed textmaps): each embedded chip that exists is listed by its
 *  text and, when it has no parent, parented to it. A chip already parented elsewhere keeps that
 *  parent. Returns the ids of every occurrence it changed (texts and chips). */
export function ownInlineChips(occurrences) {
  const byId = new Map(occurrences.map((o) => [o.id, o]));
  const changed = new Set();
  for (const holder of occurrences) {
    if (!holder?.textmap || typeof holder.textmap !== "object") continue;
    for (const chipId of embeddedChipIds(holder.textmap)) {
      const chip = byId.get(chipId);
      if (!chip || chip === holder) continue;
      const list = Array.isArray(holder.occurrences) ? holder.occurrences : [];
      if (!list.includes(chipId)) { holder.occurrences = [...list, chipId]; changed.add(holder.id); }
      if (chip.parentId == null) { chip.parentId = holder.id; changed.add(chip.id); }
    }
  }
  return [...changed];
}


/** Occurrence ids a textmap embeds as BLOCKS (`moduleEmbed`: a quote, a picture inside a paragraph). */
export function embeddedBlockIds(textmap) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "moduleEmbed" && n.attrs?.occurrenceId && !out.includes(n.attrs.occurrenceId)) out.push(n.attrs.occurrenceId);
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  walk(textmap);
  return out;
}

/** MUTATES: a block an import minted and embedded in a text — and that NOTHING lists or parents — is listed
 *  by that text and parented to it, so deleting the page reaches it (2026-11-10: deleting an imported page
 *  left its quotes behind, embedded in a textblock and owned by nothing). Only occurrences in this list are
 *  touched, so an existing row the import merely places (an OCR'd photo) keeps its own home. */
export function ownEmbeddedBlocks(occurrences) {
  const byId = new Map(occurrences.map((o) => [o.id, o]));
  const listed = new Set(occurrences.flatMap((o) => o.occurrences || []));
  const changed = new Set();
  for (const holder of occurrences) {
    if (!holder?.textmap || typeof holder.textmap !== "object") continue;
    for (const id of embeddedBlockIds(holder.textmap)) {
      const block = byId.get(id);
      if (!block || block === holder || block.parentId != null || listed.has(id)) continue;
      holder.occurrences = [...(Array.isArray(holder.occurrences) ? holder.occurrences : []), id];
      block.parentId = holder.id;
      listed.add(id);
      changed.add(holder.id); changed.add(id);
    }
  }
  return [...changed];
}
