// socketHandlers/state.js — request_full_state
// Loads ALL data for the requested grid (grid-scoped cache).
// No priority_state / lazy viewport traversal — everything ships in one emission.
import Grid from "../models/Grid.js";
import User from "../models/User.js";
import { getOccurrencesForGrid } from "../utils/occurrenceHelpers.js";
import { ensureUserManifest } from "../utils/userManifest.js";

export function registerStateHandlers(socket, {
  cacheByUser, gridCacheKey, ensureUserCache, userCacheReady, loadUserIntoCache,
  getAllGridsForUser, userRoom, gridRoom,
}) {
  socket.on("request_full_state", async (payload = {}) => {
    let { gridId } = payload || {};
    const userId = socket.userId;
    if (!userId) return socket.emit("server_error", "Not authenticated");

    const t0 = Date.now();
    const mark = (label) => console.log(`[full_state] +${Date.now() - t0}ms ${label}`);
    try {
      // ── Resolve gridId ────────────────────────────────────────────
      // maxTimeMS guards against a hung query starving the connection pool;
      // socketTimeoutMS in server.js is the broader safety net.
      // Fallback prefers the grid the seed stamped as default (createLiveData
      // sets grid.meta.defaultGrid — 2026-07-03, per user: the site should load
      // the seeded grid ("Poms"), not the oldest grid, when the client's stored
      // gridId is missing/stale after a reseed).
      const fallbackGrid = async () =>
        (await Grid.findOne({ userId, "meta.defaultGrid": true }).maxTimeMS(8000).lean()) ||
        (await Grid.findOne({ userId }).sort({ createdAt: 1 }).lean());
      let gridDoc;
      if (gridId) {
        gridDoc = await Grid.findOne({ _id: gridId, userId }).maxTimeMS(8000).lean();
        if (!gridDoc) gridDoc = await fallbackGrid();
      } else {
        gridDoc = await fallbackGrid();
      }

      if (!gridDoc) {
        // Fresh/empty grids start as a single empty cell (2026-07-03, per user) —
          // the snap/arrow-key workflow grows the grid from there.
          // A nameless grid renders as a blank slot in the toolbar's grid picker, so
          // a brand-new account could not tell what it was looking at or that it was
          // on a grid at all. Named, not seeded: the workspace is still empty, which
          // is the point — nothing is created on the user's behalf.
          const newGrid = await Grid.create({ rows: 1, cols: 1, rowSizes: [], colSizes: [], userId, name: "My grid" });
        gridId = newGrid._id.toString();
        gridDoc = newGrid.toObject();
      }

      gridId = (gridDoc._id || gridDoc.id).toString();

      // Join socket room
      const prev = socket.data.activeGridId;
      if (prev && prev !== gridId) socket.leave(gridRoom(userId, prev));
      socket.join(gridRoom(userId, gridId));
      socket.data.activeGridId = gridId;

      mark("gridDoc resolved");

      // ── Load grid cache (or reuse if already loaded) ──────────────
      const cacheWarm = userCacheReady(userId, gridId);
      const uc = cacheWarm
        ? ensureUserCache(userId, gridId)
        : await loadUserIntoCache(userId, gridId);
      mark(`cache ${cacheWarm ? "WARM" : "COLD"}`);

      // NO TEMPLATES MANIFEST ANY MORE (2026-08-26). `0035` retired it: a
      // template is identified by LOCATION — the children of the one PROTECTED
      // "Templates" folder under the USER manifest — and both ends already
      // agree on that (server utils/templatesFolder.js findTemplatesFolder,
      // client helpers/templateHelpers.js templatesFolderFor, each keying on
      // `meta.protected` + the name). Nothing reads a `manifestType:"templates"`
      // manifest; this call only kept minting a second, empty, top-level
      // "Templates" folder beside the real one on every bootstrap — which is
      // why deleting it never stuck.
      // …and a user manifest + root folder (grids minted outside the seed had
      // none, which killed the manifest tree + folder pages + panel defaults).
      await ensureUserManifest({ gridId, userId, uc, gridDoc });
      mark("manifests ensured");

      const grids = await getAllGridsForUser(userId);
      const allGridOccs = getOccurrencesForGrid(gridId, uc);
      mark(`grids+occs collected (${allGridOccs.length} occs)`);

      // Modules: all modules scoped to this grid. Operations may FIND/CREATE
      // by template label, so unreferenced "stub" templates (e.g. the 48
      // schedule slot containers seeded ahead of time) must be present in
      // $allTemplates — otherwise CREATE re-mints duplicate templates on
      // every load.
      const gridModules = Object.values(uc.modulesById).filter(m => m && m.gridId === gridId);

      console.log(`[full_state] grid=${gridId} — ${allGridOccs.length} occurrences, ${gridModules.length} modules — total ${Date.now() - t0}ms`);

      // The account menu used to print the raw userId — a UUID, which tells
      // nobody which account they are signed into. The email is the one thing
      // a person recognises. Cached on the socket so a grid switch (which
      // re-requests full_state) does not re-query it.
      if (socket.data.userEmail === undefined) {
        try {
          const u = await User.findById(userId).select({ email: 1 }).lean();
          socket.data.userEmail = u?.email || null;
        } catch { socket.data.userEmail = null; }
      }

      socket.emit("full_state", {
        gridId,
        userEmail: socket.data.userEmail,
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
