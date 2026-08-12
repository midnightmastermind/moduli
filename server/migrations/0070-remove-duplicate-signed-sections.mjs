// server/migrations/0070-remove-duplicate-signed-sections.mjs
//
// The data half of the merge-duplication defect. `b38cbf3d` stopped the bleeding
// — merge now matches a signed child the parent no longer lists, so no new
// duplicates appear. This removes the ones already there.
//
// ── WHAT IS THERE, MEASURED AT FULL DEPTH ───────────────────────────────────
//
//   Monday, August 10th   Journal          x3   1 UNLISTED + 2 listed
//                         Notes            x3   1 UNLISTED + 2 listed
//                         Tasks Completed  x3   1 UNLISTED + 2 listed
//                         Highlights       x3   1 UNLISTED + 2 listed
//   Thursday, July 30th   Daily Question   x2   1 UNLISTED + 1 listed
//   Saturday, August 1st  Daily Question   x2   1 UNLISTED + 1 listed
//
//   6 groups · 10 removable copies · **every copy 0 characters of text**
//
// The two Daily Question pairs are the ones `0066` names: a multi-match FIND
// binds an ARRAY, which has no `.id`, which is the "$dq has no id to update"
// the user reported. That guard stays — this removes the cause underneath it.
//
// ── THE WRITING GUARD, AND WHY IT IS TEXT-ONLY ──────────────────────────────
//
// `0022`/`0023`: the keeper is whichever copy HOLDS WRITING, and anything
// containing text is never deleted — a duplicate section is a nuisance, a
// deleted journal entry is not.
//
// It counts TEXT, never field values. `0038` scored field values and fired on
// `0037`'s own date stamp — the app's footprint read as the user's writing, so
// it refused to delete anything. Its header records that mistake, and it then
// made the identical one a SECOND time. Text is measured through
// `decompressTextmap` because a raw read stores textmap COMPRESSED, and a naive
// scan reports "no text" for everything — which would delete real journal
// entries (2026-08-01 (18)).
//
// If MORE THAN ONE copy in a group holds writing, the whole group is KEPT and
// logged. Merging two written-in sections is a human call.
//
// ── THE MULTI-PARENT GUARD, which is the one that could destroy data ────────
//
// Deleting a duplicate takes its subtree — but this grid multi-parents
// deliberately (the Todo container, the shared Emotions Wheel). A descendant
// listed or parented OUTSIDE the subtree being removed is SOMEONE ELSE'S and is
// unlinked rather than deleted. `0035` moved a real page by matching things that
// merely looked right; here the equivalent mistake would delete a shared node.

export const id = "0070-remove-duplicate-signed-sections";
export const describe =
  "Remove duplicate signed sections left by the merge defect — only copies that are provably EMPTY, "
  + "keeping any that hold writing, and never touching a multi-parented descendant.";

/** Every text character in a TipTap doc, recursively. */
export function textCharsOf(doc) {
  if (!doc || typeof doc !== "object") return 0;
  let out = "";
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (typeof n.text === "string") out += n.text;
    for (const c of (n.content || [])) walk(c);
  };
  walk(doc);
  return out.trim().length;
}

/**
 * Which copy survives?
 *
 * - exactly one holds writing  → that one, whatever its listing state
 * - more than one holds writing → null, meaning REFUSE the group
 * - none hold writing          → the first LISTED copy (it is the one already
 *                                rendering, so render order does not shift),
 *                                else the first
 *
 * Exported so the test drives the REAL chooser.
 */
export function chooseKeeper(copies) {
  const written = copies.filter((c) => c.chars > 0);
  if (written.length > 1) return null;
  if (written.length === 1) return written[0];
  return copies.find((c) => c.listed) || copies[0] || null;
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module } = models;
  const { decompressTextmap } = await import("../utils/textmapCompression.js");

  const [occs, mods] = await Promise.all([
    Occurrence.find({ gridId }).lean(),
    Module.find({ gridId }).lean(),
  ]);
  const occById = new Map(occs.map((o) => [o.id, o]));
  const modById = new Map(mods.map((m) => [m.id, m]));
  const labelOf = (o) => o?.label ?? modById.get(o?.moduleId)?.label ?? "(unlabelled)";

  const listers = new Map();               // childId -> [parentId]
  for (const o of occs) {
    for (const c of (o.occurrences || [])) {
      if (!listers.has(c)) listers.set(c, []);
      listers.get(c).push(o.id);
    }
  }

  const subtreeOf = (rootId) => {
    const out = new Set(); const stack = [rootId];
    while (stack.length) {
      const id = stack.pop();
      if (out.has(id)) continue;
      out.add(id);
      for (const k of (occById.get(id)?.occurrences || [])) stack.push(k);
    }
    return out;
  };
  const charsOfSubtree = (rootId) => {
    let total = 0;
    for (const id of subtreeOf(rootId)) total += textCharsOf(decompressTextmap(occById.get(id)?.textmap));
    return total;
  };

  // Group by (parent, signature) — the same key merge matches on.
  const groups = new Map();
  for (const o of occs) {
    if (!o.identitySignature || !o.parentId) continue;
    const k = `${o.parentId}::${o.identitySignature}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(o);
  }

  const toDelete = new Set();
  const toUnlink = new Set();
  let refused = 0, groupCount = 0;

  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    groupCount += 1;
    const [pid, sig] = key.split("::");
    const parent = occById.get(pid);
    const listed = new Set(parent?.occurrences || []);
    const copies = list.map((o) => ({ occ: o, chars: charsOfSubtree(o.id), listed: listed.has(o.id) }));

    log(`  · "${labelOf(parent)}" — ${sig} (${copies.length} copies)`);
    for (const c of copies) {
      log(`      ${c.occ.id.slice(0, 8)} ${c.listed ? "[listed]  " : "[UNLISTED]"} ${c.chars} chars${c.chars > 0 ? "  HOLDS WRITING" : ""}`);
    }

    const keeper = chooseKeeper(copies);
    if (!keeper) {
      refused += 1;
      log("      -> KEPT ALL: more than one copy holds writing. Merging them is a human call.");
      continue;
    }
    log(`      -> keeping ${keeper.occ.id.slice(0, 8)}${keeper.chars > 0 ? " (it holds the writing)" : keeper.listed ? " (already rendering)" : ""}`);

    const keptTree = subtreeOf(keeper.occ.id);
    for (const c of copies) {
      if (c.occ.id === keeper.occ.id) continue;
      const doomed = subtreeOf(c.occ.id);
      for (const id of doomed) {
        // THE GUARD THAT MATTERS. A node listed or parented outside the subtree
        // being removed belongs to something else — this grid multi-parents on
        // purpose. Unlink it from the doomed parent; never delete it.
        //
        // THE COPY'S OWN LINK TO THE GROUP PARENT IS NOT SHARING, and the first
        // draft got this wrong: a duplicate is of course listed by the parent
        // whose duplicates we are removing, and that parent is not inside the
        // doomed subtree — so all four second-listed copies read as "shared" and
        // the dry run proposed unlinking the very things it was meant to delete.
        // Caught only because the report was checked against a named
        // expectation instead of a count.
        const isCopyRoot = id === c.occ.id;
        const outsideListers = (listers.get(id) || [])
          .filter((p) => !doomed.has(p) && !(isCopyRoot && p === pid));
        const ownParent = occById.get(id)?.parentId;
        const outsideParent = ownParent && !doomed.has(ownParent) && !(isCopyRoot && ownParent === pid);
        if (keptTree.has(id) || outsideListers.length || outsideParent) {
          toUnlink.add(id);
          log(`      ~ ${id.slice(0, 8)} "${labelOf(occById.get(id))}" is SHARED — unlinked, not deleted`);
          continue;
        }
        toDelete.add(id);
      }
    }
  }

  log(`\n  · ${groupCount} duplicate group(s); ${refused} refused for holding writing`);
  log(`  · ${toDelete.size} occurrence(s) to delete, ${toUnlink.size} shared node(s) to unlink only`);
  if (!toDelete.size && !toUnlink.size) { log("  · nothing to remove"); return; }
  if (dryRun) return;

  for (const id of [...toDelete, ...toUnlink]) {
    // Unlist from every parent first, so no parent is ever left naming a row
    // that no longer exists (the documented dangling-child-ref class).
    await Occurrence.updateMany({ gridId, occurrences: id }, { $pull: { occurrences: id } });
  }
  for (const id of toDelete) await Occurrence.deleteOne({ gridId, id });

  // Modules the deletion orphaned. A clone gets its own module, so leaving them
  // behind grows an unused-module warning on every integrity run.
  const survivingModuleIds = new Set(
    occs.filter((o) => !toDelete.has(o.id)).map((o) => o.moduleId).filter(Boolean),
  );
  let modsDropped = 0;
  for (const id of toDelete) {
    const mid = occById.get(id)?.moduleId;
    if (mid && !survivingModuleIds.has(mid)) {
      await Module.deleteOne({ gridId, id: mid });
      modsDropped += 1;
    }
  }
  log(`  ✓ deleted ${toDelete.size} occurrence(s) and ${modsDropped} orphaned module(s)`);
}
