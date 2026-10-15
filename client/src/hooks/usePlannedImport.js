// hooks/usePlannedImport.js
//
// The two halves every "read it as occurrences" viewer shares — the image viewer's OCR Reader /
// OCR Magic and the book reader's Magic:
//
//   usePlannedImport  sends text to `import_plan`, which lays it out in a shape (reader = one
//                     textblock, magic = sections / textblocks / lists) WITHOUT writing anything,
//                     and returns the plan plus an isolated state `PagePreviewBody` can render.
//                     Plans are cached per shape + text, so flipping modes back is instant.
//   useSaveAsPage     the "keep it" button: the same text through `import_text` (which DOES write),
//                     filed as a page in Imports and opened in the panel the viewer sits in.
//
// They live here so the two viewers cannot drift apart on how a plan is made or where a saved page
// goes.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useGridActions } from "../GridActionsContext";
import { readerStateFromPlan } from "../helpers/readerPlan";
import { usePlannedRegistration } from "../helpers/plannedDrop";
import { ensureImportsFolderAndPage, createImportsDocPage } from "../helpers/importsFolder";
import { activatePageInPanel } from "../helpers/openOccurrenceInPanel";
import { collectPanelOccurrences, enclosingPanelId, panelOccIdForElement } from "../helpers/targetPanel";

export function usePlannedImport({ socket, gridId, content, format = "markdown", shape = "magic", title = "", enabled = true, reqPrefix = "plan" }) {
  const [plan, setPlan] = useState(null);
  const cache = useRef(new Map());
  const reqRef = useRef(0);
  useEffect(() => {
    if (!enabled || !content || !socket) { setPlan(null); return; }
    const key = `${shape} ${format} ${content}`;
    const req = ++reqRef.current;
    const hit = cache.current.get(key);
    if (hit) { setPlan(hit); return; }
    setPlan({ loading: true });
    socket.emit("import_plan", { content, format, gridId, shape, title, requestId: `${reqPrefix}${req}` }, (out) => {
      const res = out || { ok: false, error: "no reply" };
      if (res.ok) cache.current.set(key, res);
      if (reqRef.current === req) setPlan(res);
    });
  }, [enabled, content, format, shape, socket, gridId, title, reqPrefix]);
  const tree = useMemo(() => (plan?.ok ? readerStateFromPlan(plan) : null), [plan]);
  // While the view shows this plan, its pieces can be dragged out as copies (helpers/plannedDrop).
  usePlannedRegistration(enabled ? tree?.state || null : null);
  return { plan, tree };
}

/**
 * Returns `save({ content, format, shape, title }) → Promise<{ ok, error? }>`. `rootRef` is the
 * viewer's own element (to find the panel it is drawn in); `occurrence` is the fallback for that.
 */
export function useSaveAsPage({ socket, gridId: gridIdProp, userId: userIdProp, dispatch, rootRef, occurrence }) {
  const ctx = useGridActions() || {};
  const { state, occurrencesById, modulesById, viewsById, manifestsById, foldersById } = ctx;
  const gridId = gridIdProp || ctx.gridId || state?.gridId;
  const userId = userIdProp || ctx.userId || state?.userId;
  const disp = dispatch || ctx.dispatch;
  return useCallback(({ content, format = "markdown", shape = "magic", title = "" }) => new Promise((resolve) => {
    if (!content || !socket || !gridId) { resolve({ ok: false, error: "nothing to save" }); return; }
    socket.emit("import_text", { content, format, gridId, parentId: null, title, shape }, (out) => {
      if (!out?.ok || !out.rootOccurrenceId) { resolve({ ok: false, error: out?.error || "no reply" }); return; }
      const { folderId } = ensureImportsFolderAndPage({
        grid: state?.grid, manifests: Object.values(manifestsById || {}), folders: Object.values(foldersById || {}),
        occurrencesById, dispatch: disp, socket, userId,
      });
      const pageOccId = createImportsDocPage({ rootOccId: out.rootOccurrenceId, folderId, grid: state?.grid, dispatch: disp, socket, userId, label: title });
      const panelsById = collectPanelOccurrences(occurrencesById, modulesById);
      const panelId = panelOccIdForElement(rootRef?.current, panelsById) || enclosingPanelId(occurrence?.id, occurrencesById, panelsById);
      if (pageOccId && panelId) activatePageInPanel({ pageOccId, panelOccurrence: panelsById[panelId], modulesById, viewsById, dispatch: disp, socket });
      resolve({ ok: true, pageOccId });
    });
  }), [socket, gridId, userId, disp, state?.grid, manifestsById, foldersById, occurrencesById, modulesById, viewsById, rootRef, occurrence?.id]);
}
