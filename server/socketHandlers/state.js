// socketHandlers/state.js — request_full_state
import Grid from "../models/Grid.js";

export function registerStateHandlers(socket, {
  cacheByUser, ensureUserCache, userCacheReady, loadUserIntoCache,
  getAllGridsForUser, userRoom, gridRoom,
  getOccurrencesForGrid, selectGrid,
}) {
  socket.on("request_full_state", async (payload = {}) => {
    let { gridId, previewOcc } = payload || {};
    const userId = socket.userId;
    if (!userId) return socket.emit("server_error", "Not authenticated");

    try {
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);

      const emitFullState = async (gid) => {
        const grids = await getAllGridsForUser(userId);
        const gridObj = uc.gridsById[gid];
        const safeGrid = gridObj?.toObject ? gridObj.toObject() : gridObj;

        // When previewOcc is set, only send the occurrence subtree needed for that preview
        if (previewOcc) {
          const subtree = collectOccurrenceSubtree(previewOcc, uc);
          const modIds = new Set();
          const viewIds = new Set();
          for (const occ of subtree) {
            if (occ.targetId) modIds.add(occ.targetId);
            if (occ.viewId) viewIds.add(occ.viewId);
          }
          const modules = [...modIds].map(id => uc.modulesById[id]).filter(Boolean);
          const views = [...viewIds].map(id => uc.viewsById[id]).filter(Boolean);
          console.log(`[emitFullState:preview] Sending ${subtree.length} occurrences, ${modules.length} modules for previewOcc=${previewOcc}`);
          socket.emit("full_state", {
            gridId: gid, grid: safeGrid,
            modules,
            occurrences: subtree,
            fields: Object.values(uc.fieldsById),
            manifests: [],
            views,
            folders: [],
            operations: [],
            grids,
          });
          return;
        }

        const gridOccurrences = getOccurrencesForGrid(gid, uc);
        console.log(`[emitFullState] Sending ${gridOccurrences.length} occurrences, ${Object.keys(uc.modulesById).length} modules`);
        socket.emit("full_state", {
          gridId: gid, grid: safeGrid,
          modules: Object.values(uc.modulesById),
          occurrences: gridOccurrences,
          fields: Object.values(uc.fieldsById),
          manifests: Object.values(uc.manifestsById),
          views: Object.values(uc.viewsById),
          folders: Object.values(uc.foldersById),
          operations: Object.values(uc.operationsById),
          grids,
        });
      };

      // Collect an occurrence and all its descendants for preview.
      // Also collects folder siblings (occurrences sharing the same parentId as root).
      function collectOccurrenceSubtree(rootOccId, uc) {
        const result = [];
        const seen = new Set();
        const queue = [rootOccId];
        const rootOcc = uc.occurrencesById[rootOccId];

        // For folder pages, also include siblings that share the same parentId (folder contents)
        if (rootOcc?.parentId) {
          for (const candidate of Object.values(uc.occurrencesById)) {
            if (candidate.parentId === rootOcc.parentId && candidate.id !== rootOccId && !seen.has(candidate.id)) {
              queue.push(candidate.id);
            }
          }
        }

        while (queue.length > 0) {
          const id = queue.shift();
          if (seen.has(id)) continue;
          seen.add(id);
          const occ = uc.occurrencesById[id];
          if (!occ) continue;
          result.push(occ);
          // Add children from occurrences[] array
          if (Array.isArray(occ.occurrences)) {
            for (const childId of occ.occurrences) {
              if (!seen.has(childId)) queue.push(childId);
            }
          }
          // Add children linked via parentId
          for (const candidate of Object.values(uc.occurrencesById)) {
            if (candidate.parentId === id && !seen.has(candidate.id)) {
              queue.push(candidate.id);
            }
          }
        }
        return result;
      }

      if (!gridId) {
        const { gridId: resolved, action } = selectGrid(Object.keys(uc.gridsById), null);
        if (action === "create") {
          console.log("🟨 No grids found — creating new grid for user:", userId);
          const newGrid = await Grid.create({ rows: 2, cols: 3, rowSizes: [], colSizes: [], userId, name: "" });
          gridId = newGrid._id.toString();
          uc.gridsById[gridId] = newGrid.toObject();
          console.log("✅ New grid created:", gridId);
        } else {
          gridId = resolved;
          console.log("🟩 Using existing grid for user:", userId, "→", gridId);
        }
        const prev = socket.data.activeGridId;
        if (prev && prev !== gridId) socket.leave(gridRoom(userId, prev));
        socket.join(gridRoom(userId, gridId));
        socket.data.activeGridId = gridId;
        emitFullState(gridId);
        return;
      }

      if (!uc.gridsById[gridId]) {
        const g = await Grid.findOne({ _id: gridId, userId }).lean();
        if (!g) {
          console.log("❌ Grid not found or unauthorized:", gridId);
          const { gridId: fallback, action } = selectGrid(Object.keys(uc.gridsById), null);
          if (action === "use") {
            const prev = socket.data.activeGridId;
            if (prev && prev !== fallback) socket.leave(gridRoom(userId, prev));
            socket.join(gridRoom(userId, fallback));
            socket.data.activeGridId = fallback;
            return emitFullState(fallback);
          }
          const newGrid = await Grid.create({ rows: 2, cols: 3, rowSizes: [], colSizes: [], userId, name: "" });
          const newId = newGrid._id.toString();
          uc.gridsById[newId] = newGrid.toObject();
          const prev = socket.data.activeGridId;
          if (prev && prev !== newId) socket.leave(gridRoom(userId, prev));
          socket.join(gridRoom(userId, newId));
          socket.data.activeGridId = newId;
          return emitFullState(newId);
        }
        uc.gridsById[gridId] = g;
      }

      {
        const prev = socket.data.activeGridId;
        if (prev && prev !== gridId) socket.leave(gridRoom(userId, prev));
        socket.join(gridRoom(userId, gridId));
        socket.data.activeGridId = gridId;
      }

      console.log("📤 Sending full_state response:", gridId);
      emitFullState(gridId);
    } catch (err) {
      console.error("request_full_state error:", err);
      socket.emit("server_error", "Failed to load state");
    }
  });
}
