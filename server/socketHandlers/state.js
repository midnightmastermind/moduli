// socketHandlers/state.js — request_full_state
import Grid from "../models/Grid.js";

export function registerStateHandlers(socket, {
  cacheByUser, ensureUserCache, userCacheReady, loadUserIntoCache,
  getAllGridsForUser, userRoom, gridRoom,
  getOccurrencesForGrid, selectGrid,
}) {
  socket.on("request_full_state", async (payload = {}) => {
    let { gridId } = payload || {};
    const userId = socket.userId;
    if (!userId) return socket.emit("server_error", "Not authenticated");

    try {
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);

      const emitFullState = async (gid) => {
        const grids = await getAllGridsForUser(userId);
        const gridObj = uc.gridsById[gid];
        const safeGrid = gridObj?.toObject ? gridObj.toObject() : gridObj;
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
