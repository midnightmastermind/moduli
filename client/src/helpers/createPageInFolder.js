// helpers/createPageInFolder.js
import * as CommitHelpers from "./CommitHelpers";

// ─── createPageInFolder ──────────────────────────────────────────────────────
// Mint a page filed in a folder. Shared by the folder's "+" / "New page…" and a
// page row's "New page here", so every route makes the same shape.
// `moduleId` is the schema-canonical pointer PageFolder / pagesList / role
// lookups read; `targetId` is the legacy alias the server's createOccurrenceData
// still uses. A doc page renders its OWN textmap, so only it gets one.
export function createPageInFolder({ folderId, kind, sortOrder, state, dispatch, socket }) {
  const userId = state?.userId;
  const gridId = state?.grid?._id || state?.gridId;
  if (!folderId || !kind || !userId || !gridId || !dispatch || !socket) return null;
  const modId = crypto.randomUUID();
  const occId = crypto.randomUUID();
  CommitHelpers.createModule({
    dispatch, socket,
    module: { id: modId, userId, gridId, role: "page", kind, label: "Untitled" }, emit: true,
  });
  CommitHelpers.createOccurrence({
    dispatch, socket,
    occurrence: {
      id: occId, userId, gridId, moduleId: modId, targetId: modId, targetType: "module",
      parentId: folderId, sortOrder: sortOrder ?? 0, iteration: { mode: "persistent" },
      ...(kind === "doc" ? { textmap: { type: "doc", content: [{ type: "paragraph" }] } } : {}),
    }, emit: true,
  });
  return occId;
}
