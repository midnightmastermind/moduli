// 0336 — the `embed: missing` block a delete leaves behind.
//
// User, 2026-09-17: *"we still have that embed: missing block on this document"*
// → *"i got the embed: missing when i deleted an occurance btw. that shouldnt
// show up at all"*.
//
// ── WHAT IT IS, MEASURED RATHER THAN INFERRED ──────────────────────────────
//
// The Alan Watts article page (`b93dc523…`) on poms grid carried exactly:
//
//     wrapGroup[ moduleEmbed("e027b531…"), moduleEmbed("") ]
//
// The second embed names the EMPTY STRING. It is not a stale pointer — it is
// ProseMirror's own schema repair. `wrapGroup` content is `moduleEmbed{2,}`
// (client/src/docs/WrapGroupExtension.js), the delete-scrub removed one of the
// two members, and a ONE-child group is a document ProseMirror will not accept.
// On the next load it fills the missing required node with a DEFAULT
// `moduleEmbed`, whose `occurrenceId` default is `""`.
//
// That is why no later scrub could ever clear it: every scrub matches the ids a
// delete just removed, and this node names no id at all.
//
// The write path is fixed in `utils/scrubEmbeds.js` — a group the scrub shrinks
// below two is FLATTENED, so its survivor stays in the document and no filler is
// ever minted. This repairs what is already there.
//
// ── SCOPED TO AN EMPTY ID, NEVER TO "DOES THIS POINTER RESOLVE?" ───────────
//
// CLAUDE.md 2026-08-01 (19) records a dangling-embed scrub that WAS the
// regression: migration 0032 removed an embed pointing at a detached wrapper,
// and that embed turned out to be the only thing rendering a surviving sibling.
// The difference here is that an EMPTY id names nothing by construction — it
// cannot be the only thing rendering anything. A node whose id is a real string
// is left alone whether or not it resolves today.
//
// Then any wrapGroup left below two members is flattened, matching the client's
// own rule (`detachGroupMember`, helpers/wrapGroupOps.js) and the server scrub's.
// The survivor is kept — dropping the group wholesale would delete an embed the
// user never deleted.

import { decompressTextmap, compressTextmap } from "../utils/textmapCompression.js";

export const id = "0336-empty-embed-in-a-short-wrap-group";
export const description =
  "Remove moduleEmbed nodes whose occurrenceId is empty (ProseMirror filler in a short wrapGroup) and flatten any wrap group left with fewer than two members.";
export const touches = ["occurrences"];

const EMBED_TYPES = new Set([
  "moduleEmbed",
  "instanceTextblock",
  "instanceTextblockInline",
  "instancePill",
]);

function embeddedId(node) {
  const a = node?.attrs;
  return a?.occurrenceId ?? a?.instanceId ?? null;
}

/** An embed that names nothing — `""`, whitespace, or a missing attr. */
export function isEmptyEmbed(node) {
  if (!EMBED_TYPES.has(node?.type)) return false;
  const id = embeddedId(node);
  return typeof id !== "string" || id.trim() === "";
}

/**
 * Drop empty-id embeds, then flatten any wrapGroup this pass shrank below two.
 *
 * PURE — which nodes go is the whole risk, so it is testable without a database.
 * Returns null when nothing matched, so the caller skips the write entirely
 * rather than re-persisting an identical document.
 */
export function repairTextmap(textmap) {
  if (!textmap || typeof textmap !== "object") return null;
  let removed = 0;
  let flattened = 0;

  const walk = (node) => {
    if (!node || !Array.isArray(node.content)) return node;
    const kept = [];
    for (const child of node.content) {
      if (isEmptyEmbed(child)) { removed++; continue; }
      const next = walk(child);
      if (next?.type === "wrapGroup"
          && Array.isArray(child.content)
          && next.content.length < child.content.length   // THIS pass shrank it
          && next.content.length < 2) {
        flattened++;
        kept.push(...next.content);                        // 1 survivor inline, 0 = gone
        continue;
      }
      kept.push(next);
    }
    return { ...node, content: kept };
  };

  const next = walk(textmap);
  return removed ? { textmap: next, removed, flattened } : null;
}

export async function up({ gridId, models, log = console.log, dryRun = true }) {
  const { Occurrence, Module } = models;
  const gid = String(gridId);

  const occurrences = await Occurrence.find({ gridId: gid }).lean();
  const mods = new Map((await Module.find({ gridId: gid }).lean()).map((m) => [m.id, m]));
  const nameOf = (o) => o?.label || mods.get(o?.moduleId)?.label || o?.id;

  const plan = [];
  for (const occ of occurrences) {
    if (!occ.textmap) continue;
    // Textmaps are stored COMPRESSED. A raw scan reports "nothing to do" for
    // every row on this grid — the 0032 rule.
    const tm = decompressTextmap(occ.textmap);
    const res = repairTextmap(tm);
    if (res) plan.push({ _id: occ._id, id: occ.id, name: nameOf(occ), ...res });
  }

  // Reported by LABEL so the dry run is checked against a named expectation
  // rather than accepted as a count (the 0035 lesson).
  log(`docs carrying an empty-id embed: ${plan.length}`);
  for (const p of plan) {
    log(`  ${p.name} [${p.id}] - removing ${p.removed} empty embed(s), flattening ${p.flattened} short wrap group(s)`);
  }
  if (dryRun || !plan.length) return { changed: 0, planned: plan.length };

  for (const p of plan) {
    await Occurrence.updateOne({ _id: p._id }, { $set: { textmap: compressTextmap(p.textmap) } });
  }

  // Read the RESULT back out of Mongo, not off the log.
  const after = await Occurrence.find({ gridId: gid }).lean();
  let left = 0;
  let shortGroups = 0;
  for (const occ of after) {
    if (!occ.textmap) continue;
    const tm = decompressTextmap(occ.textmap);
    const seen = (node) => {
      if (!node || typeof node !== "object") return;
      if (isEmptyEmbed(node)) left++;
      if (node.type === "wrapGroup" && Array.isArray(node.content) && node.content.length < 2) shortGroups++;
      (node.content || []).forEach(seen);
    };
    seen(tm);
  }
  if (left) throw new Error(`${left} empty-id embed(s) still present after the write`);
  // A group left short would mint a fresh filler on the next load — the exact
  // state this migration exists to clear.
  if (shortGroups) throw new Error(`${shortGroups} wrap group(s) still hold fewer than two members`);
  log(`removed ${plan.reduce((n, p) => n + p.removed, 0)} empty embed(s); 0 left, 0 short wrap groups`);
  return { changed: plan.length };
}
