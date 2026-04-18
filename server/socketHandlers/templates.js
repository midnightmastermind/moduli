// socketHandlers/templates.js — save_template + fill_from_template
import Grid from "../models/Grid.js";
import Occurrence from "../models/Occurrence.js";
import Field from "../models/Field.js";

export function registerTemplateHandlers(socket, {
  ensureUserCache, userCacheReady, loadUserIntoCache,
  userRoom, createOccurrenceData,
}) {
  const userId = socket.userId;
  const getUc = async () => {
    const gId = socket.data.activeGridId;
    if (!userCacheReady(userId, gId)) await loadUserIntoCache(userId, gId);
    return ensureUserCache(userId, gId);
  };

  socket.on("save_template", async ({ gridId, template } = {}) => {
    try {
      if (!userId || !gridId || !template?.id) return;
      // Templates are stored on the Grid doc — read/write DB directly
      const grid = await Grid.findOne({ _id: gridId, userId }).lean();
      if (!grid) return;
      const templates = [...(grid.templates || [])];
      const idx = templates.findIndex(t => t.id === template.id);
      if (idx >= 0) templates[idx] = { ...templates[idx], ...template };
      else templates.push(template);
      await Grid.findOneAndUpdate({ _id: gridId, userId }, { templates }, { upsert: true });
      socket.to(userRoom(userId)).emit("grid_updated", { gridId, grid: { templates } });
    } catch (err) {
      console.error("save_template error:", err);
    }
  });

  socket.on("fill_from_template", async ({ gridId, templateId, containerId, date } = {}) => {
    try {
      if (!userId || !gridId || !templateId || !containerId) return;
      const uc = await getUc();
      const grid = await Grid.findOne({ _id: gridId, userId }).lean();
      if (!grid) return;
      const template = (grid.templates || []).find(t => t.id === templateId);
      if (!template?.items?.length) return;

      // Find date field for this grid (to set on new occurrences if date is provided)
      const dateField = Object.values(uc.fieldsById || {}).find(f => f.name === "Date" && f.gridId === gridId);
      const dateISO = date ? new Date(date).toISOString() : null;
      const dateFields = (dateField && dateISO)
        ? { [dateField.id]: { value: dateISO, flow: "in", timestamp: new Date() } }
        : {};

      const createdOccurrences = [];

      for (const item of template.items) {
        if (!item.instanceId) continue;
        const occId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const occ = createOccurrenceData({
          id: occId, userId,
          targetType: "module", targetId: item.instanceId,
          gridId,
          fields: { ...dateFields, ...(item.fieldDefaults || {}) },
          meta: dateISO ? { date: dateISO } : {},
          ...(item.linkedGroupId ? { linkedGroupId: item.linkedGroupId } : {}),
        });
        uc.occurrencesById[occId] = occ;
        await Occurrence.findOneAndUpdate({ id: occId, userId }, occ, { upsert: true });
        createdOccurrences.push(occ);
      }

      const containerOcc = Object.values(uc.occurrencesById).find(o => o.targetId === containerId);
      if (containerOcc) {
        const newOccIds = createdOccurrences.map(o => o.id);
        containerOcc.occurrences = [...(containerOcc.occurrences || []), ...newOccIds];
        uc.occurrencesById[containerOcc.id] = containerOcc;
        await Occurrence.findOneAndUpdate({ id: containerOcc.id, userId }, containerOcc, { upsert: true });
        socket.emit("occurrence_updated", { occurrence: containerOcc });
        socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: containerOcc });
      }

      for (const occ of createdOccurrences) {
        socket.emit("occurrence_created", { occurrence: occ });
        socket.to(userRoom(userId)).emit("occurrence_created", { occurrence: occ });
      }
    } catch (err) {
      console.error("fill_from_template error:", err);
    }
  });
}
