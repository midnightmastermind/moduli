// helpers/artifactUpload.js
// ============================================================
// ONE place that turns dropped OS files into role:"artifact" occurrences.
//
// Every file-drop surface — board/list containers, canvas pages, doc &
// table-cell editors, empty grid cells — mints its placeholders + uploads
// through here, so "drop an upload → it becomes an instance of the file" is
// byte-identical behavior everywhere (audit 2026-07-14).
//
// Split of responsibility:
//   • THIS module owns the UPLOAD LIFECYCLE — optimistic placeholder module +
//     occurrence, progress reporting, the batched toast, error/cancel state,
//     and re-persisting the placement after the server mints the (bare)
//     occurrence.
//   • The CALLER owns PLACEMENT — wiring the occurrence into a container's
//     occurrences[], a canvas child, a doc `moduleEmbed`, a table cell, etc.
// ============================================================
import { mimeToKind } from "./fileKind";
import { createModuleAction, createOccurrenceAction } from "../state/actions";
import * as CommitHelpers from "./CommitHelpers";
import { uploadFileWithProgress, registerUpload, clearUpload } from "./uploadWithProgress";
import { toast } from "../state/notificationStore";

function makeUUID() {
  return (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Build + locally dispatch one placeholder artifact module + occurrence per
// file. `occExtra(index) → { parentId?, meta? }` lets the caller stamp
// placement onto the occurrence up-front (canvas x/y, container parentId).
export function createArtifactPlaceholders(files, { gridId, userId, dispatch, occExtra = null }) {
  const placeholders = files.map((file, i) => {
    const moduleId = makeUUID();
    const occurrenceId = makeUUID();
    const kind = mimeToKind(file.type, file.name);
    const extra = (typeof occExtra === "function" ? occExtra(i) : occExtra) || {};
    return {
      file, moduleId, occurrenceId, kind,
      module: {
        id: moduleId, userId, gridId,
        role: "artifact", kind, label: file.name, fileRef: null,
        defaultDragMode: "copy",
        meta: {
          uploadStatus: "pending",
          originalName: file.name,
          mimeType: file.type,
          uploadSize: file.size,
        },
      },
      occurrence: {
        id: occurrenceId, userId, gridId, moduleId,
        ...(extra.parentId ? { parentId: extra.parentId } : {}),
        fields: {},
        meta: extra.meta || {},
      },
    };
  });
  for (const p of placeholders) {
    dispatch(createModuleAction(p.module));
    dispatch(createOccurrenceAction(p.occurrence));
  }
  return placeholders;
}

// Upload every placeholder's file to /api/artifacts/upload (idempotent on
// moduleId + occurrenceId — the ids are pre-minted). Batched progress toast.
//   • `containerOccurrenceId` is recorded on the upload registry so the
//     ArtifactCard cancel button can detach the placeholder from its parent.
//   • `persist(p) → { parentId?, meta? }` (optional): after a file lands, patch
//     the occurrence so the placement survives a reload. The optimistic
//     occurrence is never emitted, and the server mints a BARE occurrence
//     (no parentId / meta), so canvas x/y + parent ownership have to be
//     re-persisted here once the row exists server-side.
export function uploadArtifactPlaceholders(placeholders, {
  gridId, userId, dispatch, socket, containerOccurrenceId = null, persist = null,
}) {
  const total = placeholders.length;
  const toastId = total > 1 ? toast.loading(`Uploading ${total} files…`) : null;
  let uploaded = 0, failed = 0, cancelled = 0;

  const uploadOne = (p) => {
    const formData = new FormData();
    formData.append("file", p.file);
    formData.append("userId", userId);
    formData.append("gridId", gridId);
    formData.append("moduleId", p.moduleId);
    formData.append("occurrenceId", p.occurrenceId);

    const controller = new AbortController();
    let lastProgress = 0;
    registerUpload(p.occurrenceId, {
      abort: () => controller.abort(),
      moduleId: p.moduleId, occurrenceId: p.occurrenceId,
      containerOccurrenceId: containerOccurrenceId || null,
    });

    return uploadFileWithProgress({
      url: "/api/artifacts/upload",
      formData,
      signal: controller.signal,
      onProgress: (frac) => {
        const stepped = Math.min(1, Math.floor(frac * 20) / 20);
        if (stepped === lastProgress) return;
        lastProgress = stepped;
        CommitHelpers.updateModule({
          dispatch, socket,
          module: { id: p.moduleId, meta: { ...p.module.meta, uploadProgress: stepped } },
          emit: false,
        });
      },
    })
      .then(({ module: uploadedModule }) => {
        if (uploadedModule?.id) {
          CommitHelpers.updateModule({ dispatch, socket, module: uploadedModule, emit: false });
        }
        const place = persist ? persist(p) : null;
        if (place && (place.parentId || place.meta)) {
          CommitHelpers.updateOccurrence({
            dispatch, socket,
            occurrence: {
              id: p.occurrenceId,
              ...(place.parentId ? { parentId: place.parentId } : {}),
              ...(place.meta ? { meta: place.meta } : {}),
            },
            emit: true,
          });
        }
        uploaded++;
      })
      .catch(err => {
        if (err?.name === "AbortError") { cancelled++; return; }
        console.error("[FILE DROP] Upload error:", err);
        CommitHelpers.updateModule({
          dispatch, socket,
          module: { id: p.moduleId, meta: { ...p.module.meta, uploadStatus: "error" } },
          emit: false,
        });
        failed++;
      })
      .finally(() => {
        clearUpload(p.occurrenceId);
        if (toastId == null) return;
        const done = uploaded + failed + cancelled;
        if (done < total) {
          toast.loading(`Uploaded ${uploaded} of ${total}…`, { id: toastId });
        } else if (failed === 0 && cancelled === 0) {
          toast.success(`Uploaded ${total} files`, { id: toastId });
        } else if (uploaded === 0 && failed === 0) {
          toast.message(`Cancelled ${cancelled} upload${cancelled === 1 ? "" : "s"}`, { id: toastId });
        } else if (uploaded === 0) {
          toast.error(`All ${total} uploads failed`, { id: toastId });
        } else {
          const parts = [];
          if (uploaded > 0)  parts.push(`${uploaded} uploaded`);
          if (failed > 0)    parts.push(`${failed} failed`);
          if (cancelled > 0) parts.push(`${cancelled} cancelled`);
          toast.warning(parts.join(" · "), { id: toastId });
        }
      });
  };

  return Promise.all(placeholders.map(uploadOne));
}
