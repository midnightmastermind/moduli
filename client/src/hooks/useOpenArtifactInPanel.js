// hooks/useOpenArtifactInPanel.js
//
// "Open in panel" for a FILE — an image, a video, a book, a pdf, a bookmark (user, 2026-10-16:
// "change save page to open in panel … which would open up the file in the panel (whether its
// image, video, etc)"). Keeping a book's page is a copy dragged out of Magic, so the reader no
// longer saves pages itself.
//
// One gesture, used by the viewer tile's header button and the book reader: the panel is the
// sticky target when one is set, else the panel the gesture came from (`fromPanelModuleId`, the
// viewer's origin panel), else the panel that holds the file. `openArtifactInPanel` owns the rest.
//
// The maps are read at CLICK time through the non-subscribing getters, so a viewer of many tiles
// does not re-render on every write.
import { useCallback } from "react";
import { toast } from "../state/notificationStore";
import { useGridActionsSelector } from "../GridActionsContext";
import { openArtifactInPanel } from "../helpers/openBookmark";
import { collectPanelOccurrences, enclosingPanelId } from "../helpers/targetPanel";

/** The panel OCCURRENCE for a panel MODULE id (`data-panel-id`), or null. */
export function panelOccForModuleId(moduleId, panelsById = {}) {
  if (!moduleId) return null;
  if (panelsById[moduleId]) return moduleId;
  const hits = Object.values(panelsById).filter((p) => p?.moduleId === moduleId);
  return hits.length === 1 ? hits[0].id : null;
}

export function useOpenArtifactInPanel() {
  const getOccMap = useGridActionsSelector((s) => s.getOccMap);
  const getModMap = useGridActionsSelector((s) => s.getModMap);
  const getViewMap = useGridActionsSelector((s) => s.getViewMap);
  const getState = useGridActionsSelector((s) => s.getState);
  const dispatch = useGridActionsSelector((s) => s.dispatch);
  const socket = useGridActionsSelector((s) => s.socket);

  return useCallback((occId, { fromPanelModuleId = null } = {}) => {
    const occurrencesById = getOccMap?.() || {};
    const modulesById = getModMap?.() || {};
    const panelsById = collectPanelOccurrences(occurrencesById, modulesById);
    const fromPanelOccId = panelOccForModuleId(fromPanelModuleId, panelsById)
      || enclosingPanelId(occId, occurrencesById, panelsById);
    const res = openArtifactInPanel({
      occId, grid: getState?.()?.grid || null, fromPanelOccId, panelsById,
      occurrencesById, modulesById, viewsById: getViewMap?.() || {}, dispatch, socket,
    });
    if (res.ok && res.via === "stale") toast("That panel is gone — opened here instead");
    else if (!res.ok) toast.error(res.reason || "Could not open this");
    return res;
  }, [getOccMap, getModMap, getViewMap, getState, dispatch, socket]);
}
