// modules/pageCardRename.js
//
// RENAMING A PAGE — the one gesture the UI did not have.
//
// Found on poms 2026-09-23 while carrying out "rename the Appointments page to
// Schedule Types". A container renames by double-clicking its header label; a
// page had no path at all:
//
//   double-click the page header   nothing opens
//   the page header's radial       "Settings" is the PANEL's settings — both
//                                  handles in `.page-header` resolve to it
//   right-click its card           New * page · Set cover image… · Delete
//
// Only a FOLDER page could change name, and only by following its folder
// (`helpers/folderRename.planFolderPageRename`). Every other page — 214 of them
// on this grid — was stuck with the name it was created with.
//
// This is the decision, kept out of the component so it can be tested: the
// card's context menu is the surface (it already sets the cover and deletes),
// and the write is the SAME one a container's inline rename makes.
import * as CommitHelpers from "../helpers/CommitHelpers";

/**
 * @returns a context-menu item, or null when there is nothing to rename.
 *
 * `commit(next)` is separate from `onClick` so the host owns the prompt: the
 * card has no inline editor, and inventing one inside a portalled menu is how
 * the caret bugs in this repo start.
 */
export function buildRenameItem({ module, dispatch, socket, onStart = null }) {
  if (!module?.id) return null;

  // The MODULE's label, not the occurrence's. `occurrence.label` overrides one
  // PLACEMENT (that is what `labelTokens` writes); a page's name is a property
  // of the page, and a page is normally placed once.
  //
  // The whole module is spread because `updateModule` persists what it is
  // given — a partial write drops `meta`, `kind`, `fieldBindings` and whatever
  // else the page carries. That clobber is recorded in this repo twice.
  const commit = (next) => {
    const label = String(next ?? "").trim();
    if (!label || label === (module.label ?? "")) return false;   // same guard the container rename has
    CommitHelpers.updateModule({ dispatch, socket, module: { ...module, label }, emit: true });
    return true;
  };

  return { label: "Rename…", commit, onClick: () => onStart?.(module, commit) };
}
