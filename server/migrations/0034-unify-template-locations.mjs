// User 2026-08-02: asked where to change the Schedule and Day Page templates,
// then — on being told they live in two different places — "i should change the
// templates at the same place right".
//
// They should, and today they cannot. There are TWO folders both literally
// named "Templates", in two different manifests:
//
//   "Templates"  mAif5lIvNpXI  folderType: normal     under Library (USER manifest)
//                              → holds `Schedule Template`
//   "Templates"  PLySXSQBJrGx  folderType: templates  ROOT of the TEMPLATES manifest
//                              → holds `Day Page`
//
// So "open Templates" means different things depending on which one you meant,
// and only the second one is what Command Center → Templates reads. The
// templates manifest is the purpose-built home — `clone_subtree_as_template`
// writes there, and `helpers/templateHelpers.templatesByKind` walks it. The
// Schedule Template being a plain page under Library is the odd one out.
//
// This moves `Schedule Template` into the templates manifest so BOTH templates
// are editable from the same place.
//
// WHY THIS IS SAFE FOR THE BUILD — checked before writing, because getting it
// wrong breaks the Schedule the next morning. `Schedule: Build Schedule`
// resolves the template PICKER-DIRECT:
//
//     INIT_VAR $dayCont = $allItemsById.9EZL5iXnYhul     ← the "Day" container
//
// It never references the `Schedule Template` page's id, its label, or its
// folder — it reaches straight past it to the Day container by occurrence id.
// Re-parenting the page therefore cannot affect what gets built. Verified: the
// pipeline JSON contains no occurrence id for the page, no "Schedule Template"
// string, and no "day-container" string.
//
// THREE things are needed, not just the move — `templatesByKind` filters on
// `o.meta.templateName` AND parentage inside the templates manifest, and the
// Schedule Template carries NEITHER marker today:
//   1. parentId          → the templates manifest root
//   2. meta.templateName → "Schedule Template"  (what the list renders)
//   3. module.meta.templateModule → true        (the marker apply_template
//                                                strips from clones, so a
//                                                template is distinguishable
//                                                from what it mints — the
//                                                2026-07-31 (2) lesson)
//
// SAFETY: no content is created, deleted, or reordered. The template subtree
// itself is untouched — only the page occurrence's parentId and two meta
// markers change. Panel pinning lives in `panel.occurrences[]`, not parentId,
// so anything that had this page open keeps it open. Fully idempotent: each of
// the three edits is checked before writing, and the whole migration no-ops on
// a second run. Reversible by setting parentId back to mAif5lIvNpXI.

export const id = "0034-unify-template-locations";
export const describe =
  "Moves the `Schedule Template` page into the templates manifest (beside `Day Page`) and marks it as a " +
  "template, so both are editable from Command Center → Templates. Deletes nothing; the template subtree " +
  "is untouched and the Schedule build resolves its Day container by id, not by location.";

const TEMPLATE_PAGE_LABEL = "Schedule Template";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Manifest, Folder } = models;

  // The templates manifest's root folder is the destination.
  const tplManifest = await Manifest.findOne({ gridId, manifestType: "templates" }).lean();
  if (!tplManifest?.rootFolderId) {
    log("no templates manifest on this grid — nothing to unify");
    return;
  }
  const tplRoot = await Folder.findOne({ gridId, id: tplManifest.rootFolderId }).lean();
  if (!tplRoot) {
    log(`templates manifest ${tplManifest.id} has no root folder ${tplManifest.rootFolderId} — refusing to move`);
    return;
  }

  // Resolve the page by LABEL on its module (the occurrence carries no label of
  // its own). Deliberately not by a baked id: this has to work on any grid the
  // runner is pointed at.
  const mods = await Module.find({ gridId, label: TEMPLATE_PAGE_LABEL, role: "page" }).lean();
  if (!mods.length) {
    log(`no "${TEMPLATE_PAGE_LABEL}" page module on this grid — nothing to do`);
    return;
  }
  if (mods.length > 1) {
    log(`AMBIGUOUS: ${mods.length} page modules labelled "${TEMPLATE_PAGE_LABEL}" — refusing to guess`);
    return;
  }
  const mod = mods[0];

  const occs = await Occurrence.find({ gridId, moduleId: mod.id }).lean();
  if (occs.length !== 1) {
    log(`expected exactly 1 occurrence of "${TEMPLATE_PAGE_LABEL}", found ${occs.length} — refusing to guess`);
    return;
  }
  const occ = occs[0];

  const needsMove = occ.parentId !== tplRoot.id;
  const needsName = occ.meta?.templateName !== TEMPLATE_PAGE_LABEL;
  const needsFlag = mod.meta?.templateModule !== true;

  log(`"${TEMPLATE_PAGE_LABEL}" occ=${occ.id} module=${mod.id}`);
  log(`  parentId ${occ.parentId} -> ${tplRoot.id}    ${needsMove ? "MOVE" : "already there"}`);
  log(`  meta.templateName                            ${needsName ? `set to "${TEMPLATE_PAGE_LABEL}"` : "already set"}`);
  log(`  module.meta.templateModule                   ${needsFlag ? "set to true" : "already true"}`);
  log(`  children (template subtree): ${(occ.occurrences || []).length} — UNTOUCHED`);

  if (!needsMove && !needsName && !needsFlag) {
    log("nothing to change — already unified");
    return;
  }
  if (dryRun) {
    log("(dry run — no writes)");
    return;
  }

  if (needsMove || needsName) {
    await Occurrence.updateOne(
      { gridId, id: occ.id },
      { $set: { parentId: tplRoot.id, "meta.templateName": TEMPLATE_PAGE_LABEL } },
    );
  }
  if (needsFlag) {
    await Module.updateOne({ gridId, id: mod.id }, { $set: { "meta.templateModule": true } });
  }
  log("done — both templates now live in the templates manifest");
}
