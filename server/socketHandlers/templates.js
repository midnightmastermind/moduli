// socketHandlers/templates.js — clone_subtree_as_template + apply_template + save_over_template
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import { cloneSubtree } from "../utils/cloneSubtree.js";

export function registerTemplateHandlers(socket, {
  ensureUserCache, userCacheReady, loadUserIntoCache, userRoom,
}) {
  const userId = socket.userId;
  const getUc = async () => {
    const gId = socket.data.activeGridId;
    if (!userCacheReady(userId, gId)) await loadUserIntoCache(userId, gId);
    return ensureUserCache(userId, gId);
  };

  // Verify a folder belongs to the templates manifest of the active grid for
  // this user. Used by clone_subtree_as_template + save_over_template (via the
  // template root's existing parentId) to refuse cross-user / cross-manifest
  // template writes. Falls back to the templates manifest root when no
  // parentFolderId is supplied.
  function resolveTemplatesParentFolderId(uc, gridId, parentFolderId) {
    const tplManifest = Object.values(uc.manifestsById || {})
      .find(m => m.gridId === gridId && m.userId === userId && m.manifestType === "templates");
    if (!tplManifest) return null;
    if (!parentFolderId) return tplManifest.rootFolderId;
    // Walk up the folder chain to ensure parentFolderId is inside the templates
    // manifest's tree for this user/grid. Caps at depth 16 as a paranoia guard.
    let cur = uc.foldersById?.[parentFolderId];
    for (let i = 0; cur && i < 16; i++) {
      if (cur.userId !== userId || cur.gridId !== gridId) return null;
      if (cur.id === tplManifest.rootFolderId) return parentFolderId;
      cur = cur.parentId ? uc.foldersById?.[cur.parentId] : null;
    }
    return null;
  }

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
      const resolvedParent = resolveTemplatesParentFolderId(uc, gridId, parentFolderId);
      if (!resolvedParent) {
        socket.emit("server_error", "Invalid template folder");
        return;
      }
      const r = await cloneSubtree({
        rootOccurrenceId: sourceOccurrenceId, userId, gridId, uc,
        moduleMetaPatch: { templateModule: true },
        occMetaPatch: { templateName: name },
        newParentId: resolvedParent,
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
      const gridId = socket.data.activeGridId;
      const target = uc.occurrencesById[targetOccurrenceId];
      if (!target) {
        socket.emit("server_error", "Apply target not found");
        return;
      }
      const r = await cloneSubtree({
        rootOccurrenceId: templateOccurrenceId, userId, gridId, uc,
        moduleMetaPatch: { templateModule: false },
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

      // Refuse if the old template's parent isn't inside this user's templates
      // manifest (catches cross-user / mis-rooted templates before we delete).
      const resolvedParent = resolveTemplatesParentFolderId(uc, gridId, oldRoot.parentId);
      if (!resolvedParent) {
        socket.emit("server_error", "Template is not in the templates manifest");
        return;
      }

      // Clone-first, delete-after. If the clone throws or produces no root,
      // the old template stays intact and the user sees an error toast.
      const r = await cloneSubtree({
        rootOccurrenceId: sourceOccurrenceId, userId, gridId, uc,
        moduleMetaPatch: { templateModule: true },
        occMetaPatch: { templateName: oldRoot.meta?.templateName },
        newParentId: resolvedParent,
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
        const modId = o.moduleId || o.targetId;
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
        name: oldRoot.meta?.templateName || null,
      });
    } catch (err) {
      console.error("save_over_template error:", err);
      socket.emit("server_error", "Failed to save over template");
    }
  });
}
