// socketHandlers/crud.js — CRUD for Grid, Module, Occurrence (simple), Field, Operation, Folder + genericCRUD
import { setMaxListeners } from "node:events";
import Grid from "../models/Grid.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Field from "../models/Field.js";
import Operation from "../models/Operation.js";
import Folder from "../models/Folder.js";
import Manifest from "../models/Manifest.js";
import View from "../models/View.js";
import { isProtectedGrid } from "../utils/protectedGrids.js";
import { assertNotProtectedFolder } from "../utils/protectedFolders.js";
import { recordDoc } from "../utils/txRecorder.js";
import { registerPendingOccCreate } from "../utils/pendingOccCreates.js";

export function registerCrudHandlers(socket, {
  ensureUserCache, userCacheReady, loadUserIntoCache,
  getAllGridsForUser, userRoom, gridRoom,
  getOccurrencesForGrid, createOccurrenceData,
}) {
  const userId = socket.userId;
  // Helper: get (or load) the cache for the currently active grid
  const getUc = async () => {
    const gId = socket.data.activeGridId;
    if (!userCacheReady(userId, gId)) await loadUserIntoCache(userId, gId);
    return ensureUserCache(userId, gId);
  };

  // Undo/redo capture. `__actionId` rides on every client write (see
  // client/src/helpers/actionScope.js) so one user action and the whole
  // operation cascade behind it land in ONE transaction. Recording must never
  // be able to fail a write — the user's edit outranks the audit trail.
  const broadcastTx = (txJson) => {
    socket.emit("transaction_created", { transaction: txJson });
    socket.to(userRoom(userId)).emit("transaction_created", { transaction: txJson });
  };
  const recordChange = ({ model, id, before, after, payload, label }) => {
    try {
      recordDoc({
        userId, gridId: socket.data.activeGridId,
        actionId: payload?.__actionId || null,
        model, id, before, after, label, broadcast: broadcastTx,
      });
    } catch (err) {
      console.error("recordChange failed (continuing):", err?.message || err);
    }
  };

  // ── GRID ──────────────────────────────────────────────────
  socket.on("create_grid", async ({ grid } = {}) => {
    try {
      if (!userId || !grid) return;
      const gridId = grid.id || grid._id;
      if (!gridId) return socket.emit("server_error", "create_grid missing grid id");
      const next = {
        rows: grid.rows ?? 2, cols: grid.cols ?? 3,
        rowSizes: Array.isArray(grid.rowSizes) ? grid.rowSizes : [],
        colSizes: Array.isArray(grid.colSizes) ? grid.colSizes : [],
        name: grid.name ?? "", userId,
      };
      const saved = await Grid.findOneAndUpdate({ _id: gridId, userId }, { _id: gridId, ...next }, { upsert: true, returnDocument: 'after' }).lean();
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
      const { grid: gridPatchFromNested, ...rest } = payload || {};
      const { gridId: _ignored, ...restWithoutId } = rest || {};
      const updatePatch = gridPatchFromNested || restWithoutId || {};
      // NO upsert: a patch for a grid that no longer exists (deleted, or
      // dropped by a reseed while a stale tab was still connected) must not
      // resurrect it as a zombie doc — that's how duplicate "Live Grid"s were
      // born (2026-07-11: a reconnected tab's layoutTree write re-created the
      // grid the reseed had just deleted).
      const updated = await Grid.findOneAndUpdate({ _id: gridId, userId }, updatePatch);
      if (!updated) return;
      socket.to(userRoom(userId)).emit("grid_updated", { gridId, grid: updatePatch });
    } catch (err) {
      console.error("update_grid error:", err);
      socket.emit("server_error", "Failed to update grid");
    }
  });

  socket.on("delete_grid", async ({ gridId } = {}) => {
    try {
      if (!userId || !gridId) return;
      // A protected grid (the live data) can't be deleted from the UI. This is
      // the ONLY destructive path a user can reach by hand — one window.confirm
      // in Grid Settings — so the refusal lives on the server, not just in the
      // client that renders the button.
      const target = await Grid.findOne({ _id: gridId, userId }).lean();
      if (!target) return;
      if (isProtectedGrid(target)) {
        socket.emit("server_error",
          `"${target.name}" is protected live data and cannot be deleted.`);
        return;
      }
      // CASCADE the scoped documents. This used to delete the Grid row only,
      // stranding every Occurrence/Module/Field/… that pointed at it — that is
      // where the 27 folders under a long-gone gridId came from (found
      // 2026-07-28). Orphans are invisible but they still load into every
      // `full_state` scan, so they are a slow leak, not just untidiness.
      const scoped = { gridId };
      await Promise.all([
        Occurrence.deleteMany(scoped), Module.deleteMany(scoped),
        Field.deleteMany(scoped), Manifest.deleteMany(scoped),
        View.deleteMany(scoped), Folder.deleteMany(scoped),
        Operation.deleteMany(scoped),
      ]);
      await Grid.findOneAndDelete({ _id: gridId, userId });
      socket.to(userRoom(userId)).emit("grid_deleted", { gridId });
      if (socket.data.activeGridId === gridId) {
        // Find another grid to switch to
        const remaining = await getAllGridsForUser(userId);
        const filtered = remaining.filter(g => g.id !== gridId);
        let nextId = filtered.length ? filtered[0].id : null;
        if (!nextId) {
          // Fresh/empty grids start as a single empty cell (2026-07-03, per user) —
          // the snap/arrow-key workflow grows the grid from there.
          const newGrid = await Grid.create({ rows: 1, cols: 1, rowSizes: [], colSizes: [], userId, name: "" });
          nextId = newGrid._id.toString();
        }
        // Tell the client to reload with the new grid
        socket.emit("grid_deleted", { gridId, nextGridId: nextId });
      }
    } catch (err) {
      console.error("delete_grid error:", err);
      socket.emit("server_error", "Failed to delete grid");
    }
  });

  // ── MODULE ─────────────────────────────────────────────────
  socket.on("create_module", async ({ module: moduleData } = {}) => {
    try {
      if (!userId) return;
      const uc = await getUc();
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
      const uc = await getUc();
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
      const uc = await getUc();
      if (uc.modulesById?.[moduleId]) delete uc.modulesById[moduleId];
      await Module.findOneAndDelete({ id: moduleId, userId });

      const moduleOccurrences = Object.values(uc.occurrencesById || {}).filter(
        (occ) => occ.moduleId === moduleId
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
  setupOccurrencesCRUD(socket, userId, getUc, { userRoom, createOccurrenceData });

  socket.on("delete_occurrence", async (payload = {}) => {
    const { occurrenceId } = payload;
    try {
      if (!userId || !occurrenceId) return;
      const uc = await getUc();

      // Recursively collect all descendant occurrence IDs.
      // Only cascade through children whose canonical parentId matches the
      // node being deleted — multi-parented children (referenced via
      // occurrences[] but with a different parentId) survive and get
      // detached by the cleanup loop below. Without this guard, deleting a
      // day-col in the multi-day Schedule would wipe the shared slots/Due
      // that are also pinned to the Schedule page itself.
      const toDelete = new Set();
      function collectDescendants(id) {
        toDelete.add(id);
        const occ = uc.occurrencesById?.[id];
        if (occ?.occurrences) {
          for (const childId of occ.occurrences) {
            const child = uc.occurrencesById?.[childId];
            if (child && child.parentId === id) collectDescendants(childId);
          }
        }
      }
      collectDescendants(occurrenceId);

      // Delete all collected occurrences from cache + DB. Every one is
      // snapshotted BEFORE deletion — a cascade delete of a 50-node subtree
      // records 50 `before`s, and undo restores the whole subtree. This is the
      // case an inverse-op design could never get right.
      const deletedParentId = uc.occurrencesById[occurrenceId]?.parentId;
      for (const id of toDelete) {
        // Warm cache FIRST — it is authoritative for reads (loadUserIntoCache
        // populates it fully). Reading the DB here instead added one Atlas
        // round trip PER NODE, so deleting a 50-node subtree paid 50 extra
        // round trips before a single delete ran. DB only on a cache miss.
        const before = uc.occurrencesById[id]
          || (await Occurrence.findOne({ id, userId }).lean())
          || null;
        delete uc.occurrencesById[id];
        await Occurrence.findOneAndDelete({ id, userId });
        recordChange({ model: "occurrence", id, before, after: null, payload, label: "Deleted item" });
        socket.to(userRoom(userId)).emit("occurrence_deleted", { occurrenceId: id });
      }

      // Clean up parent occurrence references
      for (const occ of Object.values(uc.occurrencesById || {})) {
        if (!Array.isArray(occ.occurrences)) continue;
        if (!occ.occurrences.some(id => toDelete.has(id))) continue;
        const next = { ...occ, occurrences: occ.occurrences.filter(id => !toDelete.has(id)) };
        recordChange({ model: "occurrence", id: next.id, before: occ, after: next, payload });
        uc.occurrencesById[next.id] = next;
        await Occurrence.findOneAndUpdate({ id: next.id, userId }, next, { upsert: true });
        socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: next });
      }

      // Clean up grid.occurrences if this was a panel occurrence
      const activeGridId = socket.data.activeGridId;
      if (activeGridId) {
        const gridDoc = await Grid.findOne({ _id: activeGridId, userId }).lean();
        if (gridDoc?.occurrences?.includes(occurrenceId)) {
          const updated = gridDoc.occurrences.filter(id => id !== occurrenceId);
          await Grid.findOneAndUpdate({ _id: activeGridId, userId }, { occurrences: updated });
          socket.to(userRoom(userId)).emit("grid_updated", { gridId: activeGridId, grid: { occurrences: updated } });
        }
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
      const uc = await getUc();
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
      const uc = await getUc();
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
      const uc = await getUc();
      const gridId = socket.data.activeGridId || instance.gridId;

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
      const containerOcc = Object.values(uc.occurrencesById || {}).find(o => o.moduleId === containerId);
      const occId = requestedOccId || `occ_${Date.now()}_${Math.random().toString(36).slice(2)}`;

      const occurrenceData = createOccurrenceData({
        id: occId, userId, gridId,
        moduleId: instance.id,
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
      const uc = await getUc();
      const id = field?.id;
      const gridId = field?.gridId;
      if (!id || !gridId) return;
      const fieldData = {
        id, userId, gridId,
        name: field.name || "Untitled", type: field.type || "text",
        inputEnabled: field.inputEnabled !== false,
        displayEnabled: field.displayEnabled === true,
        displayConfig: field.displayConfig || {},
        unit: field.unit,
        meta: field.meta || {},
        folderId: field.folderId || null,
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
      const uc = await getUc();
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
      const uc = await getUc();
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
      const uc = await getUc();
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
      const uc = await getUc();
      const id = operation?.id;
      if (!id) return;

      // Cross-device scheduler guard: if this update is bumping
      // `schedule.lastFiredAt`, reject when the stored timestamp is
      // already >= incoming. This is the lock that prevents two clients
      // from both firing the same scheduled op in the same window —
      // whichever socket reaches the server first wins, the other is
      // a no-op. Broadcast still goes out so the loser's local cache
      // catches up.
      const incomingLastFired = operation?.schedule?.lastFiredAt;
      if (incomingLastFired) {
        const stored = uc.operationsById[id]?.schedule?.lastFiredAt;
        if (stored && new Date(stored).getTime() >= new Date(incomingLastFired).getTime()) {
          // Echo current state so the late client syncs up.
          socket.emit("operation_updated", { operation: uc.operationsById[id] });
          return;
        }
      }

      const next = { ...(uc.operationsById[id] || {}), ...operation, id, userId };
      uc.operationsById[id] = next;
      await Operation.findOneAndUpdate({ id, userId }, next, { upsert: true });
      // Broadcast to other sockets in the user room. Originator already has
      // the update applied locally (optimistic write before socket emit).
      socket.to(userRoom(userId)).emit("operation_updated", { operation: next });
    } catch (err) {
      console.error("update_operation error:", err);
      socket.emit("server_error", "Failed to update operation");
    }
  });

  socket.on("delete_operation", async ({ operationId } = {}) => {
    try {
      if (!userId || !operationId) return;
      const uc = await getUc();
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
      const uc = await getUc();
      const existing = Object.values(uc.foldersById || {}).find(f =>
        f.name === folder.name && f.parentId === (folder.parentId || null)
      );
      if (existing) return socket.emit("folder_created", existing);
      const folderData = {
        id: folder.id || crypto.randomUUID(), userId,
        gridId: folder.gridId || socket.data.activeGridId || null,
        name: folder.name,
        parentId: folder.parentId || null,
        folderType: folder.folderType || "normal",
        sortOrder: folder.sortOrder ?? 0,
        isExpanded: folder.isExpanded !== false,
      };
      if (!uc.foldersById) uc.foldersById = {};
      uc.foldersById[folderData.id] = folderData;
      try {
        await Folder.findOneAndUpdate({ id: folderData.id, userId }, folderData, { upsert: true });
      } catch (upsertErr) {
        // Idempotent re-create: a re-import / concurrent create can race the upsert so
        // its {id,userId} filter misses the row at the instant it's inserted, and Mongo
        // attempts a fresh insert → E11000 on the unique `id` index. Mirror setupGenericCRUD:
        // fall back to a plain id-keyed update so the handler STILL SUCCEEDS and reaches the
        // folder_created emits below (without this, the throw skipped them → the originating
        // tab never learned about the folder → it was missing from the manifest tree + the
        // back-breadcrumb couldn't resolve it).
        if (upsertErr.code === 11000) await Folder.findOneAndUpdate({ id: folderData.id }, { $set: folderData });
        else throw upsertErr;
      }
      socket.emit("folder_created", folderData);
      socket.to(userRoom(userId)).emit("folder_created", folderData);
    } catch (err) {
      console.error("create_folder error:", err);
      socket.emit("server_error", "Failed to create folder");
    }
  });

  // ── GENERIC CRUD (Manifest, View, Folder, Operation, Iteration) ────────────
  function setupGenericCRUD(modelName, Model, cacheKey) {
    socket.on(`create_${modelName}`, async (payload = {}) => {
      const entity = payload?.[modelName];
      try {
        if (!userId) return;
        const uc = await getUc();
        const id = entity?.id;
        if (!id) return;
        const next = { ...entity, id, userId };
        // Snapshot BEFORE the cache slot is overwritten — `uc[cacheKey][id]` is
        // the only copy of the prior state, and it is about to be replaced.
        const before = uc[cacheKey][id] || null;
        uc[cacheKey][id] = next;
        try {
          await Model.findOneAndUpdate({ id, userId }, next, { upsert: true });
        } catch (upsertErr) {
          if (upsertErr.code === 11000) {
            await Model.findOneAndUpdate({ id }, { $set: next });
          } else {
            throw upsertErr;
          }
        }
        recordChange({ model: modelName, id, before, after: next, payload });
        socket.to(userRoom(userId)).emit(`${modelName}_created`, { [modelName]: next });
      } catch (err) {
        console.error(`create_${modelName} error:`, err);
        socket.emit("server_error", `Failed to create ${modelName}`);
      }
    });

    socket.on(`update_${modelName}`, async (payload = {}) => {
      const entity = payload?.[modelName];
      try {
        if (!userId) return;
        const uc = await getUc();
        const id = entity?.id;
        if (!id) return;
        const before = uc[cacheKey][id] || null;
        const next = { ...(before || {}), ...entity, id, userId };
        uc[cacheKey][id] = next;
        try {
          await Model.findOneAndUpdate({ id, userId }, next, { upsert: true });
        } catch (upsertErr) {
          // E11000: duplicate key — document exists with same id but different userId (race or data migration).
          // Retry with id-only filter to update the existing record.
          if (upsertErr.code === 11000) {
            await Model.findOneAndUpdate({ id }, { $set: next });
          } else {
            throw upsertErr;
          }
        }
        recordChange({ model: modelName, id, before, after: next, payload });
        socket.to(userRoom(userId)).emit(`${modelName}_updated`, { [modelName]: next });
      } catch (err) {
        console.error(`update_${modelName} error:`, err);
        socket.emit("server_error", `Failed to update ${modelName}`);
      }
    });

    socket.on(`delete_${modelName}`, async (payload = {}) => {
      const entityId = payload?.[`${modelName}Id`];
      try {
        if (!userId) return;
        const uc = await getUc();
        if (!entityId) return;
        // Snapshot before deleting — a delete's `before` is the ONLY thing that
        // can restore it. Warm cache first (authoritative for reads); the DB
        // read is the cache-miss fallback, not the default path.
        const before = uc[cacheKey]?.[entityId]
          || (await Model.findOne({ id: entityId, userId }).lean())
          || null;
        // Folders can be protected (the Templates folder). Throwing here lands
        // in the handler's catch, which emits server_error — the delete simply
        // does not happen.
        if (modelName === "folder") assertNotProtectedFolder(before, "delete");
        if (uc[cacheKey]?.[entityId]) delete uc[cacheKey][entityId];
        await Model.findOneAndDelete({ id: entityId, userId });
        recordChange({ model: modelName, id: entityId, before, after: null, payload });
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
      const patch = {};
      if (activeFilterId !== undefined) patch.activeFilterId = activeFilterId;
      if (activeFilterValues !== undefined) patch.activeFilterValues = activeFilterValues;
      if (!Object.keys(patch).length) return;
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
      const uc = await getUc();
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
    let releasePending = () => {};
    try {
      if (!userId) return;
      if (!moduleData?.id || !occData?.id) return;
      const uc = await getUc();

      // Register the new page occurrence as PENDING before any further await
      // below (the Module/View/Occurrence Mongo round-trips) — a same-tick
      // apply_template targeting this id (ManifestTree/ModulePanel's
      // create-then-apply-template flow, see socketHandlers/templates.js)
      // awaits this instead of racing step 3's warm-cache write. Must stay
      // the FIRST thing after `uc` resolves — see utils/pendingOccCreates.js
      // for why that ordering is what makes this a correctness guarantee
      // rather than a timing hack.
      releasePending = registerPendingOccCreate(uc, occData.id);

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
          moduleId: moduleData.id,
          gridId: occData.gridId,
          fields: occData.fields || {},
        }),
        ...(occData.parentId != null && { parentId: occData.parentId }),
        ...(occData.viewId != null && { viewId: occData.viewId }),
        ...(occData.sortOrder != null && { sortOrder: occData.sortOrder }),
        ...(Array.isArray(occData.occurrences) && { occurrences: occData.occurrences }),
        ...(occData.textmap != null && { textmap: occData.textmap }),
        ...(occData.filterOverride != null && { filterOverride: occData.filterOverride }),
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
    } finally {
      releasePending();
    }
  });

  // delete_page: Removes page occ from panel's occurrences[], deletes occurrence tree, trashes module
  socket.on("delete_page", async ({ pageOccurrenceId, panelOccurrenceId } = {}) => {
    try {
      if (!userId || !pageOccurrenceId) return;
      const uc = await getUc();

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
      if (pageOcc?.moduleId && uc.modulesById[pageOcc.moduleId]) {
        uc.modulesById[pageOcc.moduleId].trashed = true;
        await Module.findOneAndUpdate({ id: pageOcc.moduleId, userId }, { trashed: true });
        socket.to(userRoom(userId)).emit("module_updated", { module: { id: pageOcc.moduleId, trashed: true } });
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
      const uc = await getUc();
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
      const uc = await getUc();
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
      const uc = await getUc();
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
      const uc = await getUc();
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

// ── Standalone occurrence-CRUD setup ──────────────────────────────────────
// Extracted as a named export so unit tests can attach to a mock socket without
// booting the full Express + Socket.io server.
export function setupOccurrencesCRUD(socket, userId, getUc, deps = {}) {
  const userRoomFn = deps.userRoom || ((uid) => `user:${uid}`);

  // Undo/redo capture (see registerCrudHandlers for the contract).
  const broadcastTx = (txJson) => {
    socket.emit("transaction_created", { transaction: txJson });
    socket.to(userRoomFn(userId)).emit("transaction_created", { transaction: txJson });
  };
  const recordChange = ({ model, id, before, after, actionId, label }) => {
    try {
      recordDoc({
        userId, gridId: socket.data.activeGridId,
        actionId: actionId || null, model, id, before, after, label, broadcast: broadcastTx,
      });
    } catch (err) {
      console.error("recordChange failed (continuing):", err?.message || err);
    }
  };
  const createOccurrenceDataFn = deps.createOccurrenceData
    || ((p) => ({ id: p.id, userId: p.userId, moduleId: p.moduleId, gridId: p.gridId, fields: p.fields || {}, meta: p.meta || {}, ...(p.placement && { placement: p.placement }), ...(p.linkedGroupId && { linkedGroupId: p.linkedGroupId }) }));

  // Per-socket Promise chain: serializes create_occurrence so a pipeline that emits
  // 49 events back-to-back persists them in emit order. Without this, concurrent
  // $push calls land on the parent in arbival order — slots showed up randomized.
  let createQueue = Promise.resolve();

  // Cancel queued work after the socket disconnects. Two mechanisms:
  //   1. `disconnected` flag — checked at the start AND mid-handler of
  //      handleCreateOccurrence so queued-but-not-started writes bail
  //      immediately and never touch Atlas.
  //   2. `abortController.signal` — Mongoose 9 honors AbortSignal on
  //      every query/write. Calling `abort()` on disconnect cancels any
  //      Mongo round-trip CURRENTLY IN FLIGHT for this socket, freeing
  //      the connection pool slot the new (reloaded) socket needs for
  //      its request_full_state. Without this, an in-flight upsert can
  //      hold a connection for 30–75s on Atlas Serverless and the new
  //      socket's Grid.findOne queues behind it.
  let disconnected = false;
  const abortController = new AbortController();
  // Shared per-socket signal (see occurrences.js) — a write burst attaches
  // many concurrent 'abort' listeners, tripping Node's default-10 leak
  // heuristic. They clear as each query settles; setting to 0 means
  // unlimited (per Node docs) so the warning never fires for legitimate
  // bursts. A hard cap (100) just bounced the noise to higher counts.
  setMaxListeners(0, abortController.signal);
  socket.on("disconnect", () => {
    disconnected = true;
    abortController.abort();
  });

  socket.on("create_occurrence", (payload = {}) => {
    const { occurrence } = payload;
    createQueue = createQueue
      .then(() => handleCreateOccurrence(occurrence, payload?.__actionId || null))
      .catch(() => {});
    return createQueue;
  });

  // Atomic, idempotent: append child to parent.occurrences[] only when missing.
  // Used by the auto-build pipeline to re-link orphan occurrences (children whose
  // parentId points at a parent whose occurrences[] doesn't include them yet) —
  // the situation when a previous race lost some appends. Serialized through the
  // same per-socket queue so concurrent links from one pipeline don't reorder.
  socket.on("link_occurrence_to_parent", ({ occurrenceId, parentOccurrenceId } = {}) => {
    createQueue = createQueue.then(() => handleLinkToParent(occurrenceId, parentOccurrenceId)).catch(() => {});
    return createQueue;
  });

  async function handleLinkToParent(occurrenceId, parentOccurrenceId) {
    try {
      // Same reasoning as handleCreateOccurrence — cancel queued links on
      // disconnect so the next session's idempotency checks don't race against
      // a draining old queue.
      if (disconnected) return;
      if (!userId || !occurrenceId || !parentOccurrenceId) return;
      const uc = await getUc();
      const updatedParent = await Occurrence.findOneAndUpdate(
        { id: parentOccurrenceId, userId, occurrences: { $ne: occurrenceId } },
        { $push: { occurrences: occurrenceId } },
        { returnDocument: "after", signal: abortController.signal }
      );
      if (!updatedParent) return; // already linked or parent missing — no-op
      const parentObj = typeof updatedParent.toObject === "function" ? updatedParent.toObject() : updatedParent;
      uc.occurrencesById[parentOccurrenceId] = parentObj;
      socket.to(userRoomFn(userId)).emit("occurrence_updated", { occurrence: parentObj });
      socket.emit("occurrence_updated", { occurrence: parentObj });
    } catch (err) {
      // Swallow MongoServerSelectionError/AbortError when disconnected —
      // the cancellation is expected.
      if (disconnected && (err?.name === "MongoServerSelectionError" || err?.name === "AbortError" || /aborted/i.test(err?.message || ""))) return;
      console.error("link_occurrence_to_parent error:", err);
    }
  }

  async function handleCreateOccurrence(occurrence, actionId = null) {
    const _id = occurrence?.id || "?";
    try {
      // Bail on disconnect. Reason: each Build Day run mints fresh UUIDs for its
      // CREATE effects (executor doesn't support deterministic IDs yet). If the
      // user reloads mid-flight, the OLD socket's queue continues draining (this
      // is just a Promise chain — disconnect doesn't kill it) AND the NEW socket
      // fires Build Day again from a partial full_state. Both runs produce the
      // same logical slots with different IDs → duplicates pile up on every
      // reload. Cancelling the rest of the old queue on disconnect lets the new
      // socket's FIND see whatever already persisted and only create what's
      // missing. The maxHttpBufferSize bump in server.js is what prevented this
      // disconnect from happening on a clean first load in the first place.
      if (disconnected) { console.log("🟣 create_occurrence SKIP (disconnected)", _id); return; }
      if (!userId) return;
      console.log("🟣 create_occurrence START", _id, "socket:", socket.id);
      const uc = await getUc();
      const id = occurrence?.id;
      if (!id) return;
      // gridId fallback chain: payload → socket's active grid. Without this, a
      // CREATE_ITEM effect from a pipeline that didn't set state.gridId on its
      // optimistic newOcc emits gridId=undefined, Mongoose fails its `required`
      // validator, the catch block silently drops the write, and the
      // occurrence never persists — so the seed's idempotency FIND on the next
      // reload finds nothing and creates ANOTHER copy. Same fallback as the
      // update_occurrence handler.
      const gridId = occurrence.gridId || socket.data.activeGridId;
      if (!gridId) {
        console.error("create_occurrence: missing gridId for", id);
        return;
      }
      const occurrenceData = {
        ...createOccurrenceDataFn({
          id, userId,
          moduleId: occurrence.moduleId,
          gridId,
          placement: occurrence.placement, fields: occurrence.fields,
          meta: occurrence.meta, linkedGroupId: occurrence.linkedGroupId || null,
        }),
        ...(occurrence.parentId != null && { parentId: occurrence.parentId }),
        ...(occurrence.textmap != null && { textmap: occurrence.textmap }),
        ...(occurrence.viewId != null && { viewId: occurrence.viewId }),
        ...(Array.isArray(occurrence.occurrences) && { occurrences: occurrence.occurrences }),
        // identitySignature drives APPLY_TEMPLATE mode:"merge" idempotency.
        // Without forwarding it here the field is silently dropped on insert and
        // every date-nav re-clones the entire schedule subtree.
        ...(occurrence.identitySignature != null && { identitySignature: occurrence.identitySignature }),
        // filterNavConfig is the per-filter nav widget config keyed by filter id.
        // Same persistence gap as identitySignature — drop it here and HeaderDropdown
        // toggles never survive reload.
        ...(occurrence.filterNavConfig != null && { filterNavConfig: occurrence.filterNavConfig }),
        // filterOverride is set explicitly elsewhere but include it here for the
        // create path (a CREATE_ITEM clone may carry an inherited override).
        ...(occurrence.filterOverride !== undefined && { filterOverride: occurrence.filterOverride }),
        // filters is the per-occurrence FilterEditor list (conditional filters).
        ...(Array.isArray(occurrence.filters) && { filters: occurrence.filters }),
        // hidden/locked/sortOrder/dragMode are also schema fields that flow through
        // create — include them so CREATE_ITEM clones don't drop them.
        ...(typeof occurrence.hidden === "boolean" && { hidden: occurrence.hidden }),
        ...(typeof occurrence.locked === "boolean" && { locked: occurrence.locked }),
        ...(typeof occurrence.sortOrder === "number" && { sortOrder: occurrence.sortOrder }),
        ...(occurrence.dragMode != null && { dragMode: occurrence.dragMode }),
      };
      uc.occurrencesById[id] = occurrenceData;
      // Second disconnect check — between the start gate and the actual
      // Mongo write. The handler may have been queued behind a slow
      // Mongo round-trip (e.g. `await getUc()` cold-cache load) and the
      // socket may have disconnected during that wait. Bailing here saves
      // a Mongo write + the parent.occurrences[] $push that follows,
      // freeing the connection pool for the NEW socket's
      // `request_full_state` query. Diagnostic baseline: a single
      // in-flight create from a disconnected socket held the pool for
      // 30s while the reload's Grid.findOne sat queued.
      if (disconnected) { console.log("🟣 create_occurrence ABORT mid-handler (disconnected)", _id); return; }
      try {
        // AbortSignal cancels the Mongo round-trip if the socket
        // disconnects mid-write. Without this, an in-flight upsert
        // could hold a connection pool slot for 30–75s on Atlas
        // Serverless, blocking the reload's Grid.findOne.
        await Occurrence.findOneAndUpdate(
          { id, userId },
          occurrenceData,
          { upsert: true, signal: abortController.signal }
        );
      } catch (upsertErr) {
        if (disconnected && (upsertErr?.name === "AbortError" || /aborted/i.test(upsertErr?.message || ""))) return;
        // E11000: an update_occurrence raced ahead and already inserted this id.
        // Fall back to id-only $set so the create still persists its data.
        if (upsertErr.code === 11000) {
          await Occurrence.findOneAndUpdate(
            { id },
            { $set: occurrenceData },
            { signal: abortController.signal }
          );
        } else {
          throw upsertErr;
        }
      }
      if (disconnected) return; // bail before the parent push too
      // before:null marks a CREATE — undo deletes the document.
      recordChange({ model: "occurrence", id, before: null, after: occurrenceData, actionId, label: "Created item" });
      socket.to(userRoomFn(userId)).emit("occurrence_created", { occurrence: occurrenceData });

      // ── Auto-push into parent.occurrences[] (atomic — many concurrent
      // creates from a pipeline loop must not clobber each other's appends) ──
      // CRITICAL: do NOT echo the parent update back to the originating socket.
      // The originating client already optimistically appended the new ID to
      // parent.occurrences[] when handling the CREATE_ITEM effect. Echoing the
      // server's snapshot back races with subsequent optimistic appends in the same tick:
      // an echo from create #1 replaces the parent array with [..., #1], wiping
      // out the optimistic [..., #1, #2, #3] state created moments later. Other
      // sockets DO need the broadcast to learn about the structural change.
      if (occurrenceData.parentId) {
        const update = typeof occurrence.insertAtIndex === "number"
          ? { $push: { occurrences: { $each: [id], $position: occurrence.insertAtIndex } } }
          : { $push: { occurrences: id } };
        const updatedParent = await Occurrence.findOneAndUpdate(
          { id: occurrenceData.parentId, userId, occurrences: { $ne: id } },
          update,
          { returnDocument: "after", signal: abortController.signal }
        );
        if (updatedParent) {
          const parentObj = typeof updatedParent.toObject === "function" ? updatedParent.toObject() : updatedParent;
          // The parent's occurrences[] change is its OWN undo step. Restoring a
          // deleted child without restoring the list that names it leaves the
          // child in the data and invisible on screen — the exact "listed but
          // not embedded" class of bug the Daily Question hit on 2026-08-01.
          const parentBefore = {
            ...parentObj,
            occurrences: (parentObj.occurrences || []).filter(c => c !== id),
          };
          recordChange({ model: "occurrence", id: occurrenceData.parentId, before: parentBefore, after: parentObj, actionId });
          uc.occurrencesById[occurrenceData.parentId] = parentObj;
          socket.to(userRoomFn(userId)).emit("occurrence_updated", { occurrence: parentObj });
        }
      }
      console.log("🟣 create_occurrence DONE", _id);
    } catch (err) {
      // Expected when disconnect aborts an in-flight write — not an
      // actual error, just the user reloaded mid-write.
      if (disconnected && (err?.name === "AbortError" || err?.name === "MongoServerSelectionError" || /aborted/i.test(err?.message || ""))) {
        console.log("🟣 create_occurrence ABORT in-flight (disconnected)", _id);
        return;
      }
      console.error("create_occurrence error:", err);
      socket.emit("server_error", "Failed to create occurrence");
    }
  }
}
