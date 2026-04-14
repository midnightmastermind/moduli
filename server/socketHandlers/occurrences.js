// socketHandlers/occurrences.js — update_occurrence + break_link + request_textmap
import Occurrence from "../models/Occurrence.js";
import Transaction from "../models/Transaction.js";
import { nanoid } from "nanoid";
import { compressTextmap, decompressTextmap } from "../utils/textmapCompression.js";

export function registerOccurrenceHandlers(socket, {
  io, ensureUserCache, userCacheReady, loadUserIntoCache,
  userRoom,
}) {
  const userId = socket.userId;
  const getUc = async () => {
    const gId = socket.data.activeGridId;
    if (!userCacheReady(userId, gId)) await loadUserIntoCache(userId, gId);
    return ensureUserCache(userId, gId);
  };

  socket.on("update_occurrence", async ({ occurrence } = {}) => {
    try {
      if (!userId) return;
      const uc = await getUc();
      const id = occurrence?.id;
      if (!id) return;

      const prev = uc.occurrencesById[id] || {};

      // Store occurrence in cache — keep decompressed textmap so full_state can serve it
      const { textmap, ...occWithoutTextmap } = occurrence;
      const next = { ...prev, ...occWithoutTextmap, id, userId };
      if (textmap !== undefined) next.textmap = textmap; // keep raw (decompressed) textmap in cache
      uc.occurrencesById[id] = next;

      // Compress textmap before persisting to DB
      const dbDoc = textmap !== undefined
        ? { ...next, textmap: compressTextmap(textmap) }
        : next;

      // Create MeasureOp transaction when fields change
      if (occurrence.fields && Object.keys(occurrence.fields).length > 0) {
        const ops = [];
        for (const [fieldId, fieldValue] of Object.entries(occurrence.fields)) {
          const prevFieldVal = prev.fields?.[fieldId];
          const newVal = fieldValue?.value ?? fieldValue;
          const oldVal = prevFieldVal?.value ?? prevFieldVal;
          const flow = fieldValue?.flow || "in";
          ops.push({ type: "measure", measure: { occurrenceId: id, fieldId, value: newVal, previousValue: oldVal, flow } });
        }
        if (ops.length > 0) {
          const tx = new Transaction({
            id: nanoid(12), userId, gridId: next.gridId,
            type: "MeasureOp", timestamp: new Date(),
            operations: ops, state: "applied",
          });
          await tx.save();
          const txJson = tx.toJSON();
          socket.emit("transaction_created", { transaction: txJson });
          socket.to(userRoom(userId)).emit("transaction_created", { transaction: txJson });
        }
      }

      await Occurrence.findOneAndUpdate({ id, userId }, dbDoc, { upsert: true });

      // Broadcast includes textmap so other windows get it
      const broadcastOcc = textmap !== undefined ? { ...next, textmap } : next;
      socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: broadcastOcc });

      // Propagate to copy-linked occurrences
      if (next.linkedGroupId) {
        const linkedOccs = Object.values(uc.occurrencesById || {}).filter(
          o => o.linkedGroupId === next.linkedGroupId && o.id !== id
        );
        for (const linked of linkedOccs) {
          const patch = {};
          if (occurrence.fields && Object.keys(occurrence.fields).length > 0) {
            patch.fields = { ...(linked.fields || {}), ...occurrence.fields };
          }
          if (textmap !== undefined) patch.textmap = textmap;
          if (Object.keys(patch).length === 0) continue;
          const updatedLinked = { ...linked, ...patch };
          const { textmap: linkedTextmap, ...linkedWithoutTextmap } = updatedLinked;
          // Keep decompressed textmap in cache
          uc.occurrencesById[linked.id] = linkedTextmap !== undefined
            ? { ...linkedWithoutTextmap, textmap: linkedTextmap }
            : linkedWithoutTextmap;
          const linkedDbDoc = linkedTextmap !== undefined
            ? { ...linkedWithoutTextmap, textmap: compressTextmap(linkedTextmap) }
            : linkedWithoutTextmap;
          await Occurrence.findOneAndUpdate({ id: linked.id, userId }, linkedDbDoc, { upsert: true });
          socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: updatedLinked });
          socket.emit("occurrence_updated", { occurrence: updatedLinked });
        }
      }
    } catch (err) {
      console.error("update_occurrence error:", err);
      socket.emit("server_error", "Failed to update occurrence");
    }
  });

  // Lazy textmap fetch — client requests textmaps for specific occurrence IDs
  // (e.g. when a doc container comes into view for the first time)
  socket.on("request_textmap", async ({ occurrenceIds } = {}) => {
    try {
      if (!userId || !Array.isArray(occurrenceIds) || occurrenceIds.length === 0) return;
      const docs = await Occurrence.find({ id: { $in: occurrenceIds }, userId })
        .select("id textmap").lean();
      const result = docs
        .filter(o => o.textmap)
        .map(o => ({ id: o.id, textmap: decompressTextmap(o.textmap) }));
      if (result.length > 0) socket.emit("textmaps_loaded", result);
    } catch (err) {
      console.error("request_textmap error:", err);
    }
  });

  socket.on("break_link", async ({ occurrenceId } = {}) => {
    try {
      if (!userId || !occurrenceId) return;
      const uc = await getUc();
      const occ = await Occurrence.findOne({ id: occurrenceId, userId });
      if (!occ) return socket.emit("server_error", "Occurrence not found");
      occ.linkedGroupId = null;
      await occ.save();
      const occObj = occ.toObject();
      if (occObj.textmap) occObj.textmap = decompressTextmap(occObj.textmap);
      uc.occurrencesById[occurrenceId] = { ...uc.occurrencesById[occurrenceId], ...occObj, id: occurrenceId };
      io.to(userRoom(userId)).emit("occurrence_updated", { occurrence: occObj });
    } catch (err) {
      console.error("break_link error:", err);
      socket.emit("server_error", "Failed to break link");
    }
  });
}
