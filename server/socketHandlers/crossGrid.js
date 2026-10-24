// socketHandlers/crossGrid.js — `copy_to_grid`: a drag from a window on one grid dropped in a window on another.
//
// The destination window asks; the server copies the dragged thing (and what it draws) into the target grid
// (services/gridCopy), places it, and tells every tab. A MOVE is a copy here plus a `cross_grid_moved` event that the
// SOURCE window answers by deleting its original through its own normal delete (it holds that grid's rows and rules).
import Grid from "../models/Grid.js";
import Field from "../models/Field.js";
import View from "../models/View.js";
import Occurrence from "../models/Occurrence.js";
import Module from "../models/Module.js";
import { readSubtree } from "../services/readSubtree.js";
import { mapFields, planGridCopy, fieldIdsOf } from "../services/gridCopy.js";
import { persistImportResult } from "../utils/persistImport.js";
import { embedRootInDocParent } from "../utils/embedRootInDocParent.js";

export function registerCrossGridHandlers(socket, { io, userRoom, ensureUserCache, userCacheReady, loadUserIntoCache }) {
  const peek = (userId, gridId) => (userCacheReady?.(userId, gridId) ? ensureUserCache(userId, gridId) : null);
  const warm = async (userId, gridId) => {
    if (!userCacheReady(userId, gridId)) await loadUserIntoCache(userId, gridId);
    return ensureUserCache(userId, gridId);
  };

  socket.on("copy_to_grid", async (payload = {}, ack) => {
    const reply = (out) => { if (typeof ack === "function") ack(out); };
    try {
      const userId = socket.userId;
      const { sourceOccurrenceId, targetGridId, parentOccurrenceId = null, index = null, mode = "copy", sourceWindowId = null } = payload;
      if (!userId) return reply({ ok: false, error: "not signed in" });
      if (!sourceOccurrenceId || !targetGridId) return reply({ ok: false, error: "what to copy, and where" });
      if (!(await Grid.exists({ _id: targetGridId, userId }))) return reply({ ok: false, error: "no such grid" });

      const sub = await readSubtree({ rootId: sourceOccurrenceId, userId, peekUserCache: peek });
      if (!sub) return reply({ ok: false, error: "the dragged item is gone" });
      if (sub.gridId === targetGridId) return reply({ ok: false, error: "already on this grid" });

      const ids = fieldIdsOf(sub);
      const [sourceFields, targetFields] = await Promise.all([
        Field.find({ userId, gridId: sub.gridId, id: { $in: ids } }).lean(),
        Field.find({ userId, gridId: targetGridId }).lean(),
      ]);
      const { map: fieldMap, created: newFields } = mapFields({
        fieldIds: ids, sourceFieldsById: Object.fromEntries(sourceFields.map((f) => [f.id, f])), targetFields, targetGridId, userId,
      });
      const parent = parentOccurrenceId ? await Occurrence.findOne({ id: parentOccurrenceId, userId, gridId: targetGridId }).lean() : null;
      if (parentOccurrenceId && !parent) return reply({ ok: false, error: "the drop spot is gone" });
      const plan = planGridCopy({ rootId: sourceOccurrenceId, sub, fieldMap, targetGridId, userId, parentId: parent?.id || null });

      const uc = await warm(userId, targetGridId);
      if (newFields.length) {
        await Field.insertMany(newFields, { ordered: false });
        for (const f of newFields) if (uc?.fieldsById) uc.fieldsById[f.id] = f;
      }
      if (plan.views.length) {
        await View.insertMany(plan.views, { ordered: false });
        for (const v of plan.views) if (uc?.viewsById) uc.viewsById[v.id] = v;
      }
      await persistImportResult({ result: { modules: plan.modules, occurrences: plan.occurrences }, userId, uc });

      // Place it where it was dropped (at the drop line), the same atomic list write a link uses.
      let parentAfter = null;
      if (parent) {
        const at = Number.isInteger(index) && index >= 0 ? index : (parent.occurrences || []).length;
        parentAfter = await Occurrence.findOneAndUpdate(
          { id: parent.id, userId, occurrences: { $ne: plan.rootId } },
          { $push: { occurrences: { $each: [plan.rootId], $position: at } } },
          { new: true },
        ).lean();
        if (parentAfter && uc?.occurrencesById?.[parent.id]) uc.occurrencesById[parent.id] = { ...uc.occurrencesById[parent.id], occurrences: parentAfter.occurrences };
      }

      const room = io.to(userRoom(userId));
      for (const f of newFields) room.emit("field_created", { field: f });
      for (const v of plan.views) room.emit("view_created", { view: v });
      for (const m of plan.modules) room.emit("module_created", { module: m });
      for (const o of plan.occurrences) room.emit("occurrence_created", { occurrence: o });
      if (parentAfter) room.emit("occurrence_updated", { occurrence: { ...(uc?.occurrencesById?.[parent.id] || parentAfter) } });

      // A doc draws its text, not its list: embed the copy there too.
      const parentModule = parent ? await Module.findOne({ id: parent.moduleId, userId }).lean() : null;
      if (parentModule?.kind === "doc") {
        const embedded = await embedRootInDocParent({ parentId: parent.id, childId: plan.rootId, userId });
        if (embedded) {
          if (uc?.occurrencesById?.[parent.id]) uc.occurrencesById[parent.id] = { ...uc.occurrencesById[parent.id], textmap: embedded.textmap };
          room.emit("occurrence_updated", { occurrence: { ...(uc?.occurrencesById?.[parent.id] || {}), id: parent.id, textmap: embedded.textmap } });
        }
      }

      if (mode === "move") room.emit("cross_grid_moved", { sourceOccurrenceId, sourceWindowId });
      console.log(`↔️  copy_to_grid ${sourceOccurrenceId} -> grid ${targetGridId}: ${plan.occurrences.length} rows, ${newFields.length} new fields${mode === "move" ? " (move)" : ""}`);
      reply({ ok: true, rootId: plan.rootId, rows: plan.occurrences.length, newFields: newFields.length, truncated: sub.truncated });
    } catch (e) {
      console.error("copy_to_grid error:", e);
      reply({ ok: false, error: e.message });
    }
  });
}
