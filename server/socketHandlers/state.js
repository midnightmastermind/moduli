// socketHandlers/state.js — request_full_state
// Loads ALL data for the requested grid (grid-scoped cache).
// No priority_state / lazy viewport traversal — everything ships in one emission.
import Grid from "../models/Grid.js";
import { getOccurrencesForGrid } from "../utils/occurrenceHelpers.js";

export function registerStateHandlers(socket, {
  cacheByUser, gridCacheKey, ensureUserCache, userCacheReady, loadUserIntoCache,
  getAllGridsForUser, userRoom, gridRoom,
}) {
  socket.on("request_full_state", async (payload = {}) => {
    let { gridId } = payload || {};
    const userId = socket.userId;
    if (!userId) return socket.emit("server_error", "Not authenticated");

    try {
      // ── Resolve gridId ────────────────────────────────────────────
      let gridDoc;
      if (gridId) {
        gridDoc = await Grid.findOne({ _id: gridId, userId }).lean();
        if (!gridDoc) {
          gridDoc = await Grid.findOne({ userId }).sort({ createdAt: 1 }).lean();
        }
      } else {
        gridDoc = await Grid.findOne({ userId }).sort({ createdAt: 1 }).lean();
      }

      if (!gridDoc) {
        const newGrid = await Grid.create({ rows: 2, cols: 3, rowSizes: [], colSizes: [], userId, name: "" });
        gridId = newGrid._id.toString();
        gridDoc = newGrid.toObject();
      }

      gridId = (gridDoc._id || gridDoc.id).toString();

      // Join socket room
      const prev = socket.data.activeGridId;
      if (prev && prev !== gridId) socket.leave(gridRoom(userId, prev));
      socket.join(gridRoom(userId, gridId));
      socket.data.activeGridId = gridId;

      // ── Load grid cache (or reuse if already loaded) ──────────────
      const uc = userCacheReady(userId, gridId)
        ? ensureUserCache(userId, gridId)
        : await loadUserIntoCache(userId, gridId);

      const grids = await getAllGridsForUser(userId);
      const allGridOccs = getOccurrencesForGrid(gridId, uc);

      // Modules: only those referenced by this grid's occurrences
      const gridModuleIds = new Set(allGridOccs.map(o => o.targetId).filter(Boolean));
      const gridModules = [...gridModuleIds].map(id => uc.modulesById[id]).filter(Boolean);

      console.log(`[full_state] grid=${gridId} — ${allGridOccs.length} occurrences, ${gridModules.length} modules`);

      socket.emit("full_state", {
        gridId,
        grid: gridDoc,
        modules: gridModules,
        occurrences: allGridOccs,
        fields: Object.values(uc.fieldsById),
        manifests: Object.values(uc.manifestsById),
        views: Object.values(uc.viewsById),
        folders: Object.values(uc.foldersById),
        operations: Object.values(uc.operationsById),
        grids,
      });

    } catch (err) {
      console.error("request_full_state error:", err);
      socket.emit("server_error", "Failed to load state");
    }
  });
}
