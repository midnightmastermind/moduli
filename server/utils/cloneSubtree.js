// server/utils/cloneSubtree.js
import { pickReusableModuleId, stampCloneOrigin } from "./cloneModuleReuse.js";
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
 * Rewrite a cloned node's embedded child references to point at the CLONES.
 *
 * A doc page renders its children through `moduleEmbed` / `instanceTextblock` /
 * `instancePill` nodes in its OWN textmap, keyed by the child's `occurrenceId`
 * (and `instanceId` = the child's module id). `walk` below regenerates
 * `occurrences[]` with fresh ids but carried the textmap over verbatim — so a
 * cloned page kept pointing at the TEMPLATE's children and rendered the
 * template's content, or nothing at all.
 *
 * THIS IS THE TWIN OF `remapEmbeddedRefs` in the client's APPLY_TEMPLATE
 * (`client/src/helpers/operationActions.js`), which has done this since it was
 * written. The two clone paths had drifted: everything that clones through the
 * SERVER — `apply_template`, `clone_subtree_as_template`, `save_over_template`,
 * the v1 API route and any migration — produced pages whose embeds named the
 * source's children. Found by rendering a freshly cloned project page and
 * getting nothing (2026-08-28 (5)).
 *
 * Depth-first order is what makes it work: children are cloned before their
 * parent's textmap is built, so both maps are complete by the time a parent
 * needs them. Mutates a COPY — never the source textmap, which is shared.
 */
export function remapEmbeddedRefs(textmap, occRemap, modRemap) {
  if (textmap == null || (occRemap.size === 0 && modRemap.size === 0)) return textmap;
  const out = JSON.parse(JSON.stringify(textmap));
  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== "object") return;
    const a = node.attrs;
    if (a && typeof a === "object") {
      if (a.occurrenceId && occRemap.has(a.occurrenceId)) a.occurrenceId = occRemap.get(a.occurrenceId);
      if (a.instanceId && modRemap.has(a.instanceId)) a.instanceId = modRemap.get(a.instanceId);
    }
    if (Array.isArray(node.content)) node.content.forEach(walk);
  };
  walk(out);
  return out;
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
  // Filled as each node is cloned; read when a parent's textmap is rebuilt.
  const occRemap = new Map();   // source occurrence id → clone id
  const modRemap = new Map();   // source module id     → clone id

  async function walk(occId, parentId, isRoot) {
    const src = uc.occurrencesById[occId];
    if (!src) return null;
    // `moduleId` is the schema field. This used to read `src.targetId`, which
    // the 2026-07-29 rename removed from the schema — so every clone bailed
    // here and apply/save-template silently failed for months. The old test
    // fixtures set BOTH keys, which is exactly why it was never caught.
    const srcMod = uc.modulesById[src.moduleId];
    if (!srcMod) return null;

    // ── ONE MODULE, MANY OCCURRENCES — the same rule the client clone uses ──
    // This minted a fresh module for every clone, so applying a template twice
    // produced two identical modules. The client's APPLY_TEMPLATE was fixed
    // first (it is the high-traffic path — `Day Page: Build` runs every
    // morning); this is its twin, and it imports the SAME decision rather than
    // restating it, because two copies of a rule are how they drift.
    //
    // The first apply still mints: the source is a template and pointing a clone
    // at it would place the template itself. It stamps `clonedFromModuleId`, and
    // every later apply of that node reuses it.
    const reusedModId = pickReusableModuleId({
      modulesById: uc.modulesById, srcModId: src.moduleId, srcMod,
      isRoot, rootLabelOverride: (isRoot && rootLabel) ? rootLabel : null,
    });
    const cloneModId = reusedModId || newId();
    const cloneOccId = newId();

    const newMod = {
      ...srcMod,
      id: cloneModId,
      meta: stampCloneOrigin({ ...(srcMod.meta || {}), ...moduleMetaPatch }, src.moduleId),
    };
    if (isRoot && rootLabel) newMod.label = rootLabel;
    delete newMod._id;
    uc.modulesById[cloneModId] = newMod;
    modRemap.set(src.moduleId, cloneModId);
    await persist.saveModule(newMod);
    created.moduleIds.push(cloneModId);

    const childIds = [];
    for (const childOccId of src.occurrences || []) {
      const childClone = await walk(childOccId, cloneOccId, false);
      if (childClone) childIds.push(childClone);
    }

    occRemap.set(src.id, cloneOccId);
    const newOcc = {
      ...src,
      id: cloneOccId,
      moduleId: cloneModId,
      parentId,
      occurrences: childIds,
      // Point the clone's embeds at the CLONES. Children are already walked at
      // this point, so both maps are complete. Without this a cloned doc page
      // renders the SOURCE's children, or an `embed: <uuid>` box.
      textmap: remapEmbeddedRefs(src.textmap, occRemap, modRemap),
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
