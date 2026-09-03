// socketHandlers/state.js — request_full_state
// Loads ALL data for the requested grid (grid-scoped cache).
// No priority_state / lazy viewport traversal — everything ships in one emission.
import Grid from "../models/Grid.js";
import { filterFieldIdsOf } from "../utils/filterFields.js";
import { splitFullState } from "../utils/splitFullState.js";
import { omitNullKeysAll } from "../utils/omitNullKeys.js";
import { makeReferenceTest, projectDeferredRows } from "../utils/deferredProjection.js";

// How long to wait for the client's post-paint request before pushing the
// deferred half anyway. Generous: it is a safety net, not a schedule.
const REST_PUSH_FALLBACK_MS = 6000;

/**
 * Emit the artifact catalogue. Chunked so one 16 MB frame does not simply move
 * the stall from parse to inflate; every module rides with the FIRST chunk,
 * because a placement whose module has not arrived renders nothing while the
 * reverse never happens.
 */
function emitDeferred({ socket, gridId, deferred, deferredModules }) {
  const CHUNK = 4000;
  const chunks = Math.ceil(deferred.length / CHUNK);
  for (let i = 0; i < chunks; i++) {
    socket.emit("full_state_rest", {
      gridId,
      // Absent keys are not sent — 23% of the catalogue is keys that are null
      // on every row. See utils/omitNullKeys.js for the measurement and for why
      // `[]` and `{}` are deliberately kept.
      occurrences: omitNullKeysAll(deferred.slice(i * CHUNK, (i + 1) * CHUNK)),   // already projected
      modules: i === 0 ? omitNullKeysAll(deferredModules) : [],
      chunk: i + 1, chunks, done: i === chunks - 1,
    });
  }
  console.log(`[full_state] deferred ${deferred.length} artifact occurrences + ${deferredModules.length} modules in ${chunks} chunk(s)`);
}
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

      // WHICH FIELDS THIS GRID FILTERS ON — read once here, where the grid
      // document is already in hand, so the occurrence WRITE path never pays a
      // query for it. Consumed by the copy-link fan-out, which must not
      // propagate a per-placement field across placements (utils/filterFields.js).
      uc.filterFieldIds = filterFieldIdsOf(gridDoc);

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

      // PROGRESSIVE: the working surfaces first, the artifact catalogue right
      // behind them. Measured 2026-08-29 at a tablet viewport, full_state was
      // 28.74 MB decompressed and 16.15 MB of that was songs/albums/bookmarks/
      // artists — a catalogue nobody has open, parsed on the main thread on
      // every load. NOTHING IS WITHHELD: the second message follows immediately,
      // so the 19 ops that walk `$allItems` see exactly what they saw before.
      // See utils/splitFullState.js for the measurement and the role rule.
      const { core, deferred, coreModules, deferredModules } =
        splitFullState(allGridOccs, gridModules);

      // ── THE DEFERRED HALF SHIPS PROJECTED ───────────────────────────────
      //
      // The device's load line put nothing between `contentReady=2422ms` and
      // the first chunk at `rest=7571ms` except receiving, inflating and
      // parsing the frame (`restWrite=0ms` — the store write is free). So the
      // cost is the bytes, and these rows carry `fields` and `meta` nothing
      // reads until something renders them.
      //
      // The keep-set is DERIVED from this grid's own declarations — operation
      // pipelines, `optionsSource` predicates, the grid's filters — never
      // written down, so it names no role, kind or field. The rest of a row
      // arrives via `request_occurrence_details` when a renderer asks.
      const isReferenced = makeReferenceTest({
        operations: Object.values(uc.operationsById),
        fields: Object.values(uc.fieldsById),
        grid: gridDoc,
      });
      const deferredProjected = projectDeferredRows(deferred, isReferenced);

      socket.emit("full_state", {
        gridId,
        userEmail: socket.data.userEmail,
        grid: gridDoc,
        modules: omitNullKeysAll(coreModules),
        occurrences: omitNullKeysAll(core),
        fields: Object.values(uc.fieldsById),
        manifests: Object.values(uc.manifestsById),
        views: Object.values(uc.viewsById),
        folders: Object.values(uc.foldersById),
        operations: Object.values(uc.operationsById),
        grids,
        // The client holds its load sweep until the rest lands, so it must know
        // whether to expect a second message at all. 0 = this IS everything.
        deferredCount: deferred.length,
      });

      if (deferred.length) {
        // THE CLIENT ASKS FOR THESE ONCE IT HAS PAINTED, and that is the point.
        // Pushing them in the same tick measured 16.73 MB already received by
        // first paint: the frames arrive back to back and their PARSE competes
        // with the very frame we were trying to free. The client re-requests
        // from `afterPaint`, so the ordering is caused rather than hoped for —
        // no picked delay racing a payload whose size is data-dependent.
        //
        // FAIL OPEN: if no request arrives (an older tab, a client that never
        // paints) they are pushed anyway. A grid missing its catalogue forever
        // is far worse than one that loads it a beat early.
        const send = () => emitDeferred({ socket, gridId, deferred: deferredProjected, deferredModules });
        let sent = false;
        const once = () => { if (sent) return; sent = true; clearTimeout(safety); socket.off("request_full_state_rest", onAsk); send(); };
        const onAsk = (p = {}) => { if (!p.gridId || p.gridId === gridId) once(); };
        socket.once("request_full_state_rest", onAsk);
        const safety = setTimeout(once, REST_PUSH_FALLBACK_MS);
        socket.once("disconnect", () => clearTimeout(safety));
      }

    } catch (err) {
      console.error("request_full_state error:", err);
      socket.emit("server_error", "Failed to load state");
    }
  });

  // ── THE REST OF A PROJECTED ROW, WHEN A RENDERER ASKS ────────────────────
  //
  // The deferred catalogue ships projected (utils/deferredProjection.js): every
  // row carries what the grid's declarations reference and nothing else. That
  // serves the load sweep and every dropdown; it does not serve DRAWING a row,
  // which needs its cover, its URL, its artist. The client asks for those when
  // something actually renders, batched (helpers/occurrenceHydration.js).
  //
  // SERVED FROM THE WARM CACHE, never from Mongo: these rows were in memory
  // moments ago to be projected, and a per-render database read on a grid this
  // size is exactly the cold-read cost the prewarm exists to avoid.
  //
  // BOUNDED, because the id list arrives from a client: a board open asks for
  // about a screenful (renderWindow virtualises above 120 rows), so a cap well
  // clear of that costs nothing legitimate and stops one frame asking for all
  // 15,708.
  socket.on("request_occurrence_details", async ({ gridId, ids } = {}) => {
    try {
      if (!Array.isArray(ids) || !ids.length) return;
      // The same accessor the load path uses. `getUserCache` does not exist —
      // reading what `registerStateHandlers` destructures is what caught it,
      // which is the `watchRegion is not defined` class this repo has shipped
      // twice: a build resolves imports, not undefined locals.
      const gid = gridId || socket.data?.activeGridId;
      if (!gid || !userCacheReady(socket.userId, gid)) return;   // never a cold read on a render
      const uc = ensureUserCache(socket.userId, gid);
      if (!uc) return;
      const wanted = ids.slice(0, 500);
      const out = [];
      for (const id of wanted) {
        const occ = uc.occurrencesById?.[id];
        // A row from another grid must never cross over on a shared cache.
        if (!occ || (occ.gridId && String(occ.gridId) !== String(gid))) continue;
        out.push(occ);
      }
      // ALWAYS REPLY, even with nothing: the client releases these ids on the
      // response, and a silent drop would leave them pending forever — every
      // later render seeing a partial row it can never ask about again.
      socket.emit("occurrence_details", { gridId: gid, ids: wanted, occurrences: omitNullKeysAll(out) });
    } catch (err) {
      console.error("request_occurrence_details error:", err);
      socket.emit("occurrence_details", { gridId, ids: Array.isArray(ids) ? ids.slice(0, 500) : [], occurrences: [] });
    }
  });
}
