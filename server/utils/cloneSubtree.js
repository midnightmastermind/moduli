// server/utils/cloneSubtree.js
import { randomUUID } from "node:crypto";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";

// Match client-side id minting (operationActions.js APPLY_TEMPLATE) so the
// two clone paths produce comparably collision-resistant IDs. The old
// `${Date.now()}-${Math.random()...}` form had real (small) collision risk
// under burst load when many subtrees clone in the same millisecond.
const newId = () => randomUUID();

// The real persistence layer. Injectable so the traversal can be tested without
// a live Mongo — the DB-gated tests this file used to rely on skipped silently
// whenever no database was reachable, which is how the targetId/moduleId break
// below survived unnoticed.
const mongoPersist = {
  saveModule: (mod) => Module.findOneAndUpdate({ id: mod.id }, mod, { upsert: true }),
  saveOccurrence: (occ) => Occurrence.findOneAndUpdate({ id: occ.id }, occ, { upsert: true }),
};

/**
 * The signature a node is matched by in merge mode.
 *
 * Falls back to `auto:<sourceOccurrenceId>` so a node nobody hand-signed still
 * matches itself on the next merge. Without the fallback "no signature" means
 * "clone fresh EVERY merge" — the bug that produced 23 duplicate Daily Question
 * wrappers in one day (2026-07-31). Mirrors the pipeline action's rule in
 * client/src/helpers/operationActions.js.
 */
export function signatureOf(occ) {
  return occ?.identitySignature || (occ?.id ? `auto:${occ.id}` : null);
}

/**
 * Clone a subtree rooted at `rootOccurrenceId`. For each node:
 *   - mint new module (carries over module fields; optional metaPatch)
 *   - mint new occurrence (regenerated id, new module id, regenerated occurrences[])
 *
 * Returns { rootClonedOccurrenceId, occurrenceIds: [...], moduleIds: [...] }.
 *
 * Options:
 *   moduleMetaPatch:  shallow object merged into each cloned module.meta
 *   occMetaPatch:     shallow object merged into the ROOT clone's occurrence.meta only
 *   newParentId:      parentId for the cloned root occurrence
 *   rootLabel:        overrides the ROOT clone's module label (naming a template)
 *   stampSignatures:  stamp each clone's identitySignature so a later merge matches it
 *   persist:          { saveModule, saveOccurrence } — injectable for tests
 */
export async function cloneSubtree({
  rootOccurrenceId,
  userId,
  gridId,
  uc,
  moduleMetaPatch = {},
  occMetaPatch = {},
  newParentId = null,
  rootLabel = null,
  stampSignatures = false,
  persist = mongoPersist,
}) {
  const created = { occurrenceIds: [], moduleIds: [] };

  async function walk(occId, parentId, isRoot) {
    const src = uc.occurrencesById[occId];
    if (!src) return null;
    // `moduleId` is the schema field. This used to read `src.targetId`, which
    // the 2026-07-29 rename removed from the schema — so every clone bailed
    // here and apply/save-template silently failed for months. The old test
    // fixtures set BOTH keys, which is exactly why it was never caught.
    const srcMod = uc.modulesById[src.moduleId];
    if (!srcMod) return null;

    const cloneModId = newId();
    const cloneOccId = newId();

    const newMod = {
      ...srcMod,
      id: cloneModId,
      meta: { ...(srcMod.meta || {}), ...moduleMetaPatch },
    };
    if (isRoot && rootLabel) newMod.label = rootLabel;
    delete newMod._id;
    uc.modulesById[cloneModId] = newMod;
    await persist.saveModule(newMod);
    created.moduleIds.push(cloneModId);

    const childIds = [];
    for (const childOccId of src.occurrences || []) {
      const childClone = await walk(childOccId, cloneOccId, false);
      if (childClone) childIds.push(childClone);
    }

    const newOcc = {
      ...src,
      id: cloneOccId,
      moduleId: cloneModId,
      parentId,
      occurrences: childIds,
      meta: { ...(src.meta || {}), ...(isRoot ? occMetaPatch : {}) },
    };
    if (stampSignatures) newOcc.identitySignature = signatureOf(src);
    delete newOcc._id;
    delete newOcc.linkedGroupId;
    uc.occurrencesById[cloneOccId] = newOcc;
    await persist.saveOccurrence(newOcc);
    created.occurrenceIds.push(cloneOccId);

    return cloneOccId;
  }

  const rootClonedOccurrenceId = await walk(rootOccurrenceId, newParentId, true);
  return { rootClonedOccurrenceId, ...created };
}

/**
 * Apply a template's CONTENTS (not its wrapper) into a target, matching existing
 * children by identitySignature.
 *
 * Structure flows from the template while everything the user wrote is left
 * alone: a template node whose signature already exists under the target is NOT
 * re-cloned — we recurse into the match instead — so re-applying tops a page up
 * rather than duplicating it. Merge is additive by design: removing a section
 * from a template never removes it from a page already built from it.
 *
 * The root is unwrapped because a template's wrapper page is just where the
 * template lives; what you are applying is what's inside it. That matches the
 * two build ops, which pass `unwrapRoot: true`.
 *
 * Returns { occurrenceIds, moduleIds, updatedParentIds }.
 */
export async function mergeSubtreeInto({
  templateOccurrenceId,
  targetOccurrenceId,
  userId,
  gridId,
  uc,
  occMetaPatch = {},
  persist = mongoPersist,
}) {
  const created = { occurrenceIds: [], moduleIds: [] };
  const updatedParentIds = new Set();

  const template = uc.occurrencesById[templateOccurrenceId];
  const target = uc.occurrencesById[targetOccurrenceId];
  if (!template || !target) return { ...created, updatedParentIds: [] };

  async function mergeChildrenInto(srcOcc, destOcc) {
    for (const childId of srcOcc.occurrences || []) {
      const child = uc.occurrencesById[childId];
      if (!child) continue;

      const sig = signatureOf(child);
      const matched = (destOcc.occurrences || [])
        .map(id => uc.occurrencesById[id])
        .find(o => o && signatureOf(o) === sig);

      if (matched) {
        // Already present — recurse so sections the template has GAINED still
        // arrive, without touching what is already there.
        await mergeChildrenInto(child, matched);
        continue;
      }

      const r = await cloneSubtree({
        rootOccurrenceId: childId,
        userId,
        gridId,
        uc,
        newParentId: destOcc.id,
        occMetaPatch,
        stampSignatures: true,
        persist,
      });
      if (!r.rootClonedOccurrenceId) continue;
      created.occurrenceIds.push(...r.occurrenceIds);
      created.moduleIds.push(...r.moduleIds);

      destOcc.occurrences = [...(destOcc.occurrences || []), r.rootClonedOccurrenceId];
      uc.occurrencesById[destOcc.id] = destOcc;
      await persist.saveOccurrence(destOcc);
      updatedParentIds.add(destOcc.id);
    }
  }

  await mergeChildrenInto(template, target);
  return { ...created, updatedParentIds: [...updatedParentIds] };
}
