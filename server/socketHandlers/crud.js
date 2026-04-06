// socketHandlers/crud.js — CRUD for Grid, Module, Occurrence (simple), Field, Operation, Folder + genericCRUD
import Grid from "../models/Grid.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Field from "../models/Field.js";
import Operation from "../models/Operation.js";
import Folder from "../models/Folder.js";
import Manifest from "../models/Manifest.js";
import View from "../models/View.js";

export function registerCrudHandlers(socket, {
  ensureUserCache, userCacheReady, loadUserIntoCache,
  getAllGridsForUser, userRoom, gridRoom,
  getOccurrencesForGrid, createOccurrenceData,
}) {
  const userId = socket.userId;

  // ── GRID ──────────────────────────────────────────────────
  socket.on("create_grid", async ({ grid } = {}) => {
    try {
      if (!userId) return;
      if (!grid) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const gridId = grid.id || grid._id;
      if (!gridId) return socket.emit("server_error", "create_grid missing grid id");
      const next = {
        rows: grid.rows ?? 2, cols: grid.cols ?? 3,
        rowSizes: Array.isArray(grid.rowSizes) ? grid.rowSizes : [],
        colSizes: Array.isArray(grid.colSizes) ? grid.colSizes : [],
        name: grid.name ?? "", userId,
      };
      const saved = await Grid.findOneAndUpdate({ _id: gridId, userId }, { _id: gridId, ...next }, { upsert: true, new: true }).lean();
      uc.gridsById[gridId] = saved;
      socket.to(userRoom(userId)).emit("grid_created", { grid: { id: gridId, _id: gridId, ...saved } });
    } catch (err) {
      console.error("create_grid error:", err);
      socket.emit("server_error", "Failed to create grid");
    }
  });

  socket.on("update_grid", async (payload) => {
    try {
      if (!userId) return;
      const { gridId } = payload || {};
      if (!gridId) return console.log("❌ update_grid missing gridId");
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const { grid: gridPatchFromNested, ...rest } = payload || {};
      const { gridId: _ignored, ...restWithoutId } = rest || {};
      const updatePatch = gridPatchFromNested || restWithoutId || {};
      console.log("🟦 EVENT update_grid:", { gridId, updatePatch });
      if (!uc.gridsById[gridId]) {
        const g = await Grid.findOne({ _id: gridId, userId }).lean();
        if (g) {
          uc.gridsById[gridId] = g;
        } else {
          const created = await Grid.create({ _id: gridId, userId, rows: updatePatch.rows ?? 2, cols: updatePatch.cols ?? 3, rowSizes: updatePatch.rowSizes ?? [], colSizes: updatePatch.colSizes ?? [], name: updatePatch.name });
          uc.gridsById[gridId] = created.toObject();
        }
      }
      uc.gridsById[gridId] = { ...uc.gridsById[gridId], ...updatePatch };
      await Grid.findOneAndUpdate({ _id: gridId, userId }, updatePatch, { upsert: true });
      socket.to(userRoom(userId)).emit("grid_updated", { gridId, grid: updatePatch });
    } catch (err) {
      console.error("update_grid error:", err);
      socket.emit("server_error", "Failed to update grid");
    }
  });

  socket.on("delete_grid", async ({ gridId } = {}) => {
    try {
      if (!userId || !gridId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      await Grid.findOneAndDelete({ _id: gridId, userId });
      if (uc.gridsById?.[gridId]) delete uc.gridsById[gridId];
      if (socket.data.activeGridId === gridId) {
        const remaining = Object.keys(uc.gridsById);
        let nextId = remaining.length ? remaining[0] : null;
        if (!nextId) {
          const newGrid = await Grid.create({ rows: 2, cols: 3, rowSizes: [], colSizes: [], userId, name: "" });
          nextId = newGrid._id.toString();
          uc.gridsById[nextId] = newGrid.toObject();
        }
        socket.leave(gridRoom(userId, gridId));
        socket.join(gridRoom(userId, nextId));
        socket.data.activeGridId = nextId;
        const grids = await getAllGridsForUser(userId);
        const safeGrid = uc.gridsById[nextId];
        const gridOccurrences = getOccurrencesForGrid(nextId, uc);
        socket.emit("full_state", {
          gridId: nextId, grid: safeGrid,
          modules: Object.values(uc.modulesById || {}),
          occurrences: gridOccurrences,
          fields: Object.values(uc.fieldsById),
          grids,
        });
      }
      socket.to(userRoom(userId)).emit("grid_deleted", { gridId });
    } catch (err) {
      console.error("delete_grid error:", err);
      socket.emit("server_error", "Failed to delete grid");
    }
  });

  // ── MODULE ─────────────────────────────────────────────────
  socket.on("create_module", async ({ module: moduleData } = {}) => {
    try {
      if (!userId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const id = moduleData?.id;
      if (!id) return;
      const next = { ...(uc.modulesById[id] || {}), ...moduleData, id, userId };
      uc.modulesById[id] = next;
      await Module.findOneAndUpdate({ id, userId }, next, { upsert: true });
      socket.to(userRoom(userId)).emit("module_created", { module: next });
    } catch (err) {
      console.error("create_module error:", err);
      socket.emit("server_error", "Failed to create module");
    }
  });

  socket.on("update_module", async ({ module: moduleData } = {}) => {
    try {
      if (!userId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const id = moduleData?.id;
      if (!id) return;
      const next = { ...(uc.modulesById[id] || {}), ...moduleData, id, userId };
      uc.modulesById[id] = next;
      await Module.findOneAndUpdate({ id, userId }, next, { upsert: true });
      socket.to(userRoom(userId)).emit("module_updated", { module: next });
    } catch (err) {
      console.error("update_module error:", err);
      socket.emit("server_error", "Failed to update module");
    }
  });

  socket.on("delete_module", async ({ moduleId } = {}) => {
    try {
      if (!userId || !moduleId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      if (uc.modulesById?.[moduleId]) delete uc.modulesById[moduleId];
      await Module.findOneAndDelete({ id: moduleId, userId });

      const moduleOccurrences = Object.values(uc.occurrencesById || {}).filter(
        (occ) => (occ.targetType === "module" || occ.targetType === "panel" || occ.targetType === "container" || occ.targetType === "instance") && occ.targetId === moduleId
      );
      const occurrenceIds = moduleOccurrences.map(o => o.id);
      for (const occ of moduleOccurrences) {
        delete uc.occurrencesById[occ.id];
        await Occurrence.findOneAndDelete({ id: occ.id, userId });
        socket.to(userRoom(userId)).emit("occurrence_deleted", { occurrenceId: occ.id });
      }
      if (occurrenceIds.length > 0) {
        const affected = [];
        for (const occ of Object.values(uc.occurrencesById || {})) {
          if (!Array.isArray(occ.occurrences)) continue;
          if (!occ.occurrences.some(occId => occurrenceIds.includes(occId))) continue;
          const next = { ...occ, occurrences: occ.occurrences.filter(occId => !occurrenceIds.includes(occId)) };
          uc.occurrencesById[next.id] = next;
          affected.push(next);
        }
        for (const occ of affected) {
          await Occurrence.findOneAndUpdate({ id: occ.id, userId }, occ, { upsert: true });
          socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: occ });
        }
      }
      socket.to(userRoom(userId)).emit("module_deleted", { moduleId });
    } catch (err) {
      console.error("delete_module error:", err);
      socket.emit("server_error", "Failed to delete module");
    }
  });

  // ── OCCURRENCE (simple create/delete — update_occurrence is in occurrences.js) ──
  socket.on("create_occurrence", async ({ occurrence } = {}) => {
    try {
      if (!userId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const id = occurrence?.id;
      if (!id) return;
      const occurrenceData = {
        ...createOccurrenceData({
          id, userId,
          targetType: occurrence.targetType, targetId: occurrence.targetId,
          gridId: occurrence.gridId,
          placement: occurrence.placement, fields: occurrence.fields,
          meta: occurrence.meta, linkedGroupId: occurrence.linkedGroupId || null,
        }),
        // Pass through additional fields not in createOccurrenceData
        ...(occurrence.parentId != null && { parentId: occurrence.parentId }),
        ...(occurrence.textmap != null && { textmap: occurrence.textmap }),
        ...(occurrence.viewId != null && { viewId: occurrence.viewId }),
        ...(Array.isArray(occurrence.occurrences) && { occurrences: occurrence.occurrences }),
      };
      uc.occurrencesById[id] = occurrenceData;
      await Occurrence.findOneAndUpdate({ id, userId }, occurrenceData, { upsert: true });
      socket.to(userRoom(userId)).emit("occurrence_created", { occurrence: occurrenceData });
    } catch (err) {
      console.error("create_occurrence error:", err);
      socket.emit("server_error", "Failed to create occurrence");
    }
  });

  socket.on("delete_occurrence", async ({ occurrenceId } = {}) => {
    try {
      if (!userId || !occurrenceId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);

      // Recursively collect all descendant occurrence IDs
      const toDelete = new Set();
      function collectDescendants(id) {
        toDelete.add(id);
        const occ = uc.occurrencesById?.[id];
        if (occ?.occurrences) {
          for (const childId of occ.occurrences) collectDescendants(childId);
        }
      }
      collectDescendants(occurrenceId);

      // Delete all collected occurrences from cache + DB
      const deletedParentId = uc.occurrencesById[occurrenceId]?.parentId;
      for (const id of toDelete) {
        delete uc.occurrencesById[id];
        await Occurrence.findOneAndDelete({ id, userId });
        socket.to(userRoom(userId)).emit("occurrence_deleted", { occurrenceId: id });
      }

      // Clean up parent occurrence references
      for (const occ of Object.values(uc.occurrencesById || {})) {
        if (!Array.isArray(occ.occurrences)) continue;
        if (!occ.occurrences.some(id => toDelete.has(id))) continue;
        const next = { ...occ, occurrences: occ.occurrences.filter(id => !toDelete.has(id)) };
        uc.occurrencesById[next.id] = next;
        await Occurrence.findOneAndUpdate({ id: next.id, userId }, next, { upsert: true });
        socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: next });
      }

      // Clean up grid.occurrences if this was a panel occurrence
      for (const grid of Object.values(uc.gridsById || {})) {
        if (!Array.isArray(grid.occurrences)) continue;
        if (!grid.occurrences.includes(occurrenceId)) continue;
        grid.occurrences = grid.occurrences.filter(id => id !== occurrenceId);
        await Grid.findOneAndUpdate({ id: grid.id, userId }, { occurrences: grid.occurrences });
        socket.to(userRoom(userId)).emit("grid_updated", { gridId: grid.id, grid: { occurrences: grid.occurrences } });
      }
    } catch (err) {
      console.error("delete_occurrence error:", err);
      socket.emit("server_error", "Failed to delete occurrence");
    }
  });

  // ── TRASH / RESTORE MODULE (soft delete) ─────────────────
  socket.on("trash_module", async ({ moduleId } = {}) => {
    try {
      if (!userId || !moduleId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      if (uc.modulesById?.[moduleId]) uc.modulesById[moduleId].trashed = true;
      await Module.findOneAndUpdate({ id: moduleId, userId }, { trashed: true });
      socket.to(userRoom(userId)).emit("module_updated", { module: { id: moduleId, trashed: true } });
    } catch (err) {
      console.error("trash_module error:", err);
      socket.emit("server_error", "Failed to trash module");
    }
  });

  socket.on("restore_module", async ({ moduleId } = {}) => {
    try {
      if (!userId || !moduleId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      if (uc.modulesById?.[moduleId]) uc.modulesById[moduleId].trashed = false;
      await Module.findOneAndUpdate({ id: moduleId, userId }, { trashed: false });
      socket.to(userRoom(userId)).emit("module_updated", { module: { id: moduleId, trashed: false } });
    } catch (err) {
      console.error("restore_module error:", err);
      socket.emit("server_error", "Failed to restore module");
    }
  });

  // ── CREATE_INSTANCE_IN_CONTAINER ─────────────────────────
  // Creates a new instance Module + Occurrence inside a container occurrence.
  // Also accepts optional occurrenceId + meta for pre-positioned canvas cards.
  socket.on("create_instance_in_container", async ({ containerId, instance, occurrenceId: requestedOccId, meta: extraMeta } = {}) => {
    try {
      if (!userId || !containerId || !instance?.id) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const grid = Object.values(uc.gridsById || {})[0];
      const gridId = grid?.id || grid?._id?.toString() || instance.gridId;

      // 1. Save the Module
      const mod = new Module({
        id: instance.id,
        userId, gridId,
        role: "instance",
        kind: instance.kind || "list",
        label: instance.label || "New item",
        fieldBindings: instance.fieldBindings || [],
        defaultDragMode: instance.defaultDragMode || "move",
        meta: instance.meta || {},
      });
      await mod.save();
      const modObj = mod.toObject();
      uc.modulesById = uc.modulesById || {};
      uc.modulesById[modObj.id] = modObj;

      // 2. Find the container occurrence to get parentId and gridId
      const containerOcc = Object.values(uc.occurrencesById || {}).find(o => o.targetId === containerId);
      const occId = requestedOccId || `occ_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const occurrenceData = createOccurrenceData({
        id: occId, userId, gridId,
        targetType: "module", targetId: instance.id,
        parentId: containerOcc?.id || null,
        meta: extraMeta || {},
        fields: {},
        filterOverride: null, hidden: false,
      });

      // 3. Append to container occurrence.occurrences[]
      if (containerOcc) {
        const updatedOccs = [...(containerOcc.occurrences || []), occId];
        uc.occurrencesById[containerOcc.id] = { ...containerOcc, occurrences: updatedOccs };
        await Occurrence.findOneAndUpdate({ id: containerOcc.id, userId }, { occurrences: updatedOccs });
      }

      uc.occurrencesById[occId] = occurrenceData;
      await Occurrence.findOneAndUpdate({ id: occId, userId }, occurrenceData, { upsert: true });

      // 4. Broadcast
      socket.to(userRoom(userId)).emit("module_created", modObj);
      socket.to(userRoom(userId)).emit("occurrence_created", { occurrence: occurrenceData });
      if (containerOcc) {
        socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: uc.occurrencesById[containerOcc.id] });
      }
    } catch (err) {
      console.error("create_instance_in_container error:", err);
      socket.emit("server_error", "Failed to create instance in container");
    }
  });

  // ── FIELD ──────────────────────────────────────────────────
  socket.on("create_field", async ({ field } = {}) => {
    try {
      if (!userId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const id = field?.id;
      const gridId = field?.gridId;
      if (!id || !gridId) return;
      const fieldData = {
        id, userId, gridId,
        name: field.name || "Untitled", type: field.type || "text",
        mode: field.mode || "input", unit: field.unit, metric: field.metric,
        conditions: field.conditions, triggers: field.triggers || [],
        display: field.display || { role: "input", showLabel: true, order: 0 },
        meta: field.meta || {},
      };
      uc.fieldsById[id] = fieldData;
      await Field.findOneAndUpdate({ id, userId }, fieldData, { upsert: true });
      socket.to(userRoom(userId)).emit("field_created", { field: fieldData });
    } catch (err) {
      console.error("create_field error:", err);
      socket.emit("server_error", "Failed to create field");
    }
  });

  socket.on("update_field", async ({ field } = {}) => {
    try {
      if (!userId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const id = field?.id;
      if (!id) return;
      const next = { ...(uc.fieldsById[id] || {}), ...field, id, userId };
      uc.fieldsById[id] = next;
      await Field.findOneAndUpdate({ id, userId }, next, { upsert: true });
      socket.to(userRoom(userId)).emit("field_updated", { field: next });
    } catch (err) {
      console.error("update_field error:", err);
      socket.emit("server_error", "Failed to update field");
    }
  });

  socket.on("delete_field", async ({ fieldId } = {}) => {
    try {
      if (!userId || !fieldId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      if (uc.fieldsById?.[fieldId]) delete uc.fieldsById[fieldId];
      await Field.findOneAndDelete({ id: fieldId, userId });
      socket.to(userRoom(userId)).emit("field_deleted", { fieldId });
    } catch (err) {
      console.error("delete_field error:", err);
      socket.emit("server_error", "Failed to delete field");
    }
  });

  // ── OPERATION ──────────────────────────────────────────────
  socket.on("create_operation", async ({ operation } = {}) => {
    try {
      if (!userId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const id = operation?.id;
      const gridId = operation?.gridId;
      if (!id || !gridId) return;
      const opData = {
        id, userId, gridId,
        name: operation.name || "Untitled Operation",
        description: operation.description || "",
        blockTree: operation.blockTree || null,
        targetFieldId: operation.targetFieldId || null,
        triggerType: operation.triggerType || "onChange",
        intervalMs: operation.intervalMs || null,
        enabled: operation.enabled !== false,
        sortOrder: operation.sortOrder || 0,
        meta: operation.meta || {},
      };
      uc.operationsById[id] = opData;
      await Operation.findOneAndUpdate({ id, userId }, opData, { upsert: true });
      socket.to(userRoom(userId)).emit("operation_created", { operation: opData });
    } catch (err) {
      console.error("create_operation error:", err);
      socket.emit("server_error", "Failed to create operation");
    }
  });

  socket.on("update_operation", async ({ operation } = {}) => {
    try {
      if (!userId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const id = operation?.id;
      if (!id) return;
      const next = { ...(uc.operationsById[id] || {}), ...operation, id, userId };
      uc.operationsById[id] = next;
      await Operation.findOneAndUpdate({ id, userId }, next, { upsert: true });
      socket.to(userRoom(userId)).emit("operation_updated", { operation: next });
    } catch (err) {
      console.error("update_operation error:", err);
      socket.emit("server_error", "Failed to update operation");
    }
  });

  socket.on("delete_operation", async ({ operationId } = {}) => {
    try {
      if (!userId || !operationId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      if (uc.operationsById?.[operationId]) delete uc.operationsById[operationId];
      await Operation.findOneAndDelete({ id: operationId, userId });
      socket.to(userRoom(userId)).emit("operation_deleted", { operationId });
    } catch (err) {
      console.error("delete_operation error:", err);
      socket.emit("server_error", "Failed to delete operation");
    }
  });

  // ── FOLDER ─────────────────────────────────────────────────
  socket.on("create_folder", async ({ folder } = {}) => {
    try {
      if (!userId || !folder?.name) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const existing = Object.values(uc.foldersById || {}).find(f =>
        f.name === folder.name && f.parentId === (folder.parentId || null)
      );
      if (existing) return socket.emit("folder_created", existing);
      const folderData = {
        id: folder.id || crypto.randomUUID(), userId,
        name: folder.name,
        parentId: folder.parentId || null,
        folderType: folder.folderType || "normal",
        sortOrder: folder.sortOrder ?? 0,
        isExpanded: folder.isExpanded !== false,
      };
      if (!uc.foldersById) uc.foldersById = {};
      uc.foldersById[folderData.id] = folderData;
      await Folder.findOneAndUpdate({ id: folderData.id, userId }, folderData, { upsert: true });
      socket.emit("folder_created", folderData);
      socket.to(userRoom(userId)).emit("folder_created", folderData);
    } catch (err) {
      console.error("create_folder error:", err);
      socket.emit("server_error", "Failed to create folder");
    }
  });

  // ── GENERIC CRUD (Manifest, View, Folder, Operation, Iteration) ────────────
  function setupGenericCRUD(modelName, Model, cacheKey) {
    socket.on(`create_${modelName}`, async ({ [modelName]: entity } = {}) => {
      try {
        if (!userId) return;
        if (!userCacheReady(userId)) await loadUserIntoCache(userId);
        const uc = ensureUserCache(userId);
        const id = entity?.id;
        if (!id) return;
        const next = { ...entity, id, userId };
        uc[cacheKey][id] = next;
        await Model.findOneAndUpdate({ id, userId }, next, { upsert: true });
        socket.to(userRoom(userId)).emit(`${modelName}_created`, { [modelName]: next });
      } catch (err) {
        console.error(`create_${modelName} error:`, err);
        socket.emit("server_error", `Failed to create ${modelName}`);
      }
    });

    socket.on(`update_${modelName}`, async ({ [modelName]: entity } = {}) => {
      try {
        if (!userId) return;
        if (!userCacheReady(userId)) await loadUserIntoCache(userId);
        const uc = ensureUserCache(userId);
        const id = entity?.id;
        if (!id) return;
        const next = { ...(uc[cacheKey][id] || {}), ...entity, id, userId };
        uc[cacheKey][id] = next;
        await Model.findOneAndUpdate({ id, userId }, next, { upsert: true });
        socket.to(userRoom(userId)).emit(`${modelName}_updated`, { [modelName]: next });
      } catch (err) {
        console.error(`update_${modelName} error:`, err);
        socket.emit("server_error", `Failed to update ${modelName}`);
      }
    });

    socket.on(`delete_${modelName}`, async ({ [`${modelName}Id`]: entityId } = {}) => {
      try {
        if (!userId) return;
        if (!userCacheReady(userId)) await loadUserIntoCache(userId);
        const uc = ensureUserCache(userId);
        if (!entityId) return;
        if (uc[cacheKey]?.[entityId]) delete uc[cacheKey][entityId];
        await Model.findOneAndDelete({ id: entityId, userId });
        socket.to(userRoom(userId)).emit(`${modelName}_deleted`, { [`${modelName}Id`]: entityId });
      } catch (err) {
        console.error(`delete_${modelName} error:`, err);
        socket.emit("server_error", `Failed to delete ${modelName}`);
      }
    });
  }

  setupGenericCRUD("manifest", Manifest, "manifestsById");
  setupGenericCRUD("view", View, "viewsById");
  setupGenericCRUD("folder", Folder, "foldersById");
  setupGenericCRUD("operation", Operation, "operationsById");

  // ── FILTER SYSTEM ─────────────────────────────────────────
  // update_grid_filter: set the active filter + live values
  socket.on("update_grid_filter", async ({ gridId, activeFilterId, activeFilterValues } = {}) => {
    try {
      if (!userId || !gridId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const patch = {};
      if (activeFilterId !== undefined) patch.activeFilterId = activeFilterId;
      if (activeFilterValues !== undefined) patch.activeFilterValues = activeFilterValues;
      if (!Object.keys(patch).length) return;
      uc.gridsById[gridId] = { ...uc.gridsById[gridId], ...patch };
      await Grid.findOneAndUpdate({ _id: gridId, userId }, patch);
      socket.to(userRoom(userId)).emit("grid_updated", { gridId, grid: patch });
    } catch (err) {
      console.error("update_grid_filter error:", err);
      socket.emit("server_error", "Failed to update grid filter");
    }
  });

  // update_grid_named_filters: replace the namedFilters array
  socket.on("update_grid_named_filters", async ({ gridId, namedFilters } = {}) => {
    try {
      if (!userId || !gridId || !Array.isArray(namedFilters)) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      uc.gridsById[gridId] = { ...uc.gridsById[gridId], namedFilters };
      await Grid.findOneAndUpdate({ _id: gridId, userId }, { namedFilters });
      socket.to(userRoom(userId)).emit("grid_updated", { gridId, grid: { namedFilters } });
    } catch (err) {
      console.error("update_grid_named_filters error:", err);
      socket.emit("server_error", "Failed to update named filters");
    }
  });

  // update_occurrence_filter_override: set panel/container filter inheritance
  socket.on("update_occurrence_filter_override", async ({ occurrenceId, filterOverride } = {}) => {
    try {
      if (!userId || !occurrenceId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const occ = uc.occurrencesById[occurrenceId];
      if (!occ) return;
      const updated = { ...occ, filterOverride: filterOverride ?? null };
      uc.occurrencesById[occurrenceId] = updated;
      await Occurrence.findOneAndUpdate({ id: occurrenceId, userId }, { filterOverride: filterOverride ?? null });
      socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: updated });
    } catch (err) {
      console.error("update_occurrence_filter_override error:", err);
      socket.emit("server_error", "Failed to update filter override");
    }
  });

  // ── PAGE (composite operations) ──────────────────────────
  // create_page: Creates Module (role: "page") + View + Occurrence, adds occ to panel's occurrences[]
  socket.on("create_page", async ({ module: moduleData, view: viewData, occurrence: occData, panelOccurrenceId, panelViewData } = {}) => {
    try {
      if (!userId) return;
      if (!moduleData?.id || !occData?.id) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);

      // 1. Save Module
      const mod = { ...moduleData, userId, role: "page" };
      uc.modulesById[mod.id] = mod;
      await Module.findOneAndUpdate({ id: mod.id, userId }, mod, { upsert: true });

      // 2. Save View (if provided)
      let savedView = null;
      if (viewData?.id) {
        savedView = { ...viewData, userId };
        uc.viewsById[savedView.id] = savedView;
        await View.findOneAndUpdate({ id: savedView.id, userId }, savedView, { upsert: true });
      }

      // 3. Save Occurrence
      const occ = {
        ...createOccurrenceData({
          id: occData.id, userId,
          targetType: "module", targetId: moduleData.id,
          gridId: occData.gridId,
          fields: occData.fields || {},
        }),
        ...(occData.parentId != null && { parentId: occData.parentId }),
        ...(occData.viewId != null && { viewId: occData.viewId }),
        ...(occData.sortOrder != null && { sortOrder: occData.sortOrder }),
        ...(Array.isArray(occData.occurrences) && { occurrences: occData.occurrences }),
      };
      uc.occurrencesById[occ.id] = occ;
      await Occurrence.findOneAndUpdate({ id: occ.id, userId }, occ, { upsert: true });

      // 4. Broadcast new entities first — other windows must have the occ before the panel refs it
      socket.to(userRoom(userId)).emit("module_created", { module: mod });
      if (savedView) socket.to(userRoom(userId)).emit("view_created", { view: savedView });
      socket.to(userRoom(userId)).emit("occurrence_created", { occurrence: occ });

      // 5. Update panel occurrence: add occ + optionally set viewId
      if (panelOccurrenceId) {
        const panelOcc = uc.occurrencesById[panelOccurrenceId];
        if (panelOcc) {
          const patch = { occurrences: [...(panelOcc.occurrences || []), occ.id] };
          if (panelViewData?.id) patch.viewId = panelViewData.id;
          const updated = { ...panelOcc, ...patch };
          uc.occurrencesById[panelOccurrenceId] = updated;
          await Occurrence.findOneAndUpdate({ id: panelOccurrenceId, userId }, patch);
          if (!panelViewData?.id) {
            socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: updated });
          }
        }
      }

      // 6. Create panel View if provided, then emit combined occurrence_updated
      if (panelViewData?.id) {
        const panelView = { ...panelViewData, userId };
        uc.viewsById[panelView.id] = panelView;
        await View.findOneAndUpdate({ id: panelView.id, userId }, panelView, { upsert: true });
        socket.to(userRoom(userId)).emit("view_created", { view: panelView });
        const panelOcc = uc.occurrencesById[panelOccurrenceId];
        if (panelOcc) socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: panelOcc });
      }
    } catch (err) {
      console.error("create_page error:", err);
      socket.emit("server_error", "Failed to create page");
    }
  });

  // delete_page: Removes page occ from panel's occurrences[], deletes occurrence tree, trashes module
  socket.on("delete_page", async ({ pageOccurrenceId, panelOccurrenceId } = {}) => {
    try {
      if (!userId || !pageOccurrenceId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);

      // 1. Remove from panel's occurrences[]
      if (panelOccurrenceId) {
        const panelOcc = uc.occurrencesById[panelOccurrenceId];
        if (panelOcc) {
          const updated = { ...panelOcc, occurrences: (panelOcc.occurrences || []).filter(id => id !== pageOccurrenceId) };
          uc.occurrencesById[panelOccurrenceId] = updated;
          await Occurrence.findOneAndUpdate({ id: panelOccurrenceId, userId }, { occurrences: updated.occurrences });
          socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: updated });
        }
      }

      // 2. Trash the module
      const pageOcc = uc.occurrencesById[pageOccurrenceId];
      if (pageOcc?.targetId && uc.modulesById[pageOcc.targetId]) {
        uc.modulesById[pageOcc.targetId].trashed = true;
        await Module.findOneAndUpdate({ id: pageOcc.targetId, userId }, { trashed: true });
        socket.to(userRoom(userId)).emit("module_updated", { module: { id: pageOcc.targetId, trashed: true } });
      }

      // 3. Recursively delete occurrence tree
      const toDelete = new Set();
      function collectDescendants(id) {
        toDelete.add(id);
        const occ = uc.occurrencesById?.[id];
        if (occ?.occurrences) {
          for (const childId of occ.occurrences) collectDescendants(childId);
        }
      }
      collectDescendants(pageOccurrenceId);
      for (const id of toDelete) {
        delete uc.occurrencesById[id];
        await Occurrence.findOneAndDelete({ id, userId });
        socket.to(userRoom(userId)).emit("occurrence_deleted", { occurrenceId: id });
      }
    } catch (err) {
      console.error("delete_page error:", err);
      socket.emit("server_error", "Failed to delete page");
    }
  });

  // move_page: Updates page occurrence parentId + sortOrder (manifest tree drag)
  socket.on("move_page", async ({ pageOccurrenceId, targetFolderId, sortOrder } = {}) => {
    try {
      if (!userId || !pageOccurrenceId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const occ = uc.occurrencesById[pageOccurrenceId];
      if (!occ) return;
      const patch = {};
      if (targetFolderId !== undefined) patch.parentId = targetFolderId;
      if (sortOrder !== undefined) patch.sortOrder = sortOrder;
      const updated = { ...occ, ...patch };
      uc.occurrencesById[pageOccurrenceId] = updated;
      await Occurrence.findOneAndUpdate({ id: pageOccurrenceId, userId }, patch);
      socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: updated });
    } catch (err) {
      console.error("move_page error:", err);
      socket.emit("server_error", "Failed to move page");
    }
  });

  // pin_page_to_panel: Adds page occ ID to panel's occurrences[] (transient pin)
  socket.on("pin_page_to_panel", async ({ pageOccurrenceId, panelOccurrenceId } = {}) => {
    try {
      if (!userId || !pageOccurrenceId || !panelOccurrenceId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const panelOcc = uc.occurrencesById[panelOccurrenceId];
      if (!panelOcc) return;
      if ((panelOcc.occurrences || []).includes(pageOccurrenceId)) return; // already pinned
      const updated = { ...panelOcc, occurrences: [...(panelOcc.occurrences || []), pageOccurrenceId] };
      uc.occurrencesById[panelOccurrenceId] = updated;
      await Occurrence.findOneAndUpdate({ id: panelOccurrenceId, userId }, { occurrences: updated.occurrences });
      socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: updated });
    } catch (err) {
      console.error("pin_page_to_panel error:", err);
      socket.emit("server_error", "Failed to pin page to panel");
    }
  });

  // unpin_page_from_panel: Removes page occ ID from panel's occurrences[] (only transient pins)
  socket.on("unpin_page_from_panel", async ({ pageOccurrenceId, panelOccurrenceId } = {}) => {
    try {
      if (!userId || !pageOccurrenceId || !panelOccurrenceId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const panelOcc = uc.occurrencesById[panelOccurrenceId];
      if (!panelOcc) return;
      const updated = { ...panelOcc, occurrences: (panelOcc.occurrences || []).filter(id => id !== pageOccurrenceId) };
      uc.occurrencesById[panelOccurrenceId] = updated;
      await Occurrence.findOneAndUpdate({ id: panelOccurrenceId, userId }, { occurrences: updated.occurrences });
      socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: updated });
    } catch (err) {
      console.error("unpin_page_from_panel error:", err);
      socket.emit("server_error", "Failed to unpin page from panel");
    }
  });

  // update_occurrence_hidden: set by HIDE_OCCURRENCE / SHOW_OCCURRENCE operation effects
  socket.on("update_occurrence_hidden", async ({ occurrenceId, hidden } = {}) => {
    try {
      if (!userId || !occurrenceId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const occ = uc.occurrencesById[occurrenceId];
      if (!occ) return;
      const updated = { ...occ, hidden: !!hidden };
      uc.occurrencesById[occurrenceId] = updated;
      await Occurrence.findOneAndUpdate({ id: occurrenceId, userId }, { hidden: !!hidden });
      socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: updated });
    } catch (err) {
      console.error("update_occurrence_hidden error:", err);
      socket.emit("server_error", "Failed to update occurrence hidden state");
    }
  });
}
