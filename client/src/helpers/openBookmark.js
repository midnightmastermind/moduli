// helpers/openBookmark.js
//
// Opening a bookmark artifact in a panel.
//
// Two existing pieces do the work; this only decides WHICH panel and joins them:
//
//   ensureArtifactPageOcc   finds-or-mints the display page that fronts an
//                           artifact. Idempotent via `meta.artifactPage`, so a
//                           bookmark opened ten times mints one page. This is
//                           the same path the tree and folder cards already use
//                           — navigating a panel straight at a bare artifact
//                           resolves to no page and snaps back to page 0.
//   openOccurrenceInPanel   pins that page to a panel and makes it active.
//
// The TARGET comes from `helpers/targetPanel`: the sticky grid-wide setting if
// one is live, otherwise the panel the gesture happened in — and a stale target
// falls back to the same place rather than swallowing the click.
import { ensureArtifactPageOcc } from "./importsFolder";
import { openOccurrenceInPanel } from "./openOccurrenceInPanel";
import { resolveOpenTarget } from "./targetPanel";
import { occurrenceUrl } from "./occurrenceUrl";
import * as CommitHelpers from "./CommitHelpers";

/**
 * @returns {{ ok: boolean, panelId: string|null, via: string, reason?: string }}
 * `via` is passed through so a caller can say "that panel is gone" and stay
 * silent in the ordinary case.
 */
export function openBookmarkInPanel({
  occId, grid, fromPanelOccId, panelsById = {},
  occurrencesById = {}, modulesById = {}, viewsById = {}, dispatch, socket,
}) {
  const occ = occurrencesById[occId];
  const mod = occ ? modulesById[occ.moduleId] : null;
  if (!occ || mod?.role !== "artifact") return { ok: false, panelId: null, via: "none", reason: "not an artifact" };

  const { panelId, via } = resolveOpenTarget(grid, fromPanelOccId, Object.keys(panelsById));
  const panelOccurrence = panelId ? panelsById[panelId] : null;
  if (!panelOccurrence) return { ok: false, panelId: null, via, reason: "no panel to open in" };

  // The page must exist BEFORE the pin, or the panel is asked to show an id
  // that does not resolve yet — the created-but-unlinked shape from the other
  // direction.
  const pageOccId = ensureArtifactPageOcc({
    artifactOccId: occId, occurrencesById, modulesById,
    gridId: occ.gridId, userId: occ.userId, dispatch, socket,
  });
  if (!pageOccId) return { ok: false, panelId, via, reason: "could not resolve an artifact page" };

  openOccurrenceInPanel({
    occId: pageOccId, panelOccurrence, occurrencesById, modulesById, viewsById, dispatch, socket,
  });
  return { ok: true, panelId, via };
}

// ── ANY ROW WITH A LINK, OPENED AS A PAGE ────────────────────────────────────
//
// User, 2026-09-10: *"there should be a button on the bottom right for all
// occurances that have a url field that opens up that browser page"* / *"that
// button ... should be opening the browser page in the panel we are in, not the
// viewer."*
//
// A bookmark IS a browser, so it opens as itself. Every other row — a song with
// its Spotify page, a Place with a Website — has a URL but is not a page, so it
// gets a BROWSER of its own: one bookmark per row, found again by
// `meta.browserFor`, so opening the same row ten times mints one.
//
// THE ROW'S OWN DATA IS NEVER WRITTEN. The browser is parented to the row (so
// deleting the row takes it with it — the cascade follows `parentId`) and is
// NOT listed in the row's `occurrences[]`: an instance does not render its
// children and the artifact spread reads `occurrences[]`, so listing it would
// add a file to a row that did not ask for one. The artifact page that fronts
// the browser lists it, which is what makes it reachable.
//
// ONLY A URL IN A FIELD QUALIFIES. `from: "fileRef"` is an artifact stored BY
// url — an image whose url IS the picture — and framing it shows the file the
// card already shows (the spread's own gate, `planSpreadBrowser`). `from:
// "link"` is a link chip, which carries its own open arrow.

/** The browser minted for a row, if one exists. */
export function browserForOccurrence(ownerOccId, occurrencesById) {
  if (!ownerOccId) return null;
  return Object.values(occurrencesById || {}).find((o) => o?.meta?.browserFor === ownerOccId) || null;
}

/** Does this row get an open-as-page button? */
export function canOpenUrlAsPage(occurrence, module, fieldsById = {}) {
  if (!occurrence) return false;
  if (module?.role === "artifact" && module?.kind === "bookmark") return true;
  return occurrenceUrl(occurrence, { module, fieldsById })?.from === "field";
}

// A browser minted a moment ago is not in the maps yet — the store catches up on
// the next render, and a double click lands before it. Remembered here so the
// second call reuses it instead of minting another. Same job `browserMintRef`
// does for the spread's url tile.
const pendingBrowsers = new Map();

export function openUrlInPanel({
  occId, grid, fromPanelOccId, panelsById = {},
  occurrencesById = {}, modulesById = {}, viewsById = {}, fieldsById = {}, dispatch, socket,
}) {
  const occ = occurrencesById[occId];
  const mod = occ ? modulesById[occ.moduleId] : null;
  if (!occ) return { ok: false, panelId: null, via: "none", reason: "nothing to open" };
  const common = { grid, fromPanelOccId, panelsById, viewsById, dispatch, socket };

  if (mod?.role === "artifact" && mod?.kind === "bookmark") {
    return openBookmarkInPanel({ occId, occurrencesById, modulesById, ...common });
  }

  const hit = occurrenceUrl(occ, { module: mod, fieldsById });
  if (hit?.from !== "field") return { ok: false, panelId: null, via: "none", reason: "no link to open" };

  // Refuse BEFORE minting: a click with nowhere to go must not leave a browser
  // behind that nothing will ever show.
  const { panelId, via } = resolveOpenTarget(grid, fromPanelOccId, Object.keys(panelsById));
  if (!panelId || !panelsById[panelId]) return { ok: false, panelId: null, via, reason: "no panel to open in" };

  let bmOcc = browserForOccurrence(occId, occurrencesById);
  let bmMod = bmOcc ? modulesById[bmOcc.moduleId] : null;
  if (bmOcc) pendingBrowsers.delete(occId);
  else if (pendingBrowsers.has(occId)) ({ occurrence: bmOcc, module: bmMod } = pendingBrowsers.get(occId));

  if (bmOcc && bmMod) {
    // The row's url was edited since the browser was made. A browser still
    // pointing at the old address is wrong data, not merely stale.
    if (bmMod.fileRef !== hit.url) {
      bmMod = { ...bmMod, fileRef: hit.url };
      bmOcc = { ...bmOcc, meta: { ...(bmOcc.meta || {}), url: hit.url } };
      CommitHelpers.updateModule({ dispatch, socket, module: bmMod });
      CommitHelpers.updateOccurrence({ dispatch, socket, occurrence: bmOcc });
    }
  } else {
    const made = CommitHelpers.addBookmarkOccurrence({
      dispatch, socket, gridId: occ.gridId, userId: occ.userId,
      containerOccurrence: occ, url: hit.url,
      label: occ.label || mod?.label || null,
      list: false, meta: { browserFor: occId },
    });
    if (!made) return { ok: false, panelId, via, reason: "could not make a browser for this link" };
    bmOcc = made.occurrence;
    bmMod = made.module;
    pendingBrowsers.set(occId, { occurrence: bmOcc, module: bmMod });
  }

  return openBookmarkInPanel({
    occId: bmOcc.id,
    occurrencesById: { ...occurrencesById, [bmOcc.id]: bmOcc },
    modulesById: { ...modulesById, [bmMod.id]: bmMod },
    ...common,
  });
}

/** Test seam: forget remembered in-flight browsers. */
export function _resetPendingBrowsers() { pendingBrowsers.clear(); }
