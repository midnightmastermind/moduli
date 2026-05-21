// routes/apiV1.js
//
// /api/v1 REST surface. Slice 1: just enough endpoints to demo the inbound
// half of the API plan. Each handler maps 1:1 to a socket event the
// existing CRUD layer already understands — REST is a thin HTTP wrapper.
//
// Per docs/api-plan.md §1.
//
// Phase 1 (this file): read grid state, write a single field value, run an
// op synchronously. Future phases extend this surface following the same
// pattern.

import express from "express";
import Grid from "../models/Grid.js";
import Occurrence from "../models/Occurrence.js";
import Operation from "../models/Operation.js";
import { apiAuth } from "../middleware/apiAuth.js";

export function makeApiV1Router({ getUserCache, io, userRoom, opRunBridge }) {
  const router = express.Router();

  // ── GET /api/v1/grids — list grids the token's user owns ─────────────
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
    } catch (err) {
      res.status(500).json({ error: "internal_error", message: err.message });
    }
  });

  // ── GET /api/v1/grids/:id/state — full state snapshot ────────────────
  router.get("/grids/:id/state", apiAuth({ requireScope: "read" }), async (req, res) => {
    try {
      const grid = await Grid.findOne({ _id: req.params.id, userId: req.userId }).lean();
      if (!grid) return res.status(404).json({ error: "not_found", message: "Grid not found" });
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
    } catch (err) {
      res.status(500).json({ error: "internal_error", message: err.message });
    }
  });

  // ── PUT /api/v1/occurrences/:id/fields/:fieldId — write field value ──
  router.put("/occurrences/:id/fields/:fieldId", apiAuth({ requireScope: "write" }), async (req, res) => {
    try {
      const { id, fieldId } = req.params;
      const { value, flow } = req.body || {};
      const occ = await Occurrence.findOne({ id, userId: req.userId });
      if (!occ) return res.status(404).json({ error: "not_found", message: "Occurrence not found" });

      const prevField = occ.fields?.[fieldId] || {};
      const nextField = { ...prevField, value, ...(flow !== undefined ? { flow } : {}) };
      const nextFields = { ...(occ.fields || {}), [fieldId]: nextField };
      occ.fields = nextFields;
      occ.markModified("fields");
      await occ.save();

      // Broadcast to the user's room — connected clients pick up the
      // change exactly like a UI edit. Triggers any onChange ops because
      // the client's MeasureOp fire is part of the update flow.
      io.to(userRoom(req.userId)).emit("occurrence_updated", {
        occurrence: { id: occ.id, fields: nextFields },
      });

      res.json({
        ok: true,
        occurrenceId: id,
        fieldId,
        fields: nextFields,
      });
    } catch (err) {
      res.status(500).json({ error: "internal_error", message: err.message });
    }
  });

  // ── POST /api/v1/operations/:id/run — synchronous op invocation ──────
  //
  // The headliner per the API plan. Flow:
  //   1. Validate token + scope (write).
  //   2. Confirm op exists + belongs to the token's user.
  //   3. Emit "run_op_for_api" to the user's room with a requestId. The
  //      first connected client runs the op via its existing executor
  //      and emits "api_op_result" back with the same requestId.
  //   4. We hold the HTTP response open via opRunBridge until the result
  //      lands or `timeoutMs` fires.
  //
  // Defers the server-side executor port until Phase 3 (CALL_API needs
  // server-side execution anyway, for secrets + CORS). For now we
  // require a connected client; returns 503 if none.
  router.post("/operations/:id/run", apiAuth({ requireScope: "write" }), async (req, res) => {
    try {
      const { id } = req.params;
      const { vars = {}, wait = true, timeoutMs = 30000, dryRun = false } = req.body || {};
      const op = await Operation.findOne({ id, userId: req.userId });
      if (!op) return res.status(404).json({ error: "not_found", message: "Operation not found" });

      // Check there's at least one connected client to run the op.
      const room = io.sockets.adapter.rooms.get(userRoom(req.userId));
      if (!room || room.size === 0) {
        return res.status(503).json({
          error: "no_executor",
          message: "No connected client to execute the operation. Phase 3 will add a server-side executor; for now, the user must have an active Moduli tab open.",
        });
      }

      if (!wait) {
        // Fire-and-forget. Useful for clients that just want to kick
        // something off and don't need the result.
        io.to(userRoom(req.userId)).emit("run_op_for_api", {
          requestId: null,
          operationId: id,
          vars,
          dryRun,
        });
        return res.status(202).json({ ok: true, queued: true });
      }

      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const result = await opRunBridge.await({
        requestId,
        timeoutMs: Math.max(1000, Math.min(60000, Number(timeoutMs) || 30000)),
        emit: () => {
          io.to(userRoom(req.userId)).emit("run_op_for_api", {
            requestId,
            operationId: id,
            vars,
            dryRun,
          });
        },
      });

      res.json(result);
    } catch (err) {
      if (err?.code === "TIMEOUT") {
        return res.status(504).json({ error: "timeout", message: err.message });
      }
      res.status(500).json({ error: "internal_error", message: err.message });
    }
  });

  return router;
}
