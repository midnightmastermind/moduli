// server/utils/cloneSubtree.js
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";

const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

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
 */
export async function cloneSubtree({
  rootOccurrenceId,
  userId,
  gridId,
  uc,
  moduleMetaPatch = {},
  occMetaPatch = {},
  newParentId = null,
}) {
  const created = { occurrenceIds: [], moduleIds: [] };

  async function walk(occId, parentId, isRoot) {
    const src = uc.occurrencesById[occId];
    if (!src) return null;
    const srcMod = uc.modulesById[src.targetId];
    if (!srcMod) return null;

    const cloneModId = newId();
    const cloneOccId = newId();

    const newMod = {
      ...srcMod,
      id: cloneModId,
      meta: { ...(srcMod.meta || {}), ...moduleMetaPatch },
    };
    delete newMod._id;
    uc.modulesById[cloneModId] = newMod;
    await Module.findOneAndUpdate({ id: cloneModId }, newMod, { upsert: true });
    created.moduleIds.push(cloneModId);

    const childIds = [];
    for (const childOccId of src.occurrences || []) {
      const childClone = await walk(childOccId, cloneOccId, false);
      if (childClone) childIds.push(childClone);
    }

    const newOcc = {
      ...src,
      id: cloneOccId,
      targetId: cloneModId,
      parentId,
      occurrences: childIds,
      meta: { ...(src.meta || {}), ...(isRoot ? occMetaPatch : {}) },
    };
    delete newOcc._id;
    delete newOcc.linkedGroupId;
    uc.occurrencesById[cloneOccId] = newOcc;
    await Occurrence.findOneAndUpdate({ id: cloneOccId }, newOcc, { upsert: true });
    created.occurrenceIds.push(cloneOccId);

    return cloneOccId;
  }

  const rootClonedOccurrenceId = await walk(rootOccurrenceId, newParentId, true);
  return { rootClonedOccurrenceId, ...created };
}
