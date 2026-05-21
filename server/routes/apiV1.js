// routes/apiV1.js
//
// /api/v1 REST surface. Per docs/api-plan.md §1.
//
// Phase 1: auth + read grid state + write single field + sync op invoke.
// Phase 2 (this file): full CRUD for modules/occurrences/fields/operations,
//                      bulk field-write, batch endpoint, pagination.
// Phase 3 (deferred):  server-side executor for headless ops, Secrets Store,
//                      CALL_API moved server-side, OpenAPI doc.
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

import { apiAuth } from "../middleware/apiAuth.js";

const uid = () => crypto.randomUUID();
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

export function makeApiV1Router({ getUserCache, io, userRoom, opRunBridge }) {
  const router = express.Router();

  // ====================================================================
  // GRIDS
  // ====================================================================

  router.get("/grids", apiAuth({ requireScope: "read" }), async (req, res) => {
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

  router.get("/grids/:id/state", apiAuth({ requireScope: "read" }), async (req, res) => {
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

  // ====================================================================
  // MODULES
  // ====================================================================

  router.get("/modules", apiAuth({ requireScope: "read" }), async (req, res) => {
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

  router.post("/modules", apiAuth({ requireScope: "write" }), async (req, res) => {
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
      io.to(userRoom(req.userId)).emit("module_created", { module: doc.toObject() });
      res.status(201).json({ module: doc.toObject() });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.patch("/modules/:id", apiAuth({ requireScope: "write" }), async (req, res) => {
    try {
      const patch = req.body || {};
      const next = await Module.findOneAndUpdate(
        { id: req.params.id, userId: req.userId },
        { $set: patch },
        { new: true, lean: true },
      );
      if (!next) return err(res, 404, "not_found", "Module not found");
      io.to(userRoom(req.userId)).emit("module_updated", { module: next });
      res.json({ module: next });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.delete("/modules/:id", apiAuth({ requireScope: "write" }), async (req, res) => {
    try {
      const doomed = await Module.findOneAndDelete({ id: req.params.id, userId: req.userId });
      if (!doomed) return err(res, 404, "not_found", "Module not found");
      io.to(userRoom(req.userId)).emit("module_deleted", { moduleId: req.params.id });
      res.json({ ok: true });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ====================================================================
  // OCCURRENCES
  // ====================================================================

  router.get("/occurrences", apiAuth({ requireScope: "read" }), async (req, res) => {
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

  router.get("/occurrences/:id", apiAuth({ requireScope: "read" }), async (req, res) => {
    try {
      const occ = await Occurrence.findOne({ id: req.params.id, userId: req.userId }).lean();
      if (!occ) return err(res, 404, "not_found", "Occurrence not found");
      res.json({ occurrence: occ });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.post("/occurrences", apiAuth({ requireScope: "write" }), async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.gridId) return err(res, 400, "validation_error", "gridId required");
      if (!body.moduleId) return err(res, 400, "validation_error", "moduleId required");
      const id = body.id || uid();
      const doc = await Occurrence.create({
        ...body,
        id,
        userId: req.userId,
        fields: body.fields || {},
      });
      io.to(userRoom(req.userId)).emit("occurrence_created", { occurrence: doc.toObject() });
      res.status(201).json({ occurrence: doc.toObject() });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.patch("/occurrences/:id", apiAuth({ requireScope: "write" }), async (req, res) => {
    try {
      const patch = req.body || {};
      const next = await Occurrence.findOneAndUpdate(
        { id: req.params.id, userId: req.userId },
        { $set: patch },
        { new: true, lean: true },
      );
      if (!next) return err(res, 404, "not_found", "Occurrence not found");
      io.to(userRoom(req.userId)).emit("occurrence_updated", { occurrence: next });
      res.json({ occurrence: next });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.delete("/occurrences/:id", apiAuth({ requireScope: "write" }), async (req, res) => {
    try {
      const doomed = await Occurrence.findOneAndDelete({ id: req.params.id, userId: req.userId });
      if (!doomed) return err(res, 404, "not_found", "Occurrence not found");
      io.to(userRoom(req.userId)).emit("occurrence_deleted", { occurrenceId: req.params.id });
      res.json({ ok: true });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ── PUT /api/v1/occurrences/:id/fields/:fieldId — single field write ──
  router.put("/occurrences/:id/fields/:fieldId", apiAuth({ requireScope: "write" }), async (req, res) => {
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
      io.to(userRoom(req.userId)).emit("occurrence_updated", {
        occurrence: { id: occ.id, fields: nextFields },
      });
      res.json({ ok: true, occurrenceId: id, fieldId, fields: nextFields });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ── PATCH /api/v1/occurrences/:id/fields — bulk field write on one occ ──
  router.patch("/occurrences/:id/fields", apiAuth({ requireScope: "write" }), async (req, res) => {
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
      io.to(userRoom(req.userId)).emit("occurrence_updated", {
        occurrence: { id: occ.id, fields: next },
      });
      res.json({ ok: true, occurrenceId: id, fields: next });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ── POST /api/v1/fields/bulk — write field values across many occs ────
  router.post("/fields/bulk", apiAuth({ requireScope: "write" }), async (req, res) => {
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

  router.get("/fields", apiAuth({ requireScope: "read" }), async (req, res) => {
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

  router.post("/fields", apiAuth({ requireScope: "write" }), async (req, res) => {
    try {
      const body = req.body || {};
      if (!body.gridId) return err(res, 400, "validation_error", "gridId required");
      if (!body.name) return err(res, 400, "validation_error", "name required");
      const id = body.id || uid();
      const doc = await Field.create({ ...body, id, userId: req.userId });
      io.to(userRoom(req.userId)).emit("field_created", { field: doc.toObject() });
      res.status(201).json({ field: doc.toObject() });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.patch("/fields/:id", apiAuth({ requireScope: "write" }), async (req, res) => {
    try {
      const next = await Field.findOneAndUpdate(
        { id: req.params.id, userId: req.userId },
        { $set: req.body || {} },
        { new: true, lean: true },
      );
      if (!next) return err(res, 404, "not_found", "Field not found");
      io.to(userRoom(req.userId)).emit("field_updated", { field: next });
      res.json({ field: next });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.delete("/fields/:id", apiAuth({ requireScope: "write" }), async (req, res) => {
    try {
      const doomed = await Field.findOneAndDelete({ id: req.params.id, userId: req.userId });
      if (!doomed) return err(res, 404, "not_found", "Field not found");
      io.to(userRoom(req.userId)).emit("field_deleted", { fieldId: req.params.id });
      res.json({ ok: true });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  // ====================================================================
  // OPERATIONS
  // ====================================================================

  router.get("/operations", apiAuth({ requireScope: "read" }), async (req, res) => {
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

  router.post("/operations", apiAuth({ requireScope: "write" }), async (req, res) => {
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

  router.patch("/operations/:id", apiAuth({ requireScope: "write" }), async (req, res) => {
    try {
      const next = await Operation.findOneAndUpdate(
        { id: req.params.id, userId: req.userId },
        { $set: req.body || {} },
        { new: true, lean: true },
      );
      if (!next) return err(res, 404, "not_found", "Operation not found");
      io.to(userRoom(req.userId)).emit("operation_updated", { operation: next });
      res.json({ operation: next });
    } catch (e) { err(res, 500, "internal_error", e.message); }
  });

  router.delete("/operations/:id", apiAuth({ requireScope: "write" }), async (req, res) => {
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
  router.post("/operations/:id/run", apiAuth({ requireScope: "write" }), async (req, res) => {
    try {
      const { id } = req.params;
      const { vars = {}, wait = true, timeoutMs = 30000, dryRun = false } = req.body || {};
      const op = await Operation.findOne({ id, userId: req.userId });
      if (!op) return err(res, 404, "not_found", "Operation not found");

      const room = io.sockets.adapter.rooms.get(userRoom(req.userId));
      if (!room || room.size === 0) {
        return err(res, 503, "no_executor",
          "No connected client to execute the operation. Phase 3 will add a server-side executor; for now, the user must have an active Moduli tab open OR run server/scripts/apiDemoClient.js."
        );
      }

      if (!wait) {
        io.to(userRoom(req.userId)).emit("run_op_for_api", {
          requestId: null, operationId: id, vars, dryRun,
        });
        return res.status(202).json({ ok: true, queued: true });
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
      res.json(result);
    } catch (e) {
      if (e?.code === "TIMEOUT") return err(res, 504, "timeout", e.message);
      err(res, 500, "internal_error", e.message);
    }
  });

  // ====================================================================
  // BATCH — pack multiple sub-requests into one round-trip
  // ====================================================================

  router.post("/batch", apiAuth({ requireScope: "write" }), async (req, res) => {
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

  return router;
}
