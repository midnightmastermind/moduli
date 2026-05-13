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
      const r = await cloneSubtree({
        rootOccurrenceId: sourceOccurrenceId, userId, gridId, uc,
        moduleMetaPatch: { templateModule: true },
        occMetaPatch: { templateName: name },
        newParentId: parentFolderId,
      });
      if (!r.rootClonedOccurrenceId) return;
      broadcastClones(uc, r.occurrenceIds, r.moduleIds);
      socket.emit("template_created", { templateOccurrenceId: r.rootClonedOccurrenceId });
    } catch (err) {
      console.error("clone_subtree_as_template error:", err);
    }
  });

  socket.on("apply_template", async ({ templateOccurrenceId, targetOccurrenceId, mode = "append" } = {}) => {
    try {
      if (!userId || !templateOccurrenceId || !targetOccurrenceId) return;
      const uc = await getUc();
      const gridId = socket.data.activeGridId;
      const target = uc.occurrencesById[targetOccurrenceId];
      if (!target) return;
      const r = await cloneSubtree({
        rootOccurrenceId: templateOccurrenceId, userId, gridId, uc,
        moduleMetaPatch: { templateModule: false },
        occMetaPatch: { appliedFromTemplateId: templateOccurrenceId },
        newParentId: targetOccurrenceId,
      });
      if (!r.rootClonedOccurrenceId) return;

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
    }
  });

  socket.on("save_over_template", async ({ sourceOccurrenceId, templateOccurrenceId } = {}) => {
    try {
      if (!userId || !sourceOccurrenceId || !templateOccurrenceId) return;
      const uc = await getUc();
      const gridId = socket.data.activeGridId;
      const oldRoot = uc.occurrencesById[templateOccurrenceId];
      if (!oldRoot) return;

      const toDelete = [];
      (function walk(id) {
        const o = uc.occurrencesById[id];
        if (!o) return;
        toDelete.push(o);
        (o.occurrences || []).forEach(walk);
      })(templateOccurrenceId);

      for (const o of toDelete) {
        await Occurrence.deleteOne({ id: o.id });
        delete uc.occurrencesById[o.id];
        const modId = o.moduleId || o.targetId;
        if (modId && uc.modulesById[modId]) {
          await Module.deleteOne({ id: modId });
          delete uc.modulesById[modId];
          socket.emit("module_deleted", { id: modId });
          socket.to(userRoom(userId)).emit("module_deleted", { id: modId });
        }
        socket.emit("occurrence_deleted", { id: o.id });
        socket.to(userRoom(userId)).emit("occurrence_deleted", { id: o.id });
      }

      const r = await cloneSubtree({
        rootOccurrenceId: sourceOccurrenceId, userId, gridId, uc,
        moduleMetaPatch: { templateModule: true },
        occMetaPatch: { templateName: oldRoot.meta?.templateName },
        newParentId: oldRoot.parentId,
      });
      if (!r.rootClonedOccurrenceId) return;
      broadcastClones(uc, r.occurrenceIds, r.moduleIds);
      socket.emit("template_saved_over", {
        oldTemplateId: templateOccurrenceId,
        newTemplateId: r.rootClonedOccurrenceId,
      });
    } catch (err) {
      console.error("save_over_template error:", err);
    }
  });
}
