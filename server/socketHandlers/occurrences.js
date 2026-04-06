// socketHandlers/occurrences.js — update_occurrence + break_link (complex, with textmap/file sync)
import Occurrence from "../models/Occurrence.js";
import Transaction from "../models/Transaction.js";
import path from "path";
import fs from "fs";
import { nanoid } from "nanoid";
export function registerOccurrenceHandlers(socket, {
  io, ensureUserCache, userCacheReady, loadUserIntoCache,
  userRoom, serializeTipTapToMarkdown, uploadsDir,
}) {
  const userId = socket.userId;

  socket.on("update_occurrence", async ({ occurrence } = {}) => {
    try {
      if (!userId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const id = occurrence?.id;
      if (!id) return;

      const prev = uc.occurrencesById[id] || {};
      const next = { ...prev, ...occurrence, id, userId };
      uc.occurrencesById[id] = next;

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

      await Occurrence.findOneAndUpdate({ id, userId }, next, { upsert: true });

      // Textmap → file sync
      if (occurrence.textmap !== undefined && occurrence.textmap !== null) {
        try {
          const mdDir = path.join(uploadsDir, "md");
          if (!fs.existsSync(mdDir)) fs.mkdirSync(mdDir, { recursive: true });
          const mdContent = serializeTipTapToMarkdown(occurrence.textmap);
          fs.writeFileSync(path.join(mdDir, `${id}.md`), mdContent, "utf-8");
        } catch (err) {
          console.error("textmap sync failed:", err.message);
        }
      }

      socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: next });

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
          if (occurrence.textmap !== undefined) {
            patch.textmap = occurrence.textmap;
            try {
              const mdDir = path.join(uploadsDir, "md");
              if (!fs.existsSync(mdDir)) fs.mkdirSync(mdDir, { recursive: true });
              const mdContent = serializeTipTapToMarkdown(occurrence.textmap);
              fs.writeFileSync(path.join(mdDir, `${linked.id}.md`), mdContent, "utf-8");
            } catch (err) {
              console.error("textmap copylink sync failed:", err.message);
            }
          }
          if (Object.keys(patch).length === 0) continue;
          const updatedLinked = { ...linked, ...patch };
          uc.occurrencesById[linked.id] = updatedLinked;
          await Occurrence.findOneAndUpdate({ id: linked.id, userId }, updatedLinked, { upsert: true });
          socket.to(userRoom(userId)).emit("occurrence_updated", { occurrence: updatedLinked });
          socket.emit("occurrence_updated", { occurrence: updatedLinked });
        }
      }
    } catch (err) {
      console.error("update_occurrence error:", err);
      socket.emit("server_error", "Failed to update occurrence");
    }
  });

  socket.on("break_link", async ({ occurrenceId } = {}) => {
    try {
      if (!userId || !occurrenceId) return;
      if (!userCacheReady(userId)) await loadUserIntoCache(userId);
      const uc = ensureUserCache(userId);
      const occ = await Occurrence.findOne({ id: occurrenceId, userId });
      if (!occ) return socket.emit("server_error", "Occurrence not found");
      occ.linkedGroupId = null;
      await occ.save();
      const occObj = occ.toObject();
      uc.occurrencesById[occurrenceId] = { ...uc.occurrencesById[occurrenceId], ...occObj, id: occurrenceId };
      io.to(userRoom(userId)).emit("occurrence_updated", { occurrence: occObj });
    } catch (err) {
      console.error("break_link error:", err);
      socket.emit("server_error", "Failed to break link");
    }
  });
}
