// server/utils/scrubEmbeds.js
//
// A DOC RENDERS ITS TEXTMAP, so a node embedding an occurrence that no longer
// exists paints as raw junk — `embed: <uuid>` in the middle of the prose.
// Observed on claude-grid 2026-08-19 after deleting, through the UI, a container
// that had been added to a doc page: the delete removed the occurrence and its
// entry in `occurrences[]`, and left the embed node behind.
//
// ── WHY THIS IS SAFE, WHEN A DANGLING-EMBED SCRUB ONCE WAS NOT ──────────────
// CLAUDE.md 2026-08-01 (19) records a scrub that WAS the regression: migration
// 0032 removed an embed pointing at a detached wrapper, and that embed turned
// out to be the only thing rendering a surviving sibling — the Daily Question
// vanished from two day columns.
//
// The difference is the input. That scrub asked "does this pointer resolve?"
// across a whole grid, where the answer can be no for a node that still needs to
// render something. This one is handed the EXACT ids a delete just removed, in
// the same handler, so the occurrence is provably gone and the node can only
// paint as junk. It never scans, never guesses, and never touches a node whose
// target still exists.

// Node types that carry a pointer to an occurrence — READ OFF THE EXTENSIONS'
// own `name:` fields (client/src/docs/*Extension.js), not from memory.
// `instanceTextblockInline` (the inline link chip) was missing, so deleting a
// chip's occurrence left the same `embed: missing` junk this file exists to
// prevent — a Set lookup is exact, and the plural name never matched.
const EMBED_TYPES = new Set([
  "moduleEmbed",
  "instanceTextblock",
  "instanceTextblockInline",
  "instancePill",
]);

function embeddedId(node) {
  const a = node?.attrs;
  return a?.occurrenceId || a?.instanceId || null;
}

/**
 * Remove every embed node pointing at one of `deletedIds`.
 *
 * PURE — the whole risk is which nodes go, so it is testable without a
 * database. Returns `null` when nothing matched, so a caller can skip the write
 * entirely rather than re-persisting an identical document.
 */
export function scrubDeletedEmbeds(textmap, deletedIds) {
  if (!textmap || typeof textmap !== "object" || !deletedIds?.size) return null;
  let removed = 0;

  // A WRAP GROUP THE SCRUB SHRINKS BELOW TWO IS FLATTENED, NOT LEFT SHORT.
  //
  // The group is a layout wrapper whose content is `moduleEmbed{2,}`
  // (client/src/docs/WrapGroupExtension.js). Emptied, it renders as a bare box
  // with nothing in it. Left with ONE member it is worse than that: the
  // document is invalid, so ProseMirror's schema repair FILLS the missing
  // required node with a default `moduleEmbed` — whose `occurrenceId` default
  // is `""` — and that paints `embed: missing` forever while naming no id any
  // later scrub could match. Measured on poms grid 2026-09-17: deleting one
  // member of the Watts article's wrap group left exactly
  // `wrapGroup[ moduleEmbed(e027b531…), moduleEmbed("") ]`.
  //
  // So the survivors are spliced into the parent in the group's place. The
  // client has had this rule since the wrap work — `detachGroupMember`
  // (helpers/wrapGroupOps.js): "A group needs >=2 children ... when fewer
  // remain it flattens to plain sibling embeds." This is its server twin.
  // DROPPING the group wholesale would delete an embed the user never deleted.
  //
  // It still only ever reshapes a group THIS PASS changed — a group that was
  // already short is not this scrub's business, so nothing else can be swept.
  const walk = (node) => {
    if (!node || !Array.isArray(node.content)) return node;
    const kept = [];
    for (const child of node.content) {
      if (EMBED_TYPES.has(child?.type) && deletedIds.has(embeddedId(child))) { removed++; continue; }
      const next = walk(child);
      if (next?.type === "wrapGroup"
          && Array.isArray(child.content)
          && next.content.length < child.content.length   // THIS pass shrank it
          && next.content.length < 2) {
        kept.push(...next.content);                        // 1 survivor inline, 0 = gone
        continue;
      }
      kept.push(next);
    }
    return { ...node, content: kept };
  };

  const next = walk(textmap);
  return removed ? { textmap: next, removed } : null;
}

/**
 * Which occurrences in `occurrencesById` embed any of `deletedIds`.
 *
 * Separate from the scrub so the caller can skip the work entirely when nothing
 * embeds them — which is the common case, since most deletes are board rows.
 */
export function occurrencesEmbedding(occurrencesById, deletedIds) {
  const out = [];
  if (!deletedIds?.size) return out;
  for (const occ of Object.values(occurrencesById || {})) {
    if (!occ?.textmap) continue;
    const res = scrubDeletedEmbeds(occ.textmap, deletedIds);
    if (res) out.push({ occ, ...res });
  }
  return out;
}
