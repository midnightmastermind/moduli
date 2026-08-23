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
