// server/migrations/0035-templates-folder.mjs
//
// Templates become "the children of one protected folder" instead of a separate
// manifest plus three hidden markers. See
// docs/superpowers/specs/2026-08-02-template-editing-design.md
//
// Day Page is a role:"container" and only role:"page" opens in a panel, so it
// gets the page wrapper Schedule Template already has. SAFE: both build ops
// resolve their template picker-direct by id (ktMxTVErceWq / 9EZL5iXnYhul), and
// wrapping does not change those ids.
import { TEMPLATES_FOLDER_NAME } from "../utils/protectedFolders.js";

export const id = "0035-templates-folder";
export const describe =
  "Creates a protected Templates folder under the user manifest root, wraps container-templates in a page, " +
  "and moves every template into it. Deletes no user content; template subtrees are moved, never rebuilt.";

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Manifest, Folder } = models;

  const userMan = await Manifest.findOne({ gridId, manifestType: "user" }).lean();
  if (!userMan?.rootFolderId) { log("no user manifest — nothing to do"); return; }

  // 1. The protected folder (idempotent).
  let folder = await Folder.findOne({
    gridId, parentId: userMan.rootFolderId, name: TEMPLATES_FOLDER_NAME,
  }).lean();
  if (!folder) {
    log(`creating "${TEMPLATES_FOLDER_NAME}" under user root ${userMan.rootFolderId}`);
    if (!dryRun) {
      const doc = {
        id: `tpl-folder-${gridId}`, gridId, userId: userMan.userId,
        name: TEMPLATES_FOLDER_NAME, parentId: userMan.rootFolderId,
        folderType: "normal", sortOrder: 0, meta: { protected: true },
      };
      await Folder.findOneAndUpdate({ id: doc.id }, doc, { upsert: true });
      folder = doc;
    } else {
      folder = { id: `tpl-folder-${gridId}` };
    }
  } else {
    log(`"${TEMPLATES_FOLDER_NAME}" already exists (${folder.id})`);
    if (!folder.meta?.protected && !dryRun) {
      await Folder.updateOne({ id: folder.id }, { $set: { "meta.protected": true } });
      log("  stamped meta.protected");
    }
  }

  // 2. Everything currently marked as a template, wherever it lives.
  const occs = await Occurrence.find({ gridId }).select("-textmap").lean();
  const mods = await Module.find({ gridId }).lean();
  const modById = Object.fromEntries(mods.map(m => [m.id, m]));
  const templates = occs.filter(o =>
    o.meta?.templateName || modById[o.moduleId]?.meta?.templateModule);
  log(`${templates.length} template(s) found`);

  for (const t of templates) {
    const mod = modById[t.moduleId];
    const label = t.meta?.templateName || mod?.label || "(unnamed)";
    // Only ROOTS move — a signed child inside a template subtree is not itself
    // a template, and re-parenting it would tear the subtree apart.
    const isRoot = !occs.some(o => (o.occurrences || []).includes(t.id));
    if (!isRoot) { log(`  skip "${label}" — nested inside another template`); continue; }

    if (mod?.role === "page") {
      log(`  "${label}" is already a page → move to ${folder.id}`);
      if (!dryRun) await Occurrence.updateOne({ gridId, id: t.id }, { $set: { parentId: folder.id } });
    } else {
      log(`  "${label}" is a ${mod?.role} → wrap in a page, then move`);
      if (!dryRun) {
        const wrapModId = `tplwrap-mod-${t.id}`;
        const wrapOccId = `tplwrap-occ-${t.id}`;
        await Module.findOneAndUpdate({ id: wrapModId }, {
          id: wrapModId, gridId, userId: t.userId, label,
          role: "page", kind: mod?.kind || "doc", fieldBindings: [], meta: {},
        }, { upsert: true });
        await Occurrence.findOneAndUpdate({ id: wrapOccId }, {
          id: wrapOccId, gridId, userId: t.userId, moduleId: wrapModId,
          parentId: folder.id, occurrences: [t.id], fields: {}, meta: {},
        }, { upsert: true });
        // The container keeps its id — that is what the build ops resolve.
        await Occurrence.updateOne({ gridId, id: t.id }, { $set: { parentId: wrapOccId } });
      }
    }

    // 3. Markers are no longer how a template is identified.
    if (!dryRun) {
      await Occurrence.updateOne({ gridId, id: t.id }, { $unset: { "meta.templateName": "" } });
      if (mod) await Module.updateOne({ gridId, id: mod.id }, { $unset: { "meta.templateModule": "" } });
    }
  }

  log(dryRun ? "(dry run — no writes)" : "done");
}
