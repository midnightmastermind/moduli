// socketHandlers/dayPages.js — create_day_page_occurrence, navigate_day_page, update_view
import Occurrence from "../models/Occurrence.js";
import View from "../models/View.js";
import Grid from "../models/Grid.js";

/** Find the "Scheduled Date" field ID for a grid, returns null if not found. */
function findScheduledDateFieldId(uc, gridId) {
  for (const f of Object.values(uc.fieldsById || {})) {
    if (f.name === "Scheduled Date" && f.gridId === gridId) return f.id;
  }
  return null;
}

/** Build a fields object with scheduledDate set to the given ISO date string. */
function makeScheduledDateFields(scheduledDateFieldId, dateISO) {
  if (!scheduledDateFieldId) return {};
  return { [scheduledDateFieldId]: { value: dateISO, flow: "in", timestamp: new Date() } };
}

export function registerDayPageHandlers(socket, {
  ensureUserCache, userCacheReady, loadUserIntoCache, userRoom,
}) {
  const userId = socket.userId;

  // Create (or find existing) occurrence of a module for a specific date.
  // Date is stored in meta.date (ISO string). No legacy iteration field.
  socket.on("create_day_page_occurrence", async ({ occurrenceId: providedId, moduleId, containerId, date, fields, gridId, userId: _uid } = {}) => {
    try {
      if (!userId || !moduleId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const resolvedGridId = gridId || Object.values(uc.gridsById)[0]?._id?.toString?.() || Object.keys(uc.gridsById)[0];
      if (!resolvedGridId) return;

      const targetDateStr = date ? new Date(date).toDateString() : new Date().toDateString();
      const existingOcc = Object.values(uc.occurrencesById).find(o =>
        o.targetId === moduleId && o.gridId === resolvedGridId &&
        o.meta?.date && new Date(o.meta.date).toDateString() === targetDateStr
      );

      if (existingOcc) {
        socket.emit("occurrence_created", { occurrence: existingOcc, alreadyExisted: true, _requestedId: providedId });
        return;
      }

      const id = providedId || crypto.randomUUID();
      const dateISO = new Date(date || Date.now()).toISOString();
      const scheduledDateFieldId = findScheduledDateFieldId(uc, resolvedGridId);
      const occurrenceData = {
        id, userId, targetId: moduleId, targetType: "module",
        gridId: resolvedGridId, parentId: containerId || null,
        meta: { date: dateISO },
        fields: { ...makeScheduledDateFields(scheduledDateFieldId, dateISO), ...(fields || {}) },
        textmap: null, viewId: null, occurrences: [],
        filterOverride: null, hidden: false,
      };
      uc.occurrencesById[id] = occurrenceData;
      await Occurrence.findOneAndUpdate({ id, userId }, occurrenceData, { upsert: true });
      socket.emit("occurrence_created", { occurrence: occurrenceData });
      socket.to(userRoom(userId)).emit("occurrence_created", { occurrence: occurrenceData });
    } catch (err) {
      console.error("create_day_page_occurrence error:", err);
      socket.emit("server_error", "Failed to create day page occurrence");
    }
  });

  socket.on("navigate_day_page", async ({ moduleId, viewId, date, gridId: reqGridId } = {}) => {
    try {
      if (!userId || !moduleId || !viewId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const resolvedGridId = reqGridId || Object.values(uc.gridsById)[0]?._id?.toString?.() || Object.keys(uc.gridsById)[0];
      if (!resolvedGridId) return;

      const targetDate = date ? new Date(date) : new Date();
      const targetDateStr = targetDate.toDateString();
      const moduleOccs = Object.values(uc.occurrencesById).filter(o => o.targetId === moduleId && o.gridId === resolvedGridId);

      const existingOcc = moduleOccs.find(o =>
        o.meta?.date && new Date(o.meta.date).toDateString() === targetDateStr
      );

      let occId;
      if (existingOcc) {
        occId = existingOcc.id;
      } else {
        // Copy textmap from most recent day page as starting point
        const sortedOccs = moduleOccs
          .filter(o => o.meta?.date)
          .sort((a, b) => new Date(b.meta.date) - new Date(a.meta.date));
        const templateTextmap = sortedOccs[0]?.textmap || { type: "doc", content: [] };
        const parentId = sortedOccs[0]?.parentId || null;
        occId = crypto.randomUUID();
        const dateISO = targetDate.toISOString();
        const scheduledDateFieldId = findScheduledDateFieldId(uc, resolvedGridId);
        const newOcc = {
          id: occId, userId, targetId: moduleId, targetType: "module",
          gridId: resolvedGridId, parentId,
          meta: { date: dateISO },
          fields: makeScheduledDateFields(scheduledDateFieldId, dateISO),
          textmap: templateTextmap, viewId: null, occurrences: [],
          filterOverride: null, hidden: false,
        };
        uc.occurrencesById[occId] = newOcc;
        await Occurrence.findOneAndUpdate({ id: occId, userId }, newOcc, { upsert: true });
        socket.emit("occurrence_created", { occurrence: newOcc });
        socket.to(userRoom(userId)).emit("occurrence_created", { occurrence: newOcc });

        // Auto-fill from defaultDayPageTemplateId if set on the grid
        const grid = uc.gridsById[resolvedGridId];
        const defaultTemplateId = grid?.defaultDayPageTemplateId;
        if (defaultTemplateId) {
          const template = (grid.templates || []).find(t => t.id === defaultTemplateId);
          if (template?.items?.length) {
            const sfFieldId = findScheduledDateFieldId(uc, resolvedGridId);
            const sfFields = sfFieldId ? { [sfFieldId]: { value: dateISO, flow: "in", timestamp: new Date() } } : {};
            const childOccIds = [];
            for (const item of template.items) {
              if (!item.instanceId) continue;
              const itemOccId = crypto.randomUUID();
              const itemOcc = {
                id: itemOccId, userId, targetId: item.instanceId, targetType: "module",
                gridId: resolvedGridId, parentId: occId,
                meta: { date: dateISO },
                fields: { ...sfFields, ...(item.fieldDefaults || {}) },
                textmap: null, viewId: null, occurrences: [],
                filterOverride: null, hidden: false,
              };
              uc.occurrencesById[itemOccId] = itemOcc;
              childOccIds.push(itemOccId);
              await Occurrence.findOneAndUpdate({ id: itemOccId, userId }, itemOcc, { upsert: true });
              socket.emit("occurrence_created", { occurrence: itemOcc });
              socket.to(userRoom(userId)).emit("occurrence_created", { occurrence: itemOcc });
            }
            if (childOccIds.length > 0) {
              newOcc.occurrences = childOccIds;
              uc.occurrencesById[occId] = newOcc;
              await Occurrence.findOneAndUpdate({ id: occId, userId }, { occurrences: childOccIds });
              socket.emit("occurrence_updated", { occurrence: newOcc });
              socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: newOcc });
            }
          }
        }
      }

      const viewData = uc.viewsById[viewId];
      if (viewData && viewData.activeOccurrenceId !== occId) {
        viewData.activeOccurrenceId = occId;
        await View.findOneAndUpdate({ id: viewId, userId }, { activeOccurrenceId: occId });
        socket.emit("view_updated", viewData);
        socket.to(userRoom(userId)).emit("view_updated", viewData);
      } else if (viewData) {
        socket.emit("view_updated", viewData);
      }
    } catch (err) {
      console.error("navigate_day_page error:", err);
      socket.emit("server_error", "Failed to navigate day page");
    }
  });

  socket.on("update_view", async ({ view } = {}) => {
    try {
      if (!userId || !view?.id) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const existing = uc.viewsById[view.id];
      if (!existing) return;
      const updated = { ...existing, ...view };
      uc.viewsById[view.id] = updated;
      await View.findOneAndUpdate({ id: view.id, userId }, { $set: view }, { new: true });
      socket.to(userRoom(userId)).emit("view_updated", updated);
    } catch (err) {
      console.error("update_view error:", err);
      socket.emit("server_error", "Failed to update view");
    }
  });
}
