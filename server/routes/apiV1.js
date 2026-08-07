// routes/apiV1.js
//
// /api/v1 REST surface. Per docs/api-plan.md §1.
//
// selfBaseUrl: the assistant tools call the app's OWN API. Behind a proxy
// (nginx / Cloudflare) `req.protocol` is "http", so building the base URL from
// it makes the server POST to http://<host>/... which the proxy 301-redirects
// to https → fetch downgrades the POST to a GET → the SPA catch-all returns
// index.html and the import silently no-ops. Calling ourselves on loopback
// skips the proxy (and its redirect) entirely. Override with ASSISTANT_BASE_URL.
//
// Phase 1: auth + read grid state + write single field + sync op invoke.
// Phase 2: full CRUD for modules/occurrences/fields/operations,
//          bulk field-write, batch endpoint, pagination.
// Phase 3 (this file): Secrets Store + server-side executor fallback
//                      for /operations/:id/run (no browser tab needed
//                      for CALL_API ops) + OpenAPI doc + per-token
//                      rate limiting.
//
// Each handler maps 1:1 to a socket event the existing CRUD layer already
// understands — REST is a thin HTTP wrapper that also broadcasts the
// resulting change to the user's socket room so connected clients sync.

import express from "express";
import crypto from "crypto";
import Grid from "../models/Grid.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";
import Field from "../models/Field.js";
import Operation from "../models/Operation.js";
import Secret, { encryptValue, isSecretsKeyConfigured } from "../models/Secret.js";
import Folder from "../models/Folder.js";
import View from "../models/View.js";
import Manifest from "../models/Manifest.js";
import { cloneSubtree } from "../utils/cloneSubtree.js";

import { apiAuth } from "../middleware/apiAuth.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { idempotency } from "../middleware/idempotency.js";
import { runOperationServerSide } from "../services/serverExecutor.js";
import { buildOpenApiDoc } from "./apiV1OpenApi.js";
import { verifyToken } from "../utils/jwts.js";
import ApiToken from "../models/ApiToken.js";

// Loopback base for the assistant's self-calls (see header comment).
const SELF_BASE_URL =
  process.env.ASSISTANT_BASE_URL || `http://127.0.0.1:${process.env.PORT || 5000}`;

const uid = () => crypto.randomUUID();

// Name an imported page from its own <title> when the caller didn't supply one,
// so a converted link reads as the article rather than as its URL.
function deriveTitleFromHtml(html) {
  const m = /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(String(html || ""));
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}
const err = (res, status, code, message, details) =>
  res.status(status).json({ error: code, message, ...(details ? { details } : {}) });

// Paginate via ?limit=N&cursor=<base64-encoded id>. Returns
// `{ items, nextCursor }`. Cursor encodes the last `_id`; next page is
// `_id > cursor`. Limit capped at 500.
function paginate(items, { limit, cursor }) {
  const cap = Math.max(1, Math.min(500, Number(limit) || 100));
  let start = 0;
  if (cursor) {
    try {
      const decoded = Buffer.from(String(cursor), "base64").toString("utf8");
      const idx = items.findIndex(x => x.id === decoded || x._id?.toString?.() === decoded);
      if (idx >= 0) start = idx + 1;
    } catch { /* invalid cursor → restart */ }
  }
  const slice = items.slice(start, start + cap);
  const last = slice[slice.length - 1];
  const nextCursor = (slice.length === cap && last)
    ? Buffer.from(String(last.id || last._id), "utf8").toString("base64")
    : null;
  return { items: slice, nextCursor, total: items.length };
}

// Which warm-cache bucket each model lives in (see mirrorToCache below).
const CACHE_BUCKET = {
  occurrence: "occurrencesById",
  module: "modulesById",
  field: "fieldsById",
  view: "viewsById",
  folder: "foldersById",
  manifest: "manifestsById",
  operation: "operationsById",
};

export function makeApiV1Router({ getUserCache, peekUserCache, io, userRoom, opRunBridge }) {
  const router = express.Router();

  // Per-token rate limit (600 req/min) + Idempotency-Key support.
  // Composed with apiAuth so they run AFTER auth has set req.apiToken.
  // Each protected route uses `authAndLimit(...)` instead of bare auth.
  const limiter = rateLimit();
  const idem = idempotency();
  const authAndLimit = (opts) => [apiAuth(opts), limiter, idem];

  // ====================================================================
  // WRITE-PATH INVARIANTS
  //
  // Two things every REST write must do that a bare Mongo write does not.
  // Both were missing until 2026-08-07, which is why REST-created rows
  // could be invisible in the app.
  // ====================================================================

  // (1) MIRROR INTO THE WARM CACHE.
  // `request_full_state` is served entirely from the per-(user,grid) warm
  // cache, which lives for 30 minutes — so a row written only to Mongo does
  // not appear on the next page load, and worse, the socket write path merges
  // over `uc[bucket][id]`, so a later in-app edit republishes the stale copy
  // on top of the REST write. utils/persistImport.js already mirrors for the
  // import routes; this is the same discipline for CRUD.
  //
  // Only mirrors when the cache is ALREADY warm: a cold cache holds nothing
  // stale (the next load reads Mongo), so paying a full-grid load per write
  // would be cost with no correctness gain.
  const mirrorToCache = (userId, gridId, model, doc) => {
    if (!doc?.id || !gridId) return;
    const uc = peekUserCache?.(userId, gridId);
    if (!uc) return;
    const bucket = CACHE_BUCKET[model];
    if (bucket && uc[bucket]) uc[bucket][doc.id] = doc;
  };

  const evictFromCache = (userId, gridId, model, id) => {
    if (!id || !gridId) return;
    const uc = peekUserCache?.(userId, gridId);
    if (!uc) return;
    const bucket = CACHE_BUCKET[model];
    if (bucket && uc[bucket]) delete uc[bucket][id];
  };

  // (2) MAINTAIN THE PARENT'S RENDER LIST.
  // `parentId` alone does NOT make a child appear — every renderer reads the
  // parent's `occurrences[]` array. A create that sets parentId and stops is
  // the documented "created-but-unlinked" bug: present in the database,
  // invisible on screen, forever.
  //
  // Always $push / $pull, never a whole-array write: two concurrent ingests
  // into one board would otherwise clobber each other's appends. The
  // `$ne: childId` guard makes the link idempotent, so a retried request is a
  // no-op rather than a duplicate entry. Mirrors socketHandlers/crud.js
  // handleCreateOccurrence, except the broadcast goes to the WHOLE room —
  // there is no originating socket to exclude on an HTTP write.
  const linkIntoParent = async ({ userId, parentId, childId, index }) => {
    if (!parentId || !childId) return null;
    const update = Number.isInteger(index)
      ? { $push: { occurrences: { $each: [childId], $position: index } } }
      : { $push: { occurrences: childId } };
    const parent = await Occurrence.findOneAndUpdate(
      { id: parentId, userId, occurrences: { $ne: childId } },
      update,
      { returnDocument: "after", lean: true },
    );
    if (parent) {
      mirrorToCache(userId, parent.gridId, "occurrence", parent);
      io.to(userRoom(userId)).emit("occurrence_updated", { occurrence: parent });
    }
    return parent;
  };

  const unlinkFromParent = async ({ userId, parentId, childId }) => {
    if (!parentId || !childId) return null;
    const parent = await Occurrence.findOneAndUpdate(
      { id: parentId, userId, occurrences: childId },
      { $pull: { occurrences: childId } },
      { returnDocument: "after", lean: true },
    );
    if (parent) {
      mirrorToCache(userId, parent.gridId, "occurrence", parent);
      io.to(userRoom(userId)).emit("occurrence_updated", { occurrence: parent });
    }
    return parent;
  };

  // ====================================================================
  // GRIDS
  // ====================================================================

  router.get("/grids", authAndLimit({ requireScope: "read" }), async (req, res) => {
    try {
      const grids = await Grid.find({ userId: req.userId }).sort({ createdAt: 1 }).lean();
      res.json({
        grids: grids.map(g => ({
          id: g._id.toString(),
          name: g.name,
          createdAt: g.createdAt,
        })),
      });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.get("/grids/:id/state", authAndLimit({ requireScope: "read" }), async (req, res) => {
    try {
      const grid = await Grid.findOne({ _id: req.params.id, userId: req.userId }).lean();
      if (!grid) return err(res, 404, "not_found", "Grid not found");
      const uc = await getUserCache(req.userId, req.params.id);
      res.json({
        grid: { ...grid, id: grid._id.toString() },
        modules: Object.values(uc.modulesById),
        occurrences: Object.values(uc.occurrencesById),
        fields: Object.values(uc.fieldsById),
        operations: Object.values(uc.operationsById),
        views: Object.values(uc.viewsById),
        folders: Object.values(uc.foldersById),
        manifests: Object.values(uc.manifestsById),
      });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // Patch grid-level settings: name, dimensions, and the FILTER system
  // (namedFilters + activeFilterId + activeFilterValues) — the big levers for
  // "what's visible / which iteration is active". Whitelisted keys only so a
  // caller can't clobber userId/_id/manifestId.
  router.patch("/grids/:id", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const ALLOWED = new Set(["name", "rows", "cols", "namedFilters", "activeFilterId", "activeFilterValues", "meta", "fieldIds", "templates"]);
      const patch = {};
      for (const [k, v] of Object.entries(req.body || {})) if (ALLOWED.has(k)) patch[k] = v;
      if (Object.keys(patch).length === 0) {
        return err(res, 400, "validation_error", `no patchable keys (allowed: ${[...ALLOWED].join(", ")})`);
      }
      const next = await Grid.findOneAndUpdate(
        { _id: req.params.id, userId: req.userId },
        { $set: patch },
        { returnDocument: "after", lean: true },
      );
      if (!next) return err(res, 404, "not_found", "Grid not found");
      const grid = { ...next, id: next._id.toString() };
      io.to(userRoom(req.userId)).emit("grid_updated", { grid });
      res.json({ grid });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // Apply a saved template subtree under a target occurrence (stamp a
  // routine / day-page / project layout). Mirrors the apply_template socket
  // handler: cloneSubtree → append/replace into target.occurrences → broadcast
  // the new modules/occurrences + parent wiring so clients render the subtree.
  router.post("/templates/apply", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const { templateOccurrenceId, targetOccurrenceId, mode = "append" } = req.body || {};
      if (!templateOccurrenceId || !targetOccurrenceId) {
        return err(res, 400, "validation_error", "templateOccurrenceId + targetOccurrenceId required");
      }
      const target = await Occurrence.findOne({ id: targetOccurrenceId, userId: req.userId });
      if (!target) return err(res, 404, "not_found", "Target occurrence not found");
      const gridId = target.gridId || req.body.gridId;
      const uc = await getUserCache(req.userId, gridId);
      const r = await cloneSubtree({
        rootOccurrenceId: templateOccurrenceId, userId: req.userId, gridId, uc,
        moduleMetaPatch: { templateModule: false },
        occMetaPatch: { appliedFromTemplateId: templateOccurrenceId },
        newParentId: targetOccurrenceId,
      });
      if (!r.rootClonedOccurrenceId) return err(res, 500, "internal_error", "Template apply failed (template not found or empty)");
      const nextOccs = mode === "replace"
        ? [r.rootClonedOccurrenceId]
        : [...(target.occurrences || []), r.rootClonedOccurrenceId];
      await Occurrence.findOneAndUpdate({ id: target.id, userId: req.userId }, { $set: { occurrences: nextOccs } });
      for (const mid of r.moduleIds) { const m = uc.modulesById?.[mid]; if (m) io.to(userRoom(req.userId)).emit("module_created", { module: m }); }
      for (const oid of r.occurrenceIds) { const o = uc.occurrencesById?.[oid]; if (o) io.to(userRoom(req.userId)).emit("occurrence_created", { occurrence: o }); }
      io.to(userRoom(req.userId)).emit("occurrence_updated", { occurrence: { id: target.id, occurrences: nextOccs } });
      res.json({ ok: true, rootOccurrenceId: r.rootClonedOccurrenceId, newOccurrenceIds: r.occurrenceIds, newModuleIds: r.moduleIds });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ====================================================================
  // FOLDERS (manifest-tree organization)
  // ====================================================================
  router.get("/folders", authAndLimit({ requireScope: "read" }), async (req, res) => {
    try {
      const { gridId, parentId } = req.query;
      const filter = { userId: req.userId };
      if (gridId) filter.gridId = gridId;
      if (parentId !== undefined) filter.parentId = parentId === "null" ? null : parentId;
      const folders = await Folder.find(filter).sort({ sortOrder: 1 }).lean();
      res.json({ folders });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });
  router.post("/folders", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const body = req.body || {};
      const id = body.id || uid();
      const doc = await Folder.create({ ...body, id, userId: req.userId });
      io.to(userRoom(req.userId)).emit("folder_created", { folder: doc.toObject() });
      res.status(201).json({ folder: doc.toObject() });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });
  router.patch("/folders/:id", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const next = await Folder.findOneAndUpdate({ id: req.params.id, userId: req.userId }, { $set: req.body || {} }, { returnDocument: "after", lean: true });
      if (!next) return err(res, 404, "not_found", "Folder not found");
      io.to(userRoom(req.userId)).emit("folder_updated", { folder: next });
      res.json({ folder: next });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });
  router.delete("/folders/:id", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const doomed = await Folder.findOneAndDelete({ id: req.params.id, userId: req.userId });
      if (!doomed) return err(res, 404, "not_found", "Folder not found");
      io.to(userRoom(req.userId)).emit("folder_deleted", { folderId: req.params.id });
      res.json({ ok: true });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ====================================================================
  // MANIFESTS (root of a folder tree — rootFolderId anchors where things live)
  // ====================================================================
  router.get("/manifests", authAndLimit({ requireScope: "read" }), async (req, res) => {
    try {
      const filter = { userId: req.userId };
      if (req.query.gridId) filter.gridId = req.query.gridId;
      if (req.query.manifestType) filter.manifestType = req.query.manifestType;
      const manifests = await Manifest.find(filter).lean();
      res.json({ manifests });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });
  router.post("/manifests", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const body = req.body || {};
      const id = body.id || uid();
      const doc = await Manifest.create({ ...body, id, userId: req.userId });
      io.to(userRoom(req.userId)).emit("manifest_created", { manifest: doc.toObject() });
      res.status(201).json({ manifest: doc.toObject() });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });
  router.patch("/manifests/:id", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const next = await Manifest.findOneAndUpdate({ id: req.params.id, userId: req.userId }, { $set: req.body || {} }, { returnDocument: "after", lean: true });
      if (!next) return err(res, 404, "not_found", "Manifest not found");
      io.to(userRoom(req.userId)).emit("manifest_updated", { manifest: next });
      res.json({ manifest: next });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });
  router.delete("/manifests/:id", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const doomed = await Manifest.findOneAndDelete({ id: req.params.id, userId: req.userId });
      if (!doomed) return err(res, 404, "not_found", "Manifest not found");
      io.to(userRoom(req.userId)).emit("manifest_deleted", { manifestId: req.params.id });
      res.json({ ok: true });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ====================================================================
  // VIEWS (render config; activeOccurrenceId = which page a panel shows)
  // ====================================================================
  router.get("/views", authAndLimit({ requireScope: "read" }), async (req, res) => {
    try {
      const filter = { userId: req.userId };
      if (req.query.gridId) filter.gridId = req.query.gridId;
      const views = await View.find(filter).lean();
      res.json({ views });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });
  router.post("/views", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.gridId) return err(res, 400, "validation_error", "gridId required");
      const id = body.id || uid();
      const doc = await View.create({ ...body, id, userId: req.userId });
      io.to(userRoom(req.userId)).emit("view_created", { view: doc.toObject() });
      res.status(201).json({ view: doc.toObject() });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });
  router.patch("/views/:id", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const next = await View.findOneAndUpdate({ id: req.params.id, userId: req.userId }, { $set: req.body || {} }, { returnDocument: "after", lean: true });
      if (!next) return err(res, 404, "not_found", "View not found");
      io.to(userRoom(req.userId)).emit("view_updated", { view: next });
      res.json({ view: next });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });
  router.delete("/views/:id", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const doomed = await View.findOneAndDelete({ id: req.params.id, userId: req.userId });
      if (!doomed) return err(res, 404, "not_found", "View not found");
      io.to(userRoom(req.userId)).emit("view_deleted", { viewId: req.params.id });
      res.json({ ok: true });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ====================================================================
  // MODULES
  // ====================================================================

  router.get("/modules", authAndLimit({ requireScope: "read" }), async (req, res) => {
    try {
      const { gridId, role, kind, q, limit, cursor } = req.query;
      const filter = { userId: req.userId };
      if (gridId) filter.gridId = gridId;
      if (role) filter.role = role;
      if (kind) filter.kind = kind;
      let modules = await Module.find(filter).sort({ createdAt: 1 }).lean();
      if (q) {
        const needle = String(q).toLowerCase();
        modules = modules.filter(m => (m.label || "").toLowerCase().includes(needle));
      }
      const { items, nextCursor, total } = paginate(modules, { limit, cursor });
      res.json({ modules: items, nextCursor, total });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.post("/modules", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.gridId) return err(res, 400, "validation_error", "gridId required");
      const id = body.id || uid();
      const doc = await Module.create({
        ...body,
        id,
        userId: req.userId,
        label: body.label ?? "",
      });
      const modObj = doc.toObject();
      mirrorToCache(req.userId, modObj.gridId, "module", modObj);
      io.to(userRoom(req.userId)).emit("module_created", { module: modObj });
      res.status(201).json({ module: modObj });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.patch("/modules/:id", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const patch = req.body || {};
      const next = await Module.findOneAndUpdate(
        { id: req.params.id, userId: req.userId },
        { $set: patch },
        { returnDocument: "after", lean: true },
      );
      if (!next) return err(res, 404, "not_found", "Module not found");
      mirrorToCache(req.userId, next.gridId, "module", next);
      io.to(userRoom(req.userId)).emit("module_updated", { module: next });
      res.json({ module: next });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.delete("/modules/:id", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const doomed = await Module.findOneAndDelete({ id: req.params.id, userId: req.userId });
      if (!doomed) return err(res, 404, "not_found", "Module not found");
      evictFromCache(req.userId, doomed.gridId, "module", req.params.id);
      io.to(userRoom(req.userId)).emit("module_deleted", { moduleId: req.params.id });
      res.json({ ok: true });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ====================================================================
  // OCCURRENCES
  // ====================================================================

  router.get("/occurrences", authAndLimit({ requireScope: "read" }), async (req, res) => {
    try {
      const { gridId, parentId, moduleId, limit, cursor } = req.query;
      const filter = { userId: req.userId };
      if (gridId) filter.gridId = gridId;
      if (parentId) filter.parentId = parentId;
      if (moduleId) filter.moduleId = moduleId;
      const occs = await Occurrence.find(filter).sort({ createdAt: 1 }).lean();
      const { items, nextCursor, total } = paginate(occs, { limit, cursor });
      res.json({ occurrences: items, nextCursor, total });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.get("/occurrences/:id", authAndLimit({ requireScope: "read" }), async (req, res) => {
    try {
      const occ = await Occurrence.findOne({ id: req.params.id, userId: req.userId }).lean();
      if (!occ) return err(res, 404, "not_found", "Occurrence not found");
      res.json({ occurrence: occ });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.post("/occurrences", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.gridId) return err(res, 400, "validation_error", "gridId required");
      if (!body.moduleId) return err(res, 400, "validation_error", "moduleId required");
      const id = body.id || uid();
      const { insertAtIndex, ...rest } = body;
      const doc = await Occurrence.create({
        ...rest,
        id,
        userId: req.userId,
        fields: body.fields || {},
      });
      const obj = doc.toObject();
      mirrorToCache(req.userId, obj.gridId, "occurrence", obj);
      io.to(userRoom(req.userId)).emit("occurrence_created", { occurrence: obj });
      // Without this the row is invisible: renderers read the parent's
      // occurrences[], not the child's parentId. See linkIntoParent.
      const parent = await linkIntoParent({
        userId: req.userId, parentId: obj.parentId, childId: id, index: insertAtIndex,
      });
      res.status(201).json({ occurrence: obj, linkedToParent: !!parent });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.patch("/occurrences/:id", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const patch = req.body || {};
      // A parentId change is a MOVE, and a move is three writes: re-parent,
      // unlink from the old render list, link into the new one. Patching
      // parentId alone leaves the row rendered in its old home and absent from
      // its new one — the gap the assistant's move_occurrence tool was added to
      // close on 2026-07-18.
      const prev = ("parentId" in patch)
        ? await Occurrence.findOne({ id: req.params.id, userId: req.userId }).lean()
        : null;
      const next = await Occurrence.findOneAndUpdate(
        { id: req.params.id, userId: req.userId },
        { $set: patch },
        { returnDocument: "after", lean: true },
      );
      if (!next) return err(res, 404, "not_found", "Occurrence not found");
      mirrorToCache(req.userId, next.gridId, "occurrence", next);
      io.to(userRoom(req.userId)).emit("occurrence_updated", { occurrence: next });
      if (prev && prev.parentId !== next.parentId) {
        await unlinkFromParent({ userId: req.userId, parentId: prev.parentId, childId: next.id });
        await linkIntoParent({
          userId: req.userId, parentId: next.parentId, childId: next.id, index: patch.insertAtIndex,
        });
      }
      res.json({ occurrence: next });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.delete("/occurrences/:id", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const doomed = await Occurrence.findOneAndDelete({ id: req.params.id, userId: req.userId });
      if (!doomed) return err(res, 404, "not_found", "Occurrence not found");
      evictFromCache(req.userId, doomed.gridId, "occurrence", req.params.id);
      io.to(userRoom(req.userId)).emit("occurrence_deleted", { occurrenceId: req.params.id });
      // Leaving the id in the parent's occurrences[] produces a dangling child
      // ref — the integrity error swept five times in July/August 2026.
      await unlinkFromParent({ userId: req.userId, parentId: doomed.parentId, childId: req.params.id });
      // NOTE: non-cascading, unlike the socket handler — children of a deleted
      // parent keep their rows. Delete leaves first, or use the socket path.
      res.json({ ok: true });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ── PUT /api/v1/occurrences/:id/fields/:fieldId — single field write ──
  router.put("/occurrences/:id/fields/:fieldId", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const { id, fieldId } = req.params;
      const { value, flow } = req.body || {};
      const occ = await Occurrence.findOne({ id, userId: req.userId });
      if (!occ) return err(res, 404, "not_found", "Occurrence not found");
      const prevField = occ.fields?.[fieldId] || {};
      const nextField = { ...prevField, value, ...(flow !== undefined ? { flow } : {}) };
      const nextFields = { ...(occ.fields || {}), [fieldId]: nextField };
      occ.fields = nextFields;
      occ.markModified("fields");
      await occ.save();
      mirrorToCache(req.userId, occ.gridId, "occurrence", occ.toObject());
      io.to(userRoom(req.userId)).emit("occurrence_updated", {
        occurrence: { id: occ.id, fields: nextFields },
      });
      res.json({ ok: true, occurrenceId: id, fieldId, fields: nextFields });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ── PATCH /api/v1/occurrences/:id/fields — bulk field write on one occ ──
  router.patch("/occurrences/:id/fields", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const { id } = req.params;
      const { fields: writes } = req.body || {};
      if (!writes || typeof writes !== "object") {
        return err(res, 400, "validation_error", "Body must be { fields: { <fieldId>: { value, flow? }, ... } }");
      }
      const occ = await Occurrence.findOne({ id, userId: req.userId });
      if (!occ) return err(res, 404, "not_found", "Occurrence not found");
      const next = { ...(occ.fields || {}) };
      for (const [fid, payload] of Object.entries(writes)) {
        const prev = next[fid] || {};
        next[fid] = {
          ...prev,
          value: payload?.value,
          ...(payload?.flow !== undefined ? { flow: payload.flow } : {}),
        };
      }
      occ.fields = next;
      occ.markModified("fields");
      await occ.save();
      mirrorToCache(req.userId, occ.gridId, "occurrence", occ.toObject());
      io.to(userRoom(req.userId)).emit("occurrence_updated", {
        occurrence: { id: occ.id, fields: next },
      });
      res.json({ ok: true, occurrenceId: id, fields: next });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ── POST /api/v1/fields/bulk — write field values across many occs ────
  router.post("/fields/bulk", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const { writes } = req.body || {};
      if (!Array.isArray(writes)) {
        return err(res, 400, "validation_error", "Body must be { writes: [{ occurrenceId, fieldId, value, flow? }, ...] }");
      }
      const results = [];
      const byOccId = new Map();
      for (const w of writes) {
        if (!w?.occurrenceId || !w?.fieldId) {
          results.push({ ok: false, error: "missing occurrenceId/fieldId", input: w });
          continue;
        }
        if (!byOccId.has(w.occurrenceId)) byOccId.set(w.occurrenceId, []);
        byOccId.get(w.occurrenceId).push(w);
      }
      // One DB write per occurrence (not per field) — matches the
      // bulk-write trigger semantics in the API plan.
      for (const [occId, ws] of byOccId.entries()) {
        const occ = await Occurrence.findOne({ id: occId, userId: req.userId });
        if (!occ) {
          for (const w of ws) results.push({ ok: false, error: "not_found", occurrenceId: occId, fieldId: w.fieldId });
          continue;
        }
        const next = { ...(occ.fields || {}) };
        for (const w of ws) {
          const prev = next[w.fieldId] || {};
          next[w.fieldId] = { ...prev, value: w.value, ...(w.flow !== undefined ? { flow: w.flow } : {}) };
          results.push({ ok: true, occurrenceId: occId, fieldId: w.fieldId });
        }
        occ.fields = next;
        occ.markModified("fields");
        await occ.save();
        mirrorToCache(req.userId, occ.gridId, "occurrence", occ.toObject());
        io.to(userRoom(req.userId)).emit("occurrence_updated", {
          occurrence: { id: occ.id, fields: next },
        });
      }
      res.json({ ok: true, results });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ====================================================================
  // FIELDS
  // ====================================================================

  router.get("/fields", authAndLimit({ requireScope: "read" }), async (req, res) => {
    try {
      const { gridId, q, type, limit, cursor } = req.query;
      const filter = { userId: req.userId };
      if (gridId) filter.gridId = gridId;
      if (type) filter.type = type;
      let fields = await Field.find(filter).sort({ name: 1 }).lean();
      if (q) {
        const needle = String(q).toLowerCase();
        fields = fields.filter(f => (f.name || "").toLowerCase().includes(needle));
      }
      const { items, nextCursor, total } = paginate(fields, { limit, cursor });
      res.json({ fields: items, nextCursor, total });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.post("/fields", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.gridId) return err(res, 400, "validation_error", "gridId required");
      if (!body.name) return err(res, 400, "validation_error", "name required");
      const id = body.id || uid();
      const doc = await Field.create({ ...body, id, userId: req.userId });
      const fieldObj = doc.toObject();
      mirrorToCache(req.userId, fieldObj.gridId, "field", fieldObj);
      io.to(userRoom(req.userId)).emit("field_created", { field: fieldObj });
      res.status(201).json({ field: fieldObj });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.patch("/fields/:id", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const next = await Field.findOneAndUpdate(
        { id: req.params.id, userId: req.userId },
        { $set: req.body || {} },
        { returnDocument: "after", lean: true },
      );
      if (!next) return err(res, 404, "not_found", "Field not found");
      mirrorToCache(req.userId, next.gridId, "field", next);
      io.to(userRoom(req.userId)).emit("field_updated", { field: next });
      res.json({ field: next });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.delete("/fields/:id", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const doomed = await Field.findOneAndDelete({ id: req.params.id, userId: req.userId });
      if (!doomed) return err(res, 404, "not_found", "Field not found");
      evictFromCache(req.userId, doomed.gridId, "field", req.params.id);
      io.to(userRoom(req.userId)).emit("field_deleted", { fieldId: req.params.id });
      res.json({ ok: true });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ====================================================================
  // OPERATIONS
  // ====================================================================

  router.get("/operations", authAndLimit({ requireScope: "read" }), async (req, res) => {
    try {
      const { gridId, q, runnable, limit, cursor } = req.query;
      const filter = { userId: req.userId };
      if (gridId) filter.gridId = gridId;
      let ops = await Operation.find(filter).sort({ name: 1 }).lean();
      if (q) {
        const needle = String(q).toLowerCase();
        ops = ops.filter(o => (o.name || "").toLowerCase().includes(needle));
      }
      if (runnable === "true") {
        // Heuristic for "callable from outside" — manual-triggered or
        // explicitly tagged onApiCall. Phase 3 will formalize.
        ops = ops.filter(o =>
          (o.triggerType === "manual") ||
          (Array.isArray(o.triggerTypes) && (o.triggerTypes.includes("manual") || o.triggerTypes.includes("onApiCall")))
        );
      }
      const { items, nextCursor, total } = paginate(ops, { limit, cursor });
      res.json({ operations: items, nextCursor, total });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.post("/operations", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.gridId) return err(res, 400, "validation_error", "gridId required");
      if (!body.name) return err(res, 400, "validation_error", "name required");
      const id = body.id || uid();
      const doc = await Operation.create({ ...body, id, userId: req.userId });
      io.to(userRoom(req.userId)).emit("operation_created", { operation: doc.toObject() });
      res.status(201).json({ operation: doc.toObject() });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.patch("/operations/:id", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const next = await Operation.findOneAndUpdate(
        { id: req.params.id, userId: req.userId },
        { $set: req.body || {} },
        { returnDocument: "after", lean: true },
      );
      if (!next) return err(res, 404, "not_found", "Operation not found");
      io.to(userRoom(req.userId)).emit("operation_updated", { operation: next });
      res.json({ operation: next });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.delete("/operations/:id", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const doomed = await Operation.findOneAndDelete({ id: req.params.id, userId: req.userId });
      if (!doomed) return err(res, 404, "not_found", "Operation not found");
      io.to(userRoom(req.userId)).emit("operation_deleted", { operationId: req.params.id });
      res.json({ ok: true });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ── POST /api/v1/operations/:id/run — synchronous op invocation ──────
  //
  // The headliner. Slice-1 mechanism: emits to the user's socket room,
  // first connected client runs the op via its existing executor (with
  // vars folded into $vars), emits api_op_result back. Bridge resolves
  // the awaiting HTTP Promise.
  router.post("/operations/:id/run", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const { id } = req.params;
      const { vars = {}, wait = true, timeoutMs = 30000, dryRun = false, executor } = req.body || {};
      const op = await Operation.findOne({ id, userId: req.userId }).lean();
      if (!op) return err(res, 404, "not_found", "Operation not found");

      const room = io.sockets.adapter.rooms.get(userRoom(req.userId));
      const hasClient = !!(room && room.size > 0);

      // Executor selection:
      //   - "server"  → always use the headless server executor
      //   - "client"  → require a connected browser tab; 503 if none
      //   - "auto"    → prefer client (full executor), fall back to server
      //                 when no client is connected
      const mode = executor === "server" || executor === "client" ? executor : "auto";
      const useServer = mode === "server" || (mode === "auto" && !hasClient);

      if (useServer) {
        // Server-side execution. CALL_API / INIT_VAR / SHOW_VALUE / IF / LOOP
        // are supported; anything else needs a connected client.
        const result = await runOperationServerSide(op, { vars, userId: req.userId });
        return res.json({
          ...result,
          executor: "server",
          note: result.ok ? undefined : "Server-side executor handles a subset of action types. If the op uses FIND/CREATE/COPY_LINK/etc., open a Moduli tab and retry with executor:'client' (or 'auto').",
        });
      }

      if (!hasClient) {
        return err(res, 503, "no_executor",
          "Op requires the client-side executor (uses action types beyond the server-side subset) and no client is connected. Either open a Moduli tab, run server/scripts/apiDemoClient.js, or retry with executor:'server' if the op only uses CALL_API / INIT_VAR / SHOW_VALUE / IF / LOOP."
        );
      }

      if (!wait) {
        io.to(userRoom(req.userId)).emit("run_op_for_api", {
          requestId: null, operationId: id, vars, dryRun,
        });
        return res.status(202).json({ ok: true, queued: true, executor: "client" });
      }

      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const result = await opRunBridge.await({
        requestId,
        timeoutMs: Math.max(1000, Math.min(60000, Number(timeoutMs) || 30000)),
        emit: () => {
          io.to(userRoom(req.userId)).emit("run_op_for_api", {
            requestId, operationId: id, vars, dryRun,
          });
        },
      });
      res.json({ ...result, executor: "client" });
    } catch (e) {
      if (e?.code === "TIMEOUT") return err(res, 504, "timeout", e.message);
      err(res, 500, "internal_error", e.message);
    }
  });

  // ====================================================================
  // BATCH — pack multiple sub-requests into one round-trip
  // ====================================================================

  router.post("/batch", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const { operations: subs } = req.body || {};
      if (!Array.isArray(subs)) {
        return err(res, 400, "validation_error", "Body must be { operations: [{ method, path, body? }, ...] }");
      }
      // Each sub-request fans out through the same Express router via
      // a synthetic in-process call. Keeps every auth + validation +
      // broadcast guarantee the direct endpoints have.
      const results = [];
      for (const sub of subs) {
        if (!sub?.method || !sub?.path) {
          results.push({ status: 400, body: { error: "validation_error", message: "method + path required" } });
          continue;
        }
        // Build a synthetic call by reusing the existing router's
        // dispatch — set up a fake req/res pair and pass them to the
        // router's handle().
        const subResult = await new Promise((resolve) => {
          // Strip the /api/v1 prefix and split the query string so the
          // sub-router sees ?foo=bar exactly as it would for a real
          // top-level request.
          const stripped = sub.path.replace(/^\/api\/v1/, "");
          const [pathOnly, qs = ""] = stripped.split("?");
          const query = {};
          if (qs) {
            for (const pair of qs.split("&")) {
              if (!pair) continue;
              const [k, v = ""] = pair.split("=");
              query[decodeURIComponent(k)] = decodeURIComponent(v);
            }
          }
          const fakeReq = {
            method: sub.method.toUpperCase(),
            url: stripped,
            originalUrl: sub.path,
            headers: { ...req.headers, "content-type": "application/json" },
            apiToken: req.apiToken,
            userId: req.userId,
            body: sub.body || {},
            query,
            params: {},
            get: (h) => req.headers[h.toLowerCase()],
          };
          let status = 200;
          let body = null;
          const fakeRes = {
            status(code) { status = code; return this; },
            json(payload) { body = payload; resolve({ status, body }); return this; },
            send(payload) { body = payload; resolve({ status, body }); return this; },
            setHeader() { return this; },
            getHeader() { return null; },
            end() { resolve({ status, body }); return this; },
          };
          // Re-enter the router for this sub-request. Auth has already
          // been validated on the outer request; sub-handlers see
          // req.userId + req.apiToken so they skip re-checking.
          try {
            router.handle(fakeReq, fakeRes, () => {
              resolve({ status: 404, body: { error: "not_found", message: `No route for ${sub.method} ${sub.path}` } });
            });
          } catch (e) {
            resolve({ status: 500, body: { error: "internal_error", message: e.message } });
          }
        });
        results.push(subResult);
      }
      res.json({ results });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ====================================================================
  // INGEST — idempotent external-data intake
  //
  // The one endpoint external producers (IFTTT relays, backfill scripts,
  // Plex webhooks, bank importers) should call. It exists because the
  // webhook→operation path CANNOT do this: /api/webhooks/:operationId only
  // emits to the user's socket room, and the executor able to create an
  // occurrence is client-side — so with no tab open the payload is dropped.
  // This route writes server-side and needs no client.
  //
  // What it guarantees, none of which a raw POST /occurrences gives you:
  //   1. IDEMPOTENT on (source, externalId). Re-running a backfill, or a
  //      producer retrying a timed-out POST, will not duplicate a row.
  //   2. LINKED into the parent's occurrences[], so the row actually renders.
  //   3. MIRRORED into the warm cache, so it is visible on the next load
  //      rather than up to 30 minutes later.
  //   4. Find-or-mint of the type MODULE by label, so a new source needs no
  //      manual setup before its first record.
  //
  // Single record: POST { gridId, source, externalId, ... }
  // Batch:         POST { gridId, source, records: [ {...}, {...} ] }
  // ====================================================================

  const INGEST_MAX_RECORDS = 200;

  // Deterministic occurrence id from (source, externalId). Two independent
  // dedupe guards are deliberate: this id makes a concurrent double-POST
  // collide on the unique index instead of racing the lookup below, and the
  // meta query catches rows whose id was assigned before this convention.
  const ingestOccId = (source, externalId) =>
    `ing-${String(source).replace(/[^a-z0-9]+/gi, "").slice(0, 12)}-${
      crypto.createHash("sha1").update(`${source}::${externalId}`).digest("hex").slice(0, 20)}`;

  router.post("/ingest", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const body = req.body || {};
      const { gridId, source } = body;
      if (!gridId) return err(res, 400, "validation_error", "gridId required");
      if (!source) return err(res, 400, "validation_error", "source required (e.g. \"raindrop\", \"plex\")");

      const records = Array.isArray(body.records) ? body.records : [body];
      if (!records.length) return err(res, 400, "validation_error", "no records");
      if (records.length > INGEST_MAX_RECORDS) {
        return err(res, 400, "validation_error", `Too many records (${records.length}); max ${INGEST_MAX_RECORDS} per request`);
      }

      // Resolve each distinct module ONCE for the whole batch — a 200-record
      // backfill of one type should not do 200 identical module lookups.
      const moduleCache = new Map();
      const resolveModule = async (rec) => {
        // Body-level values are defaults for every record in the batch — the
        // common case is one type for the whole payload. Same fall-through as
        // parentId / onExisting below.
        const explicitId = rec.moduleId || body.moduleId;
        if (explicitId) {
          const key = `id:${explicitId}`;
          if (!moduleCache.has(key)) {
            moduleCache.set(key, await Module.findOne({ id: explicitId, userId: req.userId }).lean());
          }
          return moduleCache.get(key);
        }
        const label = rec.moduleLabel || body.moduleLabel;
        if (!label) return null;
        const role = rec.moduleRole || body.moduleRole || "instance";
        const key = `label:${role}:${label}`;
        if (moduleCache.has(key)) return moduleCache.get(key);
        let mod = await Module.findOne({ userId: req.userId, gridId, label, role }).lean();
        if (!mod) {
          const created = await Module.create({
            id: uid(), userId: req.userId, gridId, label, role,
            ...(rec.moduleKind || body.moduleKind ? { kind: rec.moduleKind || body.moduleKind } : {}),
            meta: { ingestSource: source },
          });
          mod = created.toObject();
          mirrorToCache(req.userId, gridId, "module", mod);
          io.to(userRoom(req.userId)).emit("module_created", { module: mod });
        }
        moduleCache.set(key, mod);
        return mod;
      };

      // Validate parents once per distinct id. A bad parentId is precisely how
      // rows end up in the database and invisible on screen, so it FAILS the
      // record rather than silently creating an unparented occurrence.
      const parentCache = new Map();
      const parentExists = async (parentId) => {
        if (!parentCache.has(parentId)) {
          parentCache.set(parentId, !!await Occurrence.exists({ id: parentId, userId: req.userId }));
        }
        return parentCache.get(parentId);
      };

      const results = [];
      for (const rec of records) {
        const externalId = rec.externalId;
        if (!externalId) {
          results.push({ ok: false, status: "error", error: "externalId required" });
          continue;
        }
        try {
          const parentId = rec.parentId ?? body.parentId ?? null;
          if (parentId && !await parentExists(parentId)) {
            results.push({ ok: false, externalId, status: "error", error: `parentId ${parentId} not found` });
            continue;
          }

          const existing = await Occurrence.findOne({
            userId: req.userId, gridId,
            "meta.source": source, "meta.externalId": externalId,
          }).lean();

          const onExisting = rec.onExisting || body.onExisting || "skip";

          if (existing) {
            if (onExisting === "skip") {
              results.push({ ok: true, externalId, status: "skipped", occurrenceId: existing.id });
              continue;
            }
            // "update" merges the incoming fields over what is there;
            // "replace" takes the incoming set as authoritative. Neither
            // touches parentId — a row you have since moved by hand stays
            // where you put it.
            const nextFields = onExisting === "replace"
              ? (rec.fields || {})
              : { ...(existing.fields || {}), ...(rec.fields || {}) };
            const updated = await Occurrence.findOneAndUpdate(
              { id: existing.id, userId: req.userId },
              {
                $set: {
                  fields: nextFields,
                  ...(rec.label !== undefined ? { label: rec.label } : {}),
                  meta: {
                    ...(existing.meta || {}), ...(rec.meta || {}),
                    source, externalId, ingestedAt: new Date().toISOString(),
                  },
                },
              },
              { returnDocument: "after", lean: true },
            );
            mirrorToCache(req.userId, gridId, "occurrence", updated);
            io.to(userRoom(req.userId)).emit("occurrence_updated", { occurrence: updated });
            results.push({ ok: true, externalId, status: "updated", occurrenceId: updated.id });
            continue;
          }

          const mod = await resolveModule(rec);
          if (!mod) {
            results.push({ ok: false, externalId, status: "error", error: "moduleId or moduleLabel required (module not found)" });
            continue;
          }

          const id = rec.id || ingestOccId(source, externalId);
          const doc = await Occurrence.create({
            id, userId: req.userId, gridId,
            moduleId: mod.id,
            ...(parentId ? { parentId } : {}),
            label: rec.label ?? null,
            fields: rec.fields || {},
            meta: {
              ...(rec.meta || {}),
              source, externalId, ingestedAt: new Date().toISOString(),
            },
          });
          const obj = doc.toObject();
          mirrorToCache(req.userId, gridId, "occurrence", obj);
          io.to(userRoom(req.userId)).emit("occurrence_created", { occurrence: obj });
          const parent = await linkIntoParent({
            userId: req.userId, parentId, childId: id, index: rec.index,
          });
          results.push({
            ok: true, externalId, status: "created", occurrenceId: id,
            linkedToParent: !!parent,
          });
        } catch (recErr) {
          // A duplicate key here means a concurrent request for the same
          // (source, externalId) won the race — which is the correct outcome,
          // not an error: exactly one row exists.
          if (recErr?.code === 11000) {
            results.push({ ok: true, externalId, status: "skipped", note: "concurrent duplicate" });
          } else {
            results.push({ ok: false, externalId, status: "error", error: recErr.message });
          }
        }
      }

      const summary = results.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      }, {});
      res.json({ ok: results.every(r => r.ok), source, summary, results });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ── POST /import/url — fetch a page and import it ─────────────────────
  //
  // The capability behind "convert this link to a page" (user, 2026-08-07:
  // *"if i rightclick on an external link in our system, we should have a
  // convert to page"*). Every other import route takes content you ALREADY
  // have — `/import/html` wants the html, `/research/wikipedia/import` wants a
  // title — so a link in the grid had no route to the thing it points at.
  //
  // This is deliberately PULL, one link at a time. It replaces the bulk
  // "follow every link" harvest that the plan originally carried: a harvest of
  // a Wikipedia article's links is hundreds of pages and a second hop is
  // thousands, whereas a right-click cannot run away.
  //
  // The fetch is guarded — see utils/safeFetchUrl.js. The server can reach
  // things the user cannot (the database host, an admin port, the cloud
  // metadata endpoint), so the URL is validated before any request goes out.
  router.post("/import/url", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const { fetchPageHtml } = await import("../utils/safeFetchUrl.js");
      const { wikiHtmlToMarkdown } = await import("../services/wikipediaTools.js");
      const { markdownToModuli } = await import("../services/markdownImporter.js");
      const { extractMainContent } = await import("../utils/mainContent.js");
      const { gridId, url, parentId = null, title = "", dryRun = false } = req.body || {};
      if (!gridId) return err(res, 400, "validation_error", "gridId required");
      if (!url) return err(res, 400, "validation_error", "url required");

      const fetched = await fetchPageHtml(url);
      // 400, not 500: a refused or unreachable URL is the caller's input being
      // wrong, and the reason is safe to hand back so the UI can say WHY.
      if (!fetched.ok) return err(res, 400, "fetch_failed", fetched.reason);

      // Narrow to the article before converting — a raw page imports its
      // nav chrome as prose (measured on Wikipedia).
      const { html: mainHtml } = extractMainContent(fetched.html);
      const markdown = wikiHtmlToMarkdown(mainHtml, title);
      const result = await markdownToModuli({
        gridId, parentId, userId: req.userId, markdown, dryRun,
        title: title || deriveTitleFromHtml(fetched.html) || fetched.url,
      });

      if (!dryRun) {
        const { persistImportResult } = await import("../utils/persistImport.js");
        await persistImportResult({ result, userId: req.userId, uc: await getUserCache(req.userId, gridId) });
        for (const m of result.modules) io.to(userRoom(req.userId)).emit("module_created", { module: m });
        for (const o of result.occurrences) io.to(userRoom(req.userId)).emit("occurrence_created", { occurrence: o });
      }

      res.json({
        ...result,
        sourceUrl: fetched.url,
        // A dry run plans the tree but persists nothing, so it must NOT hand
        // back a root id — the 2026-06-12 "empty embed" bug was exactly that.
        rootOccurrenceId: dryRun ? null : result.rootOccurrenceId,
        dryRun,
      });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ====================================================================
  // SECRETS — encrypted per-user values usable in CALL_API as $secrets.KEY
  // ====================================================================

  router.get("/secrets", authAndLimit({ requireScope: "read" }), async (req, res) => {
    try {
      const docs = await Secret.find({ userId: req.userId }).sort({ key: 1 }).lean();
      // Never return values — only metadata.
      res.json({
        secrets: docs.map(d => ({ key: d.key, lastUsedAt: d.lastUsedAt, createdAt: d.createdAt })),
        configured: isSecretsKeyConfigured(),
      });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.post("/secrets", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      if (!isSecretsKeyConfigured()) {
        return err(res, 503, "secrets_unavailable",
          "Server has no SECRETS_KEY env var configured. Add 32 random bytes (base64) as SECRETS_KEY in server/.env.");
      }
      const { key, value } = req.body || {};
      if (!key || typeof key !== "string") return err(res, 400, "validation_error", "key required");
      if (value == null) return err(res, 400, "validation_error", "value required");
      const enc = encryptValue(value);
      const doc = await Secret.findOneAndUpdate(
        { userId: req.userId, key },
        { $set: { ...enc, userId: req.userId, key } },
        { upsert: true, returnDocument: "after", lean: true },
      );
      res.status(201).json({ key: doc.key, createdAt: doc.createdAt, lastUsedAt: doc.lastUsedAt });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.delete("/secrets/:key", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const doomed = await Secret.findOneAndDelete({ userId: req.userId, key: req.params.key });
      if (!doomed) return err(res, 404, "not_found", "Secret not found");
      res.json({ ok: true });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ====================================================================
  // WEBHOOK SECRET — mint/rotate the HMAC secret for an operation's webhook
  // ====================================================================

  router.post("/operations/:id/webhook-secret", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const op = await Operation.findOne({ id: req.params.id, userId: req.userId });
      if (!op) return err(res, 404, "not_found", "Operation not found");
      const newSecret = crypto.randomBytes(32).toString("base64url");
      op.webhookSecret = newSecret;
      await op.save();
      io.to(userRoom(req.userId)).emit("operation_updated", {
        operation: { id: op.id, webhookSecret: "***" }, // never echo the real value
      });
      // Returned ONCE — caller must store it. Compute signatures with:
      //   sig = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
      // Send as X-Moduli-Signature header on POST /api/webhooks/<opId>.
      res.json({
        operationId: op.id,
        webhookUrl: `/api/webhooks/${op.id}`,
        secret: newSecret,
        instructions: "POST raw JSON to webhookUrl with X-Moduli-Signature: sha256=<hex(hmacSha256(secret, body))>",
      });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.delete("/operations/:id/webhook-secret", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const next = await Operation.findOneAndUpdate(
        { id: req.params.id, userId: req.userId },
        { $set: { webhookSecret: null } },
        { returnDocument: "after", lean: true },
      );
      if (!next) return err(res, 404, "not_found", "Operation not found");
      res.json({ ok: true, operationId: req.params.id });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ====================================================================
  // IMPORT — convert a doc/text into Moduli entities (textblocks /
  //          containers / instances). See docs/assistant-plan.md.
  // ====================================================================

  router.post("/import/markdown", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const { markdownToModuli } = await import("../services/markdownImporter.js");
      const { gridId, parentId = null, markdown, dryRun = false, title } = req.body || {};
      if (!gridId) return err(res, 400, "validation_error", "gridId required");
      if (typeof markdown !== "string") return err(res, 400, "validation_error", "markdown (string) required");
      const result = await markdownToModuli({
        gridId, parentId, userId: req.userId, markdown, dryRun, title,
      });
      // Persist (survive reload) THEN broadcast (connected tabs sync live).
      if (!dryRun) {
        const { persistImportResult } = await import("../utils/persistImport.js");
        await persistImportResult({ result, userId: req.userId, uc: await getUserCache(req.userId, gridId) });
        for (const m of result.modules) io.to(userRoom(req.userId)).emit("module_created", { module: m });
        for (const o of result.occurrences) io.to(userRoom(req.userId)).emit("occurrence_created", { occurrence: o });
      }
      res.json(result);
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // POST /import/text — Unified import endpoint with format auto-detect.
  // Accepts ANY of html / markdown / plain text in the same `content`
  // field; sniffs the format and routes through the appropriate
  // converter. Lets callers (drop handlers, AI tools, op actions, raw
  // curl) feed arbitrary content without knowing its shape in advance.
  //
  // Body:
  //   gridId      — required
  //   parentId    — optional; appends the new root under this occurrence
  //   content     — the raw input (html / markdown / plain text)
  //   format      — "auto" (default) | "html" | "markdown" | "text"
  //   title       — root container label when input has no leading H1
  //   dryRun      — plan-only; no persistence + no broadcast
  //   htmlOpts    — passed to htmlToMarkdown when format resolves to html
  //                 (keepImages/keepTables/keepFigures/stripClasses).
  //                 Defaults to keep all three when omitted.
  //
  // Detection:
  //   "html"      — content has BOTH `<` and `>` AND at least one tag
  //                 pattern `</?[a-z]`. Conservative — markdown with
  //                 a stray `<x>` won't trigger.
  //   "markdown"  — leading `#` / `*` / `-` / "```"  / "1." in the
  //                 first non-empty line, OR multiple paragraph
  //                 breaks (\n\n).
  //   "text"      — degenerate markdown (single paragraph, no marks).
  //                 Same code path as markdown — the importer handles
  //                 plain text fine.
  router.post("/import/text", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const { htmlToMarkdown } = await import("../services/wikipediaTools.js");
      const { markdownToModuli } = await import("../services/markdownImporter.js");
      const {
        gridId, parentId = null, content, format: rawFormat = "auto",
        title = "", dryRun = false, htmlOpts = {},
      } = req.body || {};
      if (!gridId) return err(res, 400, "validation_error", "gridId required");
      if (typeof content !== "string" || !content.trim()) {
        return err(res, 400, "validation_error", "content (non-empty string) required");
      }

      // Resolve format.
      let format = rawFormat;
      if (format === "auto") {
        const looksHtml = /<\/?[a-z][\s\S]*?>/i.test(content);
        format = looksHtml ? "html" : "markdown";
      }

      // Convert to markdown if needed.
      let markdown;
      if (format === "html") {
        markdown = htmlToMarkdown(content, title, {
          keepImages: true, keepTables: true, keepFigures: true,
          ...htmlOpts,
        });
      } else {
        // markdown OR text — both go through the importer directly.
        // Plain text is a degenerate markdown (paragraphs work, no marks).
        markdown = content;
      }

      const result = await markdownToModuli({
        gridId, parentId, userId: req.userId, markdown, dryRun, title,
      });

      if (!dryRun) {
        const { persistImportResult } = await import("../utils/persistImport.js");
        await persistImportResult({ result, userId: req.userId, uc: await getUserCache(req.userId, gridId) });
        for (const m of result.modules) io.to(userRoom(req.userId)).emit("module_created", { module: m });
        for (const o of result.occurrences) io.to(userRoom(req.userId)).emit("occurrence_created", { occurrence: o });
      }

      res.json({ ...result, detectedFormat: format, markdown });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // POST /import/html — Phase A of the drag-to-import pipeline (see
  // client/src/CLAUDE.md big-feature #6.5). Two stages chained:
  //   1. htmlToMarkdown(html, { keepImages, keepTables, keepFigures })
  //   2. markdownToModuli(markdown) — re-uses the existing Phase A
  //      importer so the resulting tree shape matches /import/markdown.
  // Defaults keep images + tables + figures because the drop pipeline
  // wants the FULL document including media. Callers that want the
  // Wikipedia-summary stripping behavior can pass keepImages:false etc.
  router.post("/import/html", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const { htmlToMarkdown } = await import("../services/wikipediaTools.js");
      const { markdownToModuli } = await import("../services/markdownImporter.js");
      const {
        gridId, parentId = null, html, dryRun = false, title = "",
        keepImages = true, keepTables = true, keepFigures = true,
        stripClasses,
      } = req.body || {};
      if (!gridId) return err(res, 400, "validation_error", "gridId required");
      if (typeof html !== "string") return err(res, 400, "validation_error", "html (string) required");
      const markdown = htmlToMarkdown(html, title, {
        keepImages, keepTables, keepFigures,
        ...(stripClasses ? { stripClasses } : {}),
      });
      const result = await markdownToModuli({
        gridId, parentId, userId: req.userId, markdown, dryRun, title,
      });
      if (!dryRun) {
        const { persistImportResult } = await import("../utils/persistImport.js");
        await persistImportResult({ result, userId: req.userId, uc: await getUserCache(req.userId, gridId) });
        for (const m of result.modules) io.to(userRoom(req.userId)).emit("module_created", { module: m });
        for (const o of result.occurrences) io.to(userRoom(req.userId)).emit("occurrence_created", { occurrence: o });
      }
      res.json({ ...result, markdown });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ====================================================================
  // RESEARCH — Wikipedia tools for Jarvis. See docs/assistant-guide.md.
  // ====================================================================

  router.get("/research/wikipedia/search", authAndLimit({ requireScope: "read" }), async (req, res) => {
    try {
      const { search } = await import("../services/wikipediaTools.js");
      const hits = await search(req.query.q, { limit: Math.min(20, Number(req.query.limit) || 5) });
      res.json({ ok: true, query: req.query.q, hits });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.get("/research/wikipedia/summary", authAndLimit({ requireScope: "read" }), async (req, res) => {
    try {
      const { summary } = await import("../services/wikipediaTools.js");
      const result = await summary(req.query.title);
      if (!result) return err(res, 404, "not_found", "No Wikipedia article with that title");
      res.json({ ok: true, ...result });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.get("/research/wikipedia/links", authAndLimit({ requireScope: "read" }), async (req, res) => {
    try {
      const { links } = await import("../services/wikipediaTools.js");
      const result = await links(req.query.title, req.query.max);
      if (!result) return err(res, 404, "not_found", "No Wikipedia article with that title");
      res.json({ ok: true, ...result });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.get("/research/wikipedia/full", authAndLimit({ requireScope: "read" }), async (req, res) => {
    try {
      const { fullMarkdown } = await import("../services/wikipediaTools.js");
      const result = await fullMarkdown(req.query.title);
      if (!result) return err(res, 404, "not_found", "No Wikipedia article with that title");
      res.json({ ok: true, ...result });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // Composite "research → page": one HTTP call does search → full →
  // import. Returns { rootOccurrenceId, stats, source: { title, url } }.
  router.post("/research/wikipedia/import", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const { search, fullMarkdown } = await import("../services/wikipediaTools.js");
      const { markdownToModuli } = await import("../services/markdownImporter.js");
      const { gridId, parentId = null, query, title: explicitTitle, dryRun = false } = req.body || {};
      if (!gridId) return err(res, 400, "validation_error", "gridId required");
      if (!query && !explicitTitle) return err(res, 400, "validation_error", "query or title required");

      // Pick the article: explicit title wins; else top search hit.
      let pickedTitle = explicitTitle;
      let searchHit = null;
      if (!pickedTitle) {
        const hits = await search(query, { limit: 1 });
        if (!hits.length) return err(res, 404, "not_found", "No Wikipedia matches for that query");
        searchHit = hits[0];
        pickedTitle = searchHit.title;
      }

      const full = await fullMarkdown(pickedTitle);
      if (!full) return err(res, 404, "not_found", "Article not found");

      const importResult = await markdownToModuli({
        gridId, parentId, userId: req.userId,
        markdown: full.markdown, title: pickedTitle, dryRun,
        sourceUrl: full.url,
      });

      // Persist to the DB + warm cache FIRST so the import survives a reload, THEN
      // broadcast so connected tabs sync live.
      if (!dryRun) {
        const { persistImportResult } = await import("../utils/persistImport.js");
        const uc = await getUserCache(req.userId, gridId);
        await persistImportResult({ result: importResult, userId: req.userId, uc });
        for (const m of importResult.modules) io.to(userRoom(req.userId)).emit("module_created", { module: m });
        for (const o of importResult.occurrences) io.to(userRoom(req.userId)).emit("occurrence_created", { occurrence: o });
      }

      res.json({
        ok: true,
        source: { title: pickedTitle, url: full.url, matchedFrom: explicitTitle ? "title" : "search" },
        searchHit,
        // A dry run plans the tree but persists nothing, so DON'T advertise a root
        // occurrence id — callers (the drawer's Imports-page wrap) would otherwise
        // build a page whose embed points at an occurrence that never existed.
        rootOccurrenceId: dryRun ? null : importResult.rootOccurrenceId,
        stats: importResult.stats,
        dryRun,
      });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // Relink a batch of imported articles: rewrite links BETWEEN them into in-app
  // navigation (docLink nodes). Call after importing several linked articles.
  router.post("/research/wikipedia/relink", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const { relinkOccurrences } = await import("../services/importRelink.js");
      const { gridId, rootOccurrenceIds } = req.body || {};
      if (!gridId || !Array.isArray(rootOccurrenceIds) || !rootOccurrenceIds.length) {
        return err(res, 400, "validation_error", "gridId + rootOccurrenceIds[] required");
      }
      const allOccs = await Occurrence.find({ userId: req.userId, gridId }).lean();
      const occById = new Map(allOccs.map((o) => [o.id, o]));
      const mods = await Module.find({ userId: req.userId, gridId }).lean();
      const modById = new Map(mods.map((m) => [m.id, m]));

      // title → root occurrence id (the imported root container's label IS the
      // article title). Then collect every textmap-bearing descendant.
      const titleToOccId = {};
      for (const rootId of rootOccurrenceIds) {
        const occ = occById.get(rootId);
        const mod = occ && modById.get(occ.moduleId);
        if (mod?.label) titleToOccId[mod.label] = rootId;
      }
      const seen = new Set();
      const subtree = [];
      const stack = [...rootOccurrenceIds];
      while (stack.length) {
        const id = stack.pop();
        if (seen.has(id)) continue;
        seen.add(id);
        const occ = occById.get(id);
        if (!occ) continue;
        if (occ.textmap) subtree.push(occ);
        for (const c of (occ.occurrences || [])) stack.push(c);
      }

      const changed = relinkOccurrences(subtree, titleToOccId);
      const uc = await getUserCache(req.userId, gridId);
      for (const { id, textmap } of changed) {
        await Occurrence.findOneAndUpdate({ id, userId: req.userId }, { $set: { textmap } });
        if (uc?.occurrencesById?.[id]) uc.occurrencesById[id] = { ...uc.occurrencesById[id], textmap };
        io.to(userRoom(req.userId)).emit("occurrence_updated", { occurrence: { id, textmap } });
      }
      res.json({ ok: true, relinked: changed.length, titles: Object.keys(titleToOccId) });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ====================================================================
  // ASSISTANT — Jarvis chat endpoint. See docs/assistant-guide.md.
  // ====================================================================

  router.post("/assistant/chat", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const { assistantChat } = await import("../services/assistantAgent.js");
      const { messages = [], gridId, context = null } = req.body || {};
      const result = await assistantChat({
        messages,
        userId: req.userId,
        gridId,
        context,
        baseUrl: SELF_BASE_URL,
        apiToken: req.headers.authorization?.replace(/^Bearer /, ""),
        // Stream lightweight progress to the user's tabs so a slow local model
        // shows "thinking (2)…" / "running wikipedia_import…" instead of a
        // silent multi-minute "… thinking".
        onProgress: (ev) => io.to(userRoom(req.userId)).emit("assistant_progress", ev),
      });
      // Signal the drawer to clear any lingering progress line.
      io.to(userRoom(req.userId)).emit("assistant_progress", { phase: "done" });
      res.json(result);
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // Hand the drawer the stable ASSISTANT_API_TOKEN so it auto-connects after a
  // reseed / on a fresh browser WITHOUT a manual paste (the token persists in
  // server/.env across reseeds, but localStorage in the browser doesn't get it).
  // NO auth — this IS the auth bootstrap — so it's gated by ORIGIN instead:
  // loopback + PRIVATE LAN ranges (the app is accessed over the WSL2 / LAN IP,
  // so localhost-only wouldn't reach it). Public IPs are refused so a
  // port-forwarded server never leaks the token (it grants full grid CRUD).
  // Set ASSISTANT_BOOTSTRAP=off to disable entirely. Returns { token: null }
  // when unset / disabled / non-local.
  router.get("/assistant/bootstrap-token", async (req, res) => {
    if ((process.env.ASSISTANT_BOOTSTRAP || "").toLowerCase() === "off") return res.json({ token: null });
    // Primary path: a valid logged-in APP JWT. The user is already authenticated
    // to the app over HTTPS, so handing them an assistant API token is safe over
    // ANY origin (this is what makes auto-connect work on the public domain, not
    // just the LAN). The drawer sends the app JWT it already has.
    const jwtTok = (req.headers.authorization || "").replace(/^Bearer\s+/i, "") || req.query.jwt || "";
    const decoded = jwtTok ? verifyToken(jwtTok) : null;
    const userId = decoded?.userId ? String(decoded.userId) : null;
    // Fallback: loopback / private LAN origins (dev over WSL2 / LAN IP, before
    // login). Public IPs without a valid JWT are refused so a port-forwarded
    // server never leaks a token (it grants full grid CRUD).
    const host = (req.hostname || "").toLowerCase();
    const peer = (req.socket?.remoteAddress || req.ip || "").replace(/^::ffff:/, "");
    const localHost = ["localhost", "127.0.0.1", "::1"].includes(host);
    const localPeer =
      peer === "127.0.0.1" || peer === "::1" ||
      /^10\./.test(peer) || /^192\.168\./.test(peer) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(peer) || /^169\.254\./.test(peer) || // RFC1918 + link-local
      /^f[cd]/i.test(peer) || /^fe[89ab]/i.test(peer);                        // IPv6 ULA + link-local
    if (!userId && !localHost && !localPeer) return res.json({ token: null });

    // Prefer the stable env token (server/.env ASSISTANT_API_TOKEN) when it
    // actually authenticates against the DB AND carries write scope — that's the
    // "specific one in our env" path.
    const envTok = process.env.ASSISTANT_API_TOKEN || null;
    if (envTok) {
      try {
        const doc = await ApiToken.authenticate(envTok);
        if (doc && (doc.scopes || []).includes("write")) return res.json({ token: envTok });
      } catch { /* fall through to mint */ }
    }
    // Env token missing / stale / DB-unsynced → for an authenticated app user,
    // MINT a fresh valid token on the fly so the chat ALWAYS connects without a
    // reseed. (Dev-LAN with no logged-in user can't mint — returns null.)
    if (userId) {
      try {
        const { rawToken } = await ApiToken.mint({ userId, name: "assistant (auto)", scopes: ["read", "write"] });
        return res.json({ token: rawToken });
      } catch { return res.json({ token: null }); }
    }
    res.json({ token: envTok });
  });

  // Execute a single tool the user approved on a confirmation card. The chat
  // endpoint returns pendingConfirmations for destructive tools instead of
  // running them; the client posts the approved one here.
  router.post("/assistant/confirm", authAndLimit({ requireScope: "write" }), async (req, res) => {
    try {
      const { assistantConfirm } = await import("../services/assistantAgent.js");
      const { name, input = {}, gridId } = req.body || {};
      if (!name) return err(res, 400, "validation_error", "name required");
      // Keep the drawer's ThinkingBar honestly alive for the whole confirmed
      // action (a Wikipedia import is a 20-30s server round-trip). The chat
      // loop streams assistant_progress; the confirm path didn't, so the bar
      // sat at a stale "… thinking" the entire time. Emit a live "running <tool>"
      // phase up front and a terminal "done" so the client's progress label
      // tracks the actual work (the elapsed timer + bar keep moving regardless).
      const room = userRoom(req.userId);
      io.to(room).emit("assistant_progress", { phase: "tool", tool: name });
      try {
        const result = await assistantConfirm({
          name,
          input,
          userId: req.userId,
          gridId,
          baseUrl: SELF_BASE_URL,
          apiToken: req.headers.authorization?.replace(/^Bearer /, ""),
        });
        res.json(result);
      } finally {
        io.to(room).emit("assistant_progress", { phase: "done" });
      }
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ====================================================================
  // OPENAPI — machine-readable spec served at /api/v1/openapi.json
  // ====================================================================

  router.get("/openapi.json", (_req, res) => {
    res.json(buildOpenApiDoc());
  });

  return router;
}
