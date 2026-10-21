// helpers/deepLinkOpen.js — `/?open=<occurrenceId>` opens that occurrence in a
// panel, the way picking it from search does. Used by the VR office's
// bookshelf (public/vr), which hands a page or a file back to the real app:
// a headset cannot draw the app's own viewers inside a 3D scene, so the book
// opens in Moduli's page / file viewer in a browser window.
//
// A file (an artifact) opens as its own page, which is what shows the file
// viewer / book reader; anything else opens the page it lives on.
import { openArtifactInPanel } from "./openBookmark.js";
import { openOccurrenceInPanel } from "./openOccurrenceInPanel.js";
import { collectPanelOccurrences } from "./targetPanel.js";
import { pickPanelOccurrence } from "./lastPanel.js";

export const OPEN_PARAM = "open";

/** The id asked for in this address, or null. */
export function openParamFrom(search) {
  try { return new URLSearchParams(search || "").get(OPEN_PARAM) || null; } catch { return null; }
}

/** This address without the open parameter (so a reload does not open it again). */
export function withoutOpenParam(loc) {
  const q = new URLSearchParams(loc.search || "");
  q.delete(OPEN_PARAM);
  const s = q.toString();
  return loc.pathname + (s ? "?" + s : "") + (loc.hash || "");
}

/**
 * Open `occId`. Returns { ok, reason? }.
 * The caller must wait for the real grid (not the boot snapshot, which is
 * read-only, and not before the deferred half, which carries the files).
 */
export function openFromLink({ occId, grid, occurrencesById = {}, modulesById = {}, viewsById = {}, dispatch, socket }) {
  const occ = occurrencesById[occId];
  if (!occ) return { ok: false, reason: "not found" };
  const mod = modulesById[occ.moduleId];
  if (mod?.role === "artifact") {
    const res = openArtifactInPanel({
      occId, grid, fromPanelOccId: null,
      panelsById: collectPanelOccurrences(occurrencesById, modulesById),
      occurrencesById, modulesById, viewsById, dispatch, socket,
    });
    return res.ok ? { ok: true } : { ok: false, reason: res.reason || "could not open the file" };
  }
  const panelOccurrence = pickPanelOccurrence({ grid, occurrencesById });
  if (!panelOccurrence) return { ok: false, reason: "no panel to open in" };
  const res = openOccurrenceInPanel({ occId, panelOccurrence, occurrencesById, modulesById, viewsById, dispatch, socket });
  return res.ok ? { ok: true } : { ok: false, reason: "it is not on a page" };
}
