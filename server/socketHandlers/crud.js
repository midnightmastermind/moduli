// socketHandlers/crud.js — CRUD for Grid, Module, Occurrence (simple), Field, Operation, Folder + genericCRUD
import { setMaxListeners } from "node:events";
import { filterFieldIdsOf } from "../utils/filterFields.js";
import { refusedDuplicateCreates } from "../utils/duplicateSignature.js";
import { withoutMongoId } from "../utils/mongoId.js";
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
import { classifyFileDelete, filesFolderIdSet } from "../utils/filesFolder.js";
import { recordDoc } from "../utils/txRecorder.js";
import { registerPendingOccCreate } from "../utils/pendingOccCreates.js";
import { planOrphanModules, collectReferencedModuleIds } from "../utils/orphanModules.js";
import { occurrencesEmbedding } from "../utils/scrubEmbeds.js";
import { compressTextmap } from "../utils/textmapCompression.js";

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
      const payload = { grid: { id: gridId, _id: gridId, ...saved } };
      socket.to(userRoom(userId)).emit("grid_created", payload);
      // ...and to the CALLER. Without this the creating client had no signal
      // that the upsert had landed, so "Add new grid" could only guess when to
      // request the new grid's state — and a request that arrives first falls
      // back to the OLD grid (state.js only mints for a user with none). The
      // ack is what makes the switch race-free.
      socket.emit("grid_created", payload);
    } catch (err) {
      console.error("create_grid error:", err);
      socket.emit("server_error", "Failed to create grid");
    }
  });

  // ── ONE DOOR FOR EVERY WRITE THAT CAN CHANGE WHAT THE GRID FILTERS ON ────
  // Three handlers can (`update_grid`, `update_grid_filter`,
  // `update_grid_named_filters`), and the copy-link fan-out reads the answer
  // out of the user cache on the write path. Refreshing it at each of the
  // three separately is the "eighth caller forgets" trap this repo keeps
  // paying for, so they all go through here.
  //
  // The cached grid-filter SOURCE is kept beside the derived set because a
  // patch carries only the half it changes — a namedFilters replacement says
  // nothing about activeFilterValues, and re-deriving from the patch alone
  // would drop the other half's fields.
  async function writeGridPatch(gridId, patch) {
    const updated = await Grid.findOneAndUpdate({ _id: gridId, userId }, patch);
    if (!updated) return null;
    try {
      const uc = ensureUserCache(userId, gridId);
      if (uc) {
        const src = uc.gridFilterSource || {};
        if (patch.activeFilterValues !== undefined) src.activeFilterValues = patch.activeFilterValues;
        if (patch.namedFilters !== undefined) src.namedFilters = patch.namedFilters;
        uc.gridFilterSource = src;
        // Only recompute when the patch actually touched a filter — an
        // unrelated grid write (a layout resize, a rename) must not clobber a
        // set that state.js derived from the full document.
        if (patch.activeFilterValues !== undefined || patch.namedFilters !== undefined) {
          uc.filterFieldIds = filterFieldIdsOf({
            activeFilterValues: src.activeFilterValues,
            namedFilters: src.namedFilters,
          });
        }
      }
    } catch { /* the refresh must never break the write it follows */ }
    return updated;
  }

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
      const updated = await writeGridPatch(gridId, updatePatch);
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
      // A module with NO gridId is invisible to full_state, which is
      // grid-scoped — so the container it describes renders once, disappears on
      // the next load, and leaves a module-less occurrence behind (measured on
      // a fresh account 2026-08-18 via the page's "Add container"). Several
      // client call sites omit it. The socket already knows who it belongs to
      // (userId is stamped here for exactly that reason) and it knows which
      // grid as well, so the same rule covers every caller that forgets.
      // An explicit gridId always wins: a template or import writing into
      // another grid must not be re-homed to the one on screen.
      const gridId = moduleData?.gridId ?? uc.modulesById[id]?.gridId ?? socket.data.activeGridId;
      const next = { ...withoutMongoId(uc.modulesById[id] || {}), ...withoutMongoId(moduleData), id, userId, ...(gridId ? { gridId } : {}) };
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
      const next = { ...withoutMongoId(uc.modulesById[id] || {}), ...withoutMongoId(moduleData), id, userId };
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
          const next = { ...withoutMongoId(occ), occurrences: occ.occurrences.filter(occId => !occurrenceIds.includes(occId)) };
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
    const { occurrenceId, fromParentId = null } = payload;
    try {
      if (!userId || !occurrenceId) return;
      // Creates log START/DONE; deletes logged NOTHING, so the server's own log
      // could not answer "was this row swept, or did it never persist?" — two
      // failure modes that look identical from the database afterwards. That
      // gap cost a whole diagnosis on 2026-08-21: a grep for deletes returned
      // zero, and the zero was a claim about the log rather than about deletes.
      // The SOCKET matters as much as the id. Two clients on different bundles
      // disagree about what a feed matches, so one deletes what the other mints —
      // and the only way to see that in a log is to know which connection each
      // write came from. Without it, "creates from socket A, deletes from
      // nowhere" reads as one client contradicting itself.
      console.log("🗑  delete_occurrence", occurrenceId,
        fromParentId ? `from ${fromParentId}` : "(whole row)", "socket:", socket.id);
      const uc = await getUc();

      // ── PLACEMENT-DELETE vs FILE-DELETE (plan Task 4 Step 5) ────────────
      // "Remove this from my day page" and "delete this file" are the same
      // gesture on the same row; only `fromParentId` tells them apart. The rule
      // itself lives in utils/filesFolder.js so a call site cannot disagree
      // with it — see that module's header for the per-kind reasoning.
      //
      // This is NOT hypothetical: ten imported Eminem images on poms grid are
      // homed in Files/Images (by migration 0051) AND listed by their section
      // container, so before this branch existed, deleting one off the page
      // took the file with it.
      const doomedOcc = uc.occurrencesById?.[occurrenceId] || null;
      const gridIdForFiles = doomedOcc?.gridId || socket.data.activeGridId;
      const verdict = classifyFileDelete({
        occurrence: doomedOcc,
        fromParentId,
        filesFolderIds: filesFolderIdSet(uc, { gridId: gridIdForFiles, userId }),
      });

      if (verdict.action === "unlink") {
        // Atomic $pull — never a read-modify-write. A sweep of N placements
        // runs N handlers concurrently, and a whole-array write is exactly how
        // the 2026-08-04 dangling-child-ref class was produced.
        const updatedParent = await Occurrence.findOneAndUpdate(
          { id: verdict.parentId, userId },
          { $pull: { occurrences: occurrenceId } },
          { returnDocument: "after" }
        );
        if (updatedParent) {
          const parentObj = typeof updatedParent.toObject === "function"
            ? updatedParent.toObject() : updatedParent;
          const before = uc.occurrencesById[verdict.parentId] || null;
          uc.occurrencesById[verdict.parentId] = parentObj;
          recordChange({ model: "occurrence", id: parentObj.id, before, after: parentObj, payload, label: "Removed from here" });
          socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: parentObj });
          socket.emit("occurrence_updated", { occurrence: parentObj });
        }
        return; // the FILE stays in Files, and every other placement is untouched
      }

      // A file delete removes the copy placements too — "deleting it in Files
      // removes it everywhere" is only true if the copies go with it. Scoped to
      // the same grid so one grid's delete can never reach another's.
      const alsoDelete = verdict.sweepModuleId
        ? Object.values(uc.occurrencesById || {})
            .filter(o => o
              && o.id !== occurrenceId
              && o.moduleId === verdict.sweepModuleId
              && o.gridId === doomedOcc?.gridId)
            .map(o => o.id)
        : [];

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
      for (const id of alsoDelete) collectDescendants(id);

      // Delete all collected occurrences from cache + DB. Every one is
      // snapshotted BEFORE deletion — a cascade delete of a 50-node subtree
      // records 50 `before`s, and undo restores the whole subtree. This is the
      // case an inverse-op design could never get right.
      const deletedParentId = uc.occurrencesById[occurrenceId]?.parentId;
      // Kept so the module-cleanup pass below can read each deleted node's
      // moduleId — by then the occurrence is gone from cache and DB alike.
      const deletedOccSnapshots = new Map();
      for (const id of toDelete) {
        // Warm cache FIRST — it is authoritative for reads (loadUserIntoCache
        // populates it fully). Reading the DB here instead added one Atlas
        // round trip PER NODE, so deleting a 50-node subtree paid 50 extra
        // round trips before a single delete ran. DB only on a cache miss.
        const before = uc.occurrencesById[id]
          || (await Occurrence.findOne({ id, userId }).lean())
          || null;
        deletedOccSnapshots.set(id, before);
        delete uc.occurrencesById[id];
        await Occurrence.findOneAndDelete({ id, userId });
        recordChange({ model: "occurrence", id, before, after: null, payload, label: "Deleted item" });
        socket.to(userRoom(userId)).emit("occurrence_deleted", { occurrenceId: id });
      }

      // ── Clean up parent occurrence references, ATOMICALLY ──────────────
      // `delete_occurrence` is not queued the way create is, so a sweep of N
      // copies runs N handlers concurrently. This used to read each parent,
      // filter it, and write the WHOLE document back. The read is a snapshot
      // taken at loop start, but the write is one `await` per parent — so a
      // handler touching TWO parents holds a stale reference to the second
      // one across the first one's round trip. Two handlers then write
      // conflicting arrays and the later one RESTORES the id the earlier one
      // removed — an id whose occurrence is already deleted. That is the
      // dangling child ref, and it is why it only ever appeared on Schedule
      // Table and Schedule Canvas: they are the only two feeds swept together,
      // so they are the only pair that can be in one cleanup loop at once.
      //
      // `$pull` is applied by Mongo per document at write time, so concurrent
      // deletes compose instead of clobbering. It is also one round trip
      // instead of one per parent.
      const deletedIds = [...toDelete];
      const affectedParents = Object.values(uc.occurrencesById || {})
        .filter(o => Array.isArray(o.occurrences) && o.occurrences.some(id => toDelete.has(id)));
      if (affectedParents.length) {
        await Occurrence.updateMany(
          { userId, occurrences: { $in: deletedIds } },
          { $pull: { occurrences: { $in: deletedIds } } }
        );
        for (const occ of affectedParents) {
          // Re-derive from whatever the cache holds NOW, not from the snapshot
          // taken before the await — another handler may have written since.
          // The filter is idempotent, so applying it to current state is safe.
          const current = uc.occurrencesById[occ.id] || occ;
          const next = { ...current, occurrences: (current.occurrences || []).filter(id => !toDelete.has(id)) };
          recordChange({ model: "occurrence", id: next.id, before: current, after: next, payload });
          uc.occurrencesById[next.id] = next;
          socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: next });
        }
      }

      // ── A DOC THAT EMBEDDED WHAT WAS JUST DELETED ───────────────────────
      // A doc renders its TEXTMAP, so an embed node pointing at a deleted
      // occurrence paints as raw junk — `embed: <uuid>` in the middle of the
      // prose. Seen on claude-grid 2026-08-19 after deleting, through the UI, a
      // container that had been added to a doc page.
      //
      // Scoped to the ids this delete just removed (see utils/scrubEmbeds.js for
      // why that is the difference between this and the 2026-08-01 scrub that
      // was itself the regression). Skipped entirely when nothing embeds them,
      // which is the common case — most deletes are board rows.
      for (const { occ, textmap } of occurrencesEmbedding(uc.occurrencesById, toDelete)) {
        const next = { ...occ, textmap };
        recordChange({ model: "occurrence", id: occ.id, before: occ, after: next, payload });
        uc.occurrencesById[occ.id] = next;
        await Occurrence.findOneAndUpdate(
          { id: occ.id, userId },
          { textmap: compressTextmap(textmap) },
        );
        socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: next });
      }

      // ── THE MODULE BEHIND A DELETED PLACEMENT ───────────────────────────
      // Deleting an occurrence never removed its MODULE, so every delete left
      // a template nothing places. Measured on a grid built by clicking for a
      // few hours: 64 modules for 49 occurrences, 15 orphans, every one of
      // them a row or container that had been deleted or converted. Nothing
      // renders them and nothing warns; they just ship in `full_state` forever.
      //
      // The decision is `planOrphanModules` unchanged — the same predicate
      // `sweepOrphans.js` uses, with its refusals intact (a template ROOT is
      // meant to have no placement; anything an operation or a textmap names
      // is reachable). Re-deriving "is this module dead" here would be a
      // second opinion that drifts from the sweeper's.
      //
      // TWO DELIBERATE DIFFERENCES FROM THE SWEEP:
      //
      //   minAgeMinutes: 0 — the age floor exists because `create_module` and
      //   `create_occurrence` are separate writes and the occurrence create is
      //   QUEUED, so a module minted seconds ago may be waiting for a
      //   placement still in flight. That cannot be this module: we just
      //   deleted its placement, so it HAD one. And an in-flight create for a
      //   SECOND occurrence of the same module is already in the warm cache
      //   (that is the documented phantom behaviour), so the placement scan
      //   below sees it and keeps the module.
      //
      //   Candidates only — the scan is restricted to the modules whose
      //   placements this delete removed, so a delete never walks the whole
      //   module table, and the reference scan runs at all only when a module
      //   actually lost its last placement (a feed copy shares its source's
      //   module, so sweeping copies never reaches this code).
      const candidateIds = new Set();
      for (const id of deletedIds) {
        const mid = deletedOccSnapshots.get(id)?.moduleId;
        if (mid) candidateIds.add(mid);
      }
      const remainingOccs = Object.values(uc.occurrencesById || {});
      for (const o of remainingOccs) if (o?.moduleId) candidateIds.delete(o.moduleId);

      if (candidateIds.size) {
        const candidates = [...candidateIds]
          .map(id => uc.modulesById?.[id])
          .filter(Boolean);
        // Operations first (a handful of documents), then textmaps — the warm
        // cache stores them DECOMPRESSED, so the substring scan is honest here
        // in a way a scan over raw Mongo documents would not be.
        const opDocs = Object.values(uc.operationsById || {});
        const textmaps = remainingOccs.map(o => o?.textmap).filter(Boolean);
        const referencedIds = collectReferencedModuleIds([...opDocs, ...textmaps], candidateIds);
        const { drop } = planOrphanModules({
          modules: candidates,
          occurrences: remainingOccs,
          referencedIds,
          minAgeMinutes: 0,
        });
        for (const mod of drop) {
          const beforeMod = uc.modulesById?.[mod.id] || mod;
          delete uc.modulesById[mod.id];
          await Module.findOneAndDelete({ id: mod.id, userId });
          recordChange({ model: "module", id: mod.id, before: beforeMod, after: null, payload, label: "Deleted item" });
          socket.to(userRoom(userId)).emit("module_deleted", { moduleId: mod.id });
        }
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
        // NO kind. An instance has no sub-types, and getModuleTypeIcon resolves
        // kind before role — so a kind here draws the wrong icon and lands as an
        // `inert-kind` integrity warning (31 of them on a grid built by clicking,
        // measured 2026-08-18). Migration 0003 swept 525 of these off the live
        // grid; this path kept minting them.
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

      // ── A FOLDER IS BORN WITH ITS CARD ────────────────────────────────────
      //
      // A sub-folder renders on its parent's folder PAGE only if it CONTAINS a
      // `role:"page" kind:"folder"` occurrence — that occurrence IS the card,
      // and what a click drills into. A folder created without one is INVISIBLE
      // on its parent's page while still showing in the sidebar tree, which
      // reads `foldersById` directly. That asymmetry is why it reads as data
      // loss when nothing is lost (users reported it 2026-08-24 and again
      // 2026-08-28: *"none of my documents are showing up"*).
      //
      // The client mints one lazily when you VIEW a folder — but only for the
      // DIRECT children of the folder on screen, so a grandchild stays card-less
      // and its parent's preview renders empty until you open that parent too.
      //
      // FIXED HERE BECAUSE THIS IS THE CHOKEPOINT. There are seven client call
      // sites for `createFolder` plus the assistant's `create_folder` tool, and
      // adding a mint to each is the "every X means every X that existed when it
      // ran" trap this file keeps paying for — the eighth caller forgets and the
      // bug returns. The server already stamps `userId`/`gridId` here for
      // exactly that reason (2026-08-18). A folder created by a MIGRATION writes
      // straight to Mongo and bypasses this, which is why the client's
      // mint-on-view stays as the net for legacy rows.
      //
      // Best-effort: a folder that exists without its card is the old behaviour,
      // recoverable on view. Failing the folder itself over its card would be
      // strictly worse.
      try {
        const gid = folderData.gridId;
        // `folderType: "category"` folders are not tree nodes and never render
        // as a card — the same exemption ModulePage and 0272 both make.
        if (gid && folderData.folderType !== "category") {
          const modId = crypto.randomUUID();
          const occId = crypto.randomUUID();
          const cardMod = {
            id: modId, userId, gridId: gid,
            role: "page", kind: "folder", label: folderData.name || "Folder",
          };
          const cardOcc = {
            id: occId, userId, gridId: gid, moduleId: modId, targetId: modId,
            targetType: "module", parentId: folderData.id, sortOrder: -1,
            iteration: { mode: "persistent" }, fields: {}, meta: { folderPage: true },
          };
          if (!uc.modulesById) uc.modulesById = {};
          if (!uc.occurrencesById) uc.occurrencesById = {};
          uc.modulesById[modId] = cardMod;
          uc.occurrencesById[occId] = cardOcc;
          await Module.findOneAndUpdate({ id: modId, userId }, cardMod, { upsert: true });
          await Occurrence.findOneAndUpdate({ id: occId, userId }, cardOcc, { upsert: true });
          // BOTH emits, the pattern this file already uses: `socket.to(room)`
          // EXCLUDES the sender, so the originating tab would not learn about
          // the card its own click just created and the folder would look
          // empty until a reload. (That exclusion is the same one behind the
          // 2026-08-07 "the schedule isn't created when I navigate" bug.)
          socket.emit("module_created", { module: cardMod });
          socket.emit("occurrence_created", { occurrence: cardOcc });
          socket.to(userRoom(userId)).emit("module_created", { module: cardMod });
          socket.to(userRoom(userId)).emit("occurrence_created", { occurrence: cardOcc });
        }
      } catch (cardErr) {
        console.error("create_folder: folder-page card failed (folder itself is fine):", cardErr?.message || cardErr);
      }
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
            // A create that never reached Mongo must not stay in the warm
            // cache — the cache outlives the request and is read as truth by
            // later connections. For a MODULE that is the `missing-module`
            // integrity error: the module read as present, so its occurrence
            // was allowed to reference it, and the reference names nothing.
            // Same reasoning as handleCreateOccurrence; identity-checked so a
            // newer write for this id is never dropped.
            if (uc[cacheKey][id] === next) {
              if (before) uc[cacheKey][id] = before; else delete uc[cacheKey][id];
            }
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
      await writeGridPatch(gridId, patch);
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
      await writeGridPatch(gridId, { namedFilters });
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

  // ── Coalescing ──────────────────────────────────────────────────────────
  // A pipeline emits its creates back to back, so by the time the first one is
  // ready to write, the rest have already arrived. Collect whatever is pending
  // and write it as one batch.
  //
  // The drain is scheduled on `setImmediate`, NOT a microtask: socket.io decodes
  // and emits each packet as its own task, so a microtask closes the window
  // after the first event and every batch would be a batch of one. It is not a
  // timer either — a delay would add latency to the single-create case (a drag,
  // a click) to buy nothing.
  //
  // Batching is opportunistic and correctness never depends on catching the
  // whole burst: anything arriving mid-write simply schedules the next batch
  // behind this one on the same queue, which is what preserves order.
  //
  // ONE ORDERING NUANCE, stated rather than glossed: the old chain was strict
  // FIFO across create AND link_occurrence_to_parent. Now a create that arrives
  // while a drain is still pending joins that batch, so it can persist before a
  // link emitted earlier. That is safe because a link only appends an EXISTING
  // occurrence to a parent — it never depends on a later create not having run
  // — and the guarantee that actually matters, creates ordered among themselves
  // within a parent, is exactly what `$each` preserves.
  let pendingCreates = [];
  let drainScheduled = false;

  socket.on("create_occurrence", (payload = {}) => {
    const { occurrence } = payload;
    if (!occurrence) return createQueue;
    pendingCreates.push({ occurrence, actionId: payload?.__actionId || null });
    if (!drainScheduled) {
      drainScheduled = true;
      createQueue = createQueue
        .then(() => new Promise((resolve) => setImmediate(resolve)))
        .then(() => {
          drainScheduled = false;
          const batch = pendingCreates;
          pendingCreates = [];
          return handleCreateBatch(batch);
        })
        .catch(() => {});
    }
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
  // Turns one client payload into the document we persist. Extracted from the
  // old per-create handler UNCHANGED — every spread here is a field that was
  // silently dropped on insert at some point and had to be added back, so the
  // comments travel with it.
  function buildOccurrenceData(occurrence, gridId) {
    return {
      ...createOccurrenceDataFn({
        id: occurrence.id, userId,
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
      // label is the per-PLACEMENT name override, and a row is named
      // `occurrence.label ?? module.label` — so dropping it here silently RENAMES
      // every created copy to its module's generic name. Found on the Completed
      // feed: a copy of "Psych appointment with Angela" came back reading
      // "Appointment", because that is the module label every appointment shares.
      // Third instance of the class the two comments above record.
      ...(occurrence.label != null && { label: occurrence.label }),
      // hidden/locked/sortOrder/dragMode are also schema fields that flow through
      // create — include them so CREATE_ITEM clones don't drop them.
      ...(typeof occurrence.hidden === "boolean" && { hidden: occurrence.hidden }),
      ...(typeof occurrence.locked === "boolean" && { locked: occurrence.locked }),
      ...(typeof occurrence.sortOrder === "number" && { sortOrder: occurrence.sortOrder }),
      ...(occurrence.dragMode != null && { dragMode: occurrence.dragMode }),
    };
  }

  // ASK THE SIGNAL, NOT THE ERROR. Verified against a real Atlas: aborting a
  // bulkWrite mid-flight cancels the write (nothing persists, the pool slot is
  // freed) but surfaces as a **TypeError** reading "Cannot set property name of
  // which has only a getter" — a driver artifact, not an AbortError. Matching
  // that string would be brittle AND would swallow genuine TypeErrors, so the
  // check asks the controller we aborted ourselves. The name checks stay for
  // findOneAndUpdate, which does reject with a proper AbortError.
  const isAbort = (err) => abortController.signal.aborted
    || err?.name === "AbortError"
    || err?.name === "MongoServerSelectionError" || /aborted/i.test(err?.message || "");

  // ── The batch ───────────────────────────────────────────────────────────
  // One burst of N creates costs FOUR Atlas round trips instead of 2N:
  //
  //   1. bulkWrite  — every occurrence upserted at once
  //   2. find       — the parents, to learn what they already list
  //   3. bulkWrite  — one $push $each per parent, in emit order
  //   4. find       — the parents again, so the warm cache holds TRUTH rather
  //                   than a locally-derived guess (this is the array behind
  //                   years of dangling-child-ref bugs; it is worth a trip)
  //
  // Measured on the 49-slot schedule build: 98 -> 4.
  async function handleCreateBatch(batch) {
    if (!batch.length) return;
    const ids = batch.map((b) => b.occurrence?.id).filter(Boolean);
    // Every write this batch got as far as putting in the warm cache, so the
    // outer catch can drop them all if nothing reached Mongo.
    let persisted = false;
    const rollbacks = [];
    const rollbackAll = () => { for (const fn of rollbacks) fn(); };
    try {
      // Bail on disconnect. Reason: each Build Day run mints fresh UUIDs for its
      // CREATE effects (executor doesn't support deterministic IDs yet). If the
      // user reloads mid-flight, the OLD socket's queue continues draining (this
      // is just a Promise chain — disconnect doesn't kill it) AND the NEW socket
      // fires Build Day again from a partial full_state. Both runs produce the
      // same logical slots with different IDs → duplicates pile up on every
      // reload. Cancelling the rest of the old queue on disconnect lets the new
      // socket's FIND see whatever already persisted and only create what's
      // missing.
      if (disconnected) { console.log("🟣 create_occurrence SKIP (disconnected)", ids.length); return; }
      if (!userId) return;
      console.log("🟣 create_batch START", ids.length, "socket:", socket.id);

      const uc = await getUc();

      // ---- 0. refuse a create that would duplicate a signed sibling --------
      //
      // The client's FIND can only see the payload it was handed; the server
      // knows what exists. See `utils/duplicateSignature.js` for the
      // measurement and the three narrowings. Refused ids are skipped whole —
      // nothing cached, nothing upserted, no parent `$push` naming them — and
      // the originator is told so its optimistic copy does not linger as a
      // phantom the next parent-list write would launder into a dangling ref.
      const refusedIds = refusedDuplicateCreates(batch, uc.occurrencesById);
      if (refusedIds.size) {
        console.log("🟣 create_batch REFUSED (duplicate signature)", refusedIds.size, [...refusedIds].slice(0, 6));
        for (const rid of refusedIds) io.to(userRoom(userId)).emit("occurrence_deleted", rid);
      }

      // ---- 1. build, cache, and upsert every row in one write --------------
      const rows = [];
      for (const { occurrence, actionId } of batch) {
        const id = occurrence?.id;
        if (!id) continue;
        if (refusedIds.has(id)) continue;
        // gridId fallback chain: payload → socket's active grid. Without this, a
        // CREATE_ITEM effect from a pipeline that didn't set state.gridId on its
        // optimistic newOcc emits gridId=undefined, Mongoose fails its `required`
        // validator, the write is dropped, and the occurrence never persists — so
        // the seed's idempotency FIND on the next reload finds nothing and creates
        // ANOTHER copy.
        const gridId = occurrence.gridId || socket.data.activeGridId;
        if (!gridId) { console.error("create_occurrence: missing gridId for", id); continue; }
        const occurrenceData = buildOccurrenceData(occurrence, gridId);
        uc.occurrencesById[id] = occurrenceData;
        // ── The warm cache must never outlive a create that did not persist ──
        // The cache is populated HERE, before the write, so in-flight reads in
        // the same burst can see the new row. But it also SURVIVES a disconnect
        // (server.js stopped evicting it; it ages out on a 30-minute TTL), and
        // `update_occurrence` decides whether a parent's occurrences[] entry
        // names a real child by looking in this very cache. So a create that
        // bails after this line leaves a phantom that the next connection's
        // parent-list write launders into a PERSISTED dangling child ref — the
        // integrity error swept on 2026-07-29, 07-30, 07-31, 08-03 and 08-04
        // that always came back, because the sweep cleaned the database while
        // the phantom sat in memory. Roll it back on every path that does not
        // reach Mongo. The identity check matters: if another handler has since
        // written this id, that object is real and must not be dropped.
        rollbacks.push(() => {
          if (uc.occurrencesById[id] === occurrenceData) delete uc.occurrencesById[id];
        });
        rows.push({ id, occurrenceData, actionId, insertAtIndex: occurrence.insertAtIndex });
      }
      if (!rows.length) return;

      // Second disconnect check — between the start gate and the actual Mongo
      // write. The batch may have been queued behind a slow round-trip (a cold
      // `getUc()` load) and the socket may have gone away during that wait.
      // Bailing here saves the whole burst and frees the connection pool for the
      // NEW socket's request_full_state.
      if (disconnected) { rollbackAll(); console.log("🟣 create_batch ABORT mid-handler (disconnected)"); return; }

      await upsertRows(rows);
      // Past this point the rows ARE in Mongo, so the cache entries are truthful
      // and must survive even if the parent pushes below are cancelled.
      persisted = true;
      if (disconnected) return;

      for (const { id, occurrenceData, actionId } of rows) {
        // before:null marks a CREATE — undo deletes the document.
        recordChange({ model: "occurrence", id, before: null, after: occurrenceData, actionId, label: "Created item" });
        socket.to(userRoomFn(userId)).emit("occurrence_created", { occurrence: occurrenceData });
      }

      // ---- 2. link every child into its parent ----------------------------
      await linkRowsToParents(rows, uc);
      console.log("🟣 create_batch DONE", ids.length);
    } catch (err) {
      // Expected when disconnect aborts an in-flight write — not an actual
      // error, just the user reloaded mid-write. `persisted` discriminates WHICH
      // write was cancelled: an aborted parent push leaves real rows (keep the
      // cache), an aborted occurrence upsert leaves nothing (drop it).
      if (!persisted) rollbackAll();
      if (disconnected && isAbort(err)) { console.log("🟣 create_batch ABORT in-flight (disconnected)"); return; }
      console.error("create_occurrence error:", err);
      socket.emit("server_error", "Failed to create occurrence");
    }
  }

  // One bulkWrite for the whole batch. `ordered: false` so one bad row cannot
  // stop the other 48 — the old per-create loop had that isolation for free and
  // it must not be lost on the way to a batch.
  async function upsertRows(rows) {
    try {
      await Occurrence.bulkWrite(
        rows.map(({ id, occurrenceData }) => ({
          updateOne: { filter: { id, userId }, update: { $set: occurrenceData }, upsert: true },
        })),
        { ordered: false, signal: abortController.signal }
      );
    } catch (err) {
      if (disconnected && isAbort(err)) throw err;
      // E11000: an update_occurrence raced ahead and already inserted this id
      // under a different filter. Retry exactly those rows on id alone, which is
      // what the per-create path did. Anything else is a real failure.
      const dupIds = new Set((err?.writeErrors || err?.result?.writeErrors || [])
        .filter((e) => (e?.code ?? e?.err?.code) === 11000)
        .map((e) => rows[e?.index ?? e?.err?.index]?.id).filter(Boolean));
      if (!dupIds.size) throw err;
      await Occurrence.bulkWrite(
        rows.filter((r) => dupIds.has(r.id)).map(({ id, occurrenceData }) => ({
          updateOne: { filter: { id }, update: { $set: occurrenceData } },
        })),
        { ordered: false, signal: abortController.signal }
      );
    }
  }

  // ── Auto-push into parent.occurrences[] ─────────────────────────────────
  // Grouped by parent, one $push $each per parent, so a 49-slot day column costs
  // one append instead of 49. ORDER IS THE REASON THE OLD PATH WAS SERIALIZED:
  // `$each` preserves the batch's emit order within a parent, and the batch was
  // assembled in emit order, so the guarantee survives.
  //
  // CRITICAL: do NOT echo the parent update back to the originating socket. The
  // originating client already optimistically appended the new ids when handling
  // the CREATE_ITEM effect. Echoing the server's snapshot back races with
  // subsequent optimistic appends in the same tick. Other sockets DO need the
  // broadcast to learn about the structural change.
  async function linkRowsToParents(rows, uc) {
    // A drag-drop insert names a position. `$each` + `$position` cannot express
    // several different positions in one update, and these arrive one at a time
    // anyway, so they keep the original single-row path.
    const positioned = rows.filter((r) => typeof r.insertAtIndex === "number" && r.occurrenceData.parentId);
    const appended = rows.filter((r) => typeof r.insertAtIndex !== "number" && r.occurrenceData.parentId);

    const byParent = new Map();
    for (const r of appended) {
      const pid = r.occurrenceData.parentId;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid).push(r.id);
    }

    if (byParent.size) {
      const parentIds = [...byParent.keys()];
      const before = await Occurrence.find({ id: { $in: parentIds }, userId })
        .setOptions({ signal: abortController.signal }).lean();
      const beforeById = new Map(before.map((p) => [p.id, p]));
      const ops = [];
      const addedByParent = new Map();
      for (const [pid, childIds] of byParent) {
        const prev = beforeById.get(pid);
        if (!prev) continue;                                   // parent missing — nothing to link into
        const already = new Set(prev.occurrences || []);
        const add = childIds.filter((c) => !already.has(c));    // idempotent, same as the old $ne guard
        if (!add.length) continue;
        addedByParent.set(pid, add);
        ops.push({ updateOne: { filter: { id: pid, userId }, update: { $push: { occurrences: { $each: add } } } } });
      }
      if (ops.length) {
        if (disconnected) return;
        await Occurrence.bulkWrite(ops, { ordered: false, signal: abortController.signal });
        // Re-read rather than derive. The cache is what `update_occurrence`
        // consults to decide whether a child id is real, so a guessed array here
        // is the same class of untruth as the phantom above — and this is the
        // array behind five separate dangling-ref sweeps.
        const after = await Occurrence.find({ id: { $in: [...addedByParent.keys()] }, userId })
          .setOptions({ signal: abortController.signal }).lean();
        for (const parentObj of after) {
          const add = addedByParent.get(parentObj.id) || [];
          // The parent's occurrences[] change is its OWN undo step. Restoring a
          // deleted child without restoring the list that names it leaves the
          // child in the data and invisible on screen — the "listed but not
          // embedded" class the Daily Question hit on 2026-08-01.
          const parentBefore = {
            ...parentObj,
            occurrences: (parentObj.occurrences || []).filter((c) => !add.includes(c)),
          };
          recordChange({ model: "occurrence", id: parentObj.id, before: parentBefore, after: parentObj,
            actionId: rows.find((r) => r.occurrenceData.parentId === parentObj.id)?.actionId || null });
          uc.occurrencesById[parentObj.id] = parentObj;
          socket.to(userRoomFn(userId)).emit("occurrence_updated", { occurrence: parentObj });
        }
      }
    }

    for (const r of positioned) {
      if (disconnected) return;
      const updatedParent = await Occurrence.findOneAndUpdate(
        { id: r.occurrenceData.parentId, userId, occurrences: { $ne: r.id } },
        { $push: { occurrences: { $each: [r.id], $position: r.insertAtIndex } } },
        { returnDocument: "after", signal: abortController.signal }
      );
      if (!updatedParent) continue;
      const parentObj = typeof updatedParent.toObject === "function" ? updatedParent.toObject() : updatedParent;
      const parentBefore = { ...parentObj, occurrences: (parentObj.occurrences || []).filter((c) => c !== r.id) };
      recordChange({ model: "occurrence", id: parentObj.id, before: parentBefore, after: parentObj, actionId: r.actionId });
      uc.occurrencesById[parentObj.id] = parentObj;
      socket.to(userRoomFn(userId)).emit("occurrence_updated", { occurrence: parentObj });
    }
  }
}
