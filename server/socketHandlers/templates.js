// socketHandlers/templates.js — clone_subtree_as_template + apply_template + save_over_template
//
// Templates are the children of the one protected "Templates" folder — location
// is the only marker. There is no templates manifest and no
// meta.templateName / module.meta.templateModule; a template's NAME is its
// module label, like any other page. See
// docs/superpowers/specs/2026-08-02-template-editing-design.md
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import { cloneSubtree, mergeSubtreeInto } from "../utils/cloneSubtree.js";
import { resolveTemplatesFolderId } from "../utils/templatesFolder.js";
import { awaitPendingOccCreate } from "../utils/pendingOccCreates.js";

export function registerTemplateHandlers(socket, {
  ensureUserCache, userCacheReady, loadUserIntoCache, userRoom,
}) {
  const userId = socket.userId;
  const getUc = async () => {
    const gId = socket.data.activeGridId;
    if (!userCacheReady(userId, gId)) await loadUserIntoCache(userId, gId);
    return ensureUserCache(userId, gId);
  };

  // Where a template write may land: the protected Templates folder, or a
  // subfolder of it. Used by clone_subtree_as_template + save_over_template (via
  // the template root's existing parentId) to refuse writes outside it.
  const templatesFolderFor = (uc, gridId, parentFolderId) =>
    resolveTemplatesFolderId(uc, { gridId, userId, parentFolderId });

  function broadcastClones(uc, occIds, modIds) {
    for (const mId of modIds) {
      const m = uc.modulesById[mId];
      if (!m) continue;
      socket.emit("module_created", { module: m });
      socket.to(userRoom(userId)).emit("module_created", { module: m });
    }
    for (const oId of occIds) {
      const o = uc.occurrencesById[oId];
      if (!o) continue;
      socket.emit("occurrence_created", { occurrence: o });
      socket.to(userRoom(userId)).emit("occurrence_created", { occurrence: o });
    }
  }

  socket.on("clone_subtree_as_template", async ({ sourceOccurrenceId, name, parentFolderId } = {}) => {
    try {
      if (!userId || !sourceOccurrenceId) return;
      const uc = await getUc();
      const gridId = socket.data.activeGridId;
      const resolvedParent = templatesFolderFor(uc, gridId, parentFolderId);
      if (!resolvedParent) {
        socket.emit("server_error", "Templates folder not found");
        return;
      }
      // COPY, never move: the source page stays exactly where it is. The name
      // rides on the clone's module label — templates carry no marker.
      const r = await cloneSubtree({
        rootOccurrenceId: sourceOccurrenceId, userId, gridId, uc,
        newParentId: resolvedParent,
        rootLabel: name || null,
      });
      if (!r.rootClonedOccurrenceId) {
        socket.emit("server_error", "Template clone failed");
        return;
      }
      broadcastClones(uc, r.occurrenceIds, r.moduleIds);
      socket.emit("template_created", { templateOccurrenceId: r.rootClonedOccurrenceId, name });
    } catch (err) {
      console.error("clone_subtree_as_template error:", err);
      socket.emit("server_error", "Failed to save template");
    }
  });

  socket.on("apply_template", async ({ templateOccurrenceId, targetOccurrenceId, mode = "append" } = {}) => {
    try {
      if (!userId || !templateOccurrenceId || !targetOccurrenceId) return;
      const uc = await getUc();
      // If the target was just minted by create_page in this same burst (the
      // create-then-apply-template flow — ManifestTree/ModulePanel's "create
      // page from template" tile), that create may still be awaiting its own
      // Mongo round-trip when this frame is processed. Wait for it instead of
      // reading `uc.occurrencesById` before the create has landed there — see
      // utils/pendingOccCreates.js for why this is race-proof rather than a
      // timing hack (both handlers resolve `uc` via `await getUc()` as their
      // first step, so JS's microtask FIFO ordering guarantees the create's
      // registration is visible here by the time this await resolves).
      await awaitPendingOccCreate(uc, targetOccurrenceId);
      const gridId = socket.data.activeGridId;
      const target = uc.occurrencesById[targetOccurrenceId];
      if (!target) {
        socket.emit("server_error", "Apply target not found");
        return;
      }
      // MERGE applies the template's CONTENTS, matching what is already there by
      // identitySignature — structure flows in while the user's writing is left
      // alone, and re-applying tops the page up instead of duplicating it. The
      // other modes clone the template's wrapper in as a child, which is the
      // "stamp a copy" behaviour.
      if (mode === "merge") {
        const m = await mergeSubtreeInto({
          templateOccurrenceId, targetOccurrenceId, userId, gridId, uc,
          occMetaPatch: { appliedFromTemplateId: templateOccurrenceId },
        });
        for (const pid of m.updatedParentIds) {
          const parent = uc.occurrencesById[pid];
          if (!parent) continue;
          socket.emit("occurrence_updated", { occurrence: parent });
          socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: parent });
        }
        broadcastClones(uc, m.occurrenceIds, m.moduleIds);
        socket.emit("template_applied", {
          rootOccurrenceId: targetOccurrenceId,
          newOccurrenceIds: m.occurrenceIds,
          newModuleIds: m.moduleIds,
        });
        return;
      }

      const r = await cloneSubtree({
        rootOccurrenceId: templateOccurrenceId, userId, gridId, uc,
        occMetaPatch: { appliedFromTemplateId: templateOccurrenceId },
        newParentId: targetOccurrenceId,
      });
      if (!r.rootClonedOccurrenceId) {
        socket.emit("server_error", "Template apply failed");
        return;
      }

      if (mode === "replace") {
        target.occurrences = [r.rootClonedOccurrenceId];
      } else {
        target.occurrences = [...(target.occurrences || []), r.rootClonedOccurrenceId];
      }
      uc.occurrencesById[target.id] = target;
      await Occurrence.findOneAndUpdate({ id: target.id }, target, { upsert: true });
      socket.emit("occurrence_updated", { occurrence: target });
      socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: target });

      broadcastClones(uc, r.occurrenceIds, r.moduleIds);
      socket.emit("template_applied", {
        rootOccurrenceId: r.rootClonedOccurrenceId,
        newOccurrenceIds: r.occurrenceIds,
        newModuleIds: r.moduleIds,
      });
    } catch (err) {
      console.error("apply_template error:", err);
      socket.emit("server_error", "Failed to apply template");
    }
  });

  socket.on("save_over_template", async ({ sourceOccurrenceId, templateOccurrenceId } = {}) => {
    try {
      if (!userId || !sourceOccurrenceId || !templateOccurrenceId) return;
      const uc = await getUc();
      const gridId = socket.data.activeGridId;
      const oldRoot = uc.occurrencesById[templateOccurrenceId];
      if (!oldRoot) {
        socket.emit("server_error", "Template not found");
        return;
      }

      // Refuse if the old template isn't inside the protected Templates folder
      // (catches cross-user / mis-rooted templates before we delete).
      const resolvedParent = templatesFolderFor(uc, gridId, oldRoot.parentId);
      if (!resolvedParent) {
        socket.emit("server_error", "Template is not in the Templates folder");
        return;
      }
      // The template's name is its module label — carry it onto the new copy.
      const oldName = uc.modulesById[oldRoot.moduleId]?.label || null;

      // Clone-first, delete-after. If the clone throws or produces no root,
      // the old template stays intact and the user sees an error toast.
      const r = await cloneSubtree({
        rootOccurrenceId: sourceOccurrenceId, userId, gridId, uc,
        newParentId: resolvedParent,
        rootLabel: oldName,
      });
      if (!r.rootClonedOccurrenceId) {
        socket.emit("server_error", "Template clone failed; old template left intact");
        return;
      }

      // Clone succeeded — now collect and delete the old subtree. Walk the
      // OLD tree before any mutations so descendant ids are stable. Track
      // deleted module ids in a Set so shared modules across nodes (shouldn't
      // happen, but guarded) only emit one module_deleted.
      const toDelete = [];
      (function walk(id) {
        const o = uc.occurrencesById[id];
        if (!o) return;
        toDelete.push(o);
        (o.occurrences || []).forEach(walk);
      })(templateOccurrenceId);

      const deletedModIds = new Set();
      for (const o of toDelete) {
        await Occurrence.deleteOne({ id: o.id });
        delete uc.occurrencesById[o.id];
        const modId = o.moduleId;
        if (modId && uc.modulesById[modId] && !deletedModIds.has(modId)) {
          await Module.deleteOne({ id: modId });
          delete uc.modulesById[modId];
          deletedModIds.add(modId);
          socket.emit("module_deleted", { id: modId });
          socket.to(userRoom(userId)).emit("module_deleted", { id: modId });
        }
        socket.emit("occurrence_deleted", { id: o.id });
        socket.to(userRoom(userId)).emit("occurrence_deleted", { id: o.id });
      }

      broadcastClones(uc, r.occurrenceIds, r.moduleIds);
      socket.emit("template_saved_over", {
        oldTemplateId: templateOccurrenceId,
        newTemplateId: r.rootClonedOccurrenceId,
        name: oldName,
      });
    } catch (err) {
      console.error("save_over_template error:", err);
      socket.emit("server_error", "Failed to save over template");
    }
  });
}
