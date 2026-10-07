// helpers/chipLifecycle.js
// When a doc stops drawing a mini textblock (inline chip) that it OWNS, the
// chip's row goes too.
//
// A chip is minted with the textblock that holds it as its parent ("Make inline
// textblock", "Split into inline textblocks", the doc toolbar). Removing it —
// its radial "Remove", Backspace, typing over a selection that holds it, a cut —
// only removed the NODE, so the row stayed behind parented to the textblock and
// embedded nowhere (2026-10-07). The rule is the block embeds' own
// (embedRegistry.embedRemoval): a row this doc owns is deleted, a row placed
// from elsewhere is only unlinked. And a chip still drawn by ANY textmap — cut
// here, pasted into another doc — is kept.
import { collectEmbeddedIds } from "./textmapEmbeds";

/** Every inline-chip occurrence id in a textmap. PURE; a compressed/malformed textmap yields none. */
export function inlineChipIds(textmap) {
  const out = new Set();
  if (!textmap || typeof textmap !== "object") return out;
  const walk = (n, depth) => {
    if (!n || typeof n !== "object" || depth > 60) return;
    if (n.type === "instanceTextblockInline" && n.attrs?.occurrenceId) out.add(n.attrs.occurrenceId);
    if (Array.isArray(n.content)) n.content.forEach((c) => walk(c, depth + 1));
  };
  walk(textmap, 0);
  return out;
}

/** Chips `prevTextmap` drew and `nextTextmap` does not, owned by `hostId`, drawn by no other textmap. PURE. */
export function orphanedOwnedChips({ prevTextmap, nextTextmap, hostId, occurrencesById, modulesById }) {
  const before = inlineChipIds(prevTextmap);
  if (!before.size) return [];
  const after = inlineChipIds(nextTextmap);
  const candidates = [...before].filter((id) => {
    if (after.has(id)) return false;
    const o = occurrencesById?.[id];
    if (!o || o.parentId !== hostId) return false;
    return modulesById?.[o.moduleId]?.role === "textblock";
  });
  if (!candidates.length) return [];
  const stillDrawn = new Set();
  for (const o of Object.values(occurrencesById || {})) {
    if (!o?.textmap || o.id === hostId) continue;
    for (const id of collectEmbeddedIds(o.textmap)) if (candidates.includes(id)) stillDrawn.add(id);
  }
  return candidates.filter((id) => !stillDrawn.has(id));
}
