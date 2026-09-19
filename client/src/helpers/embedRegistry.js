// embedRegistry.js
// Tracks deleteNode callbacks for active moduleEmbed TipTap nodes, keyed by occurrenceId.
// DragProvider reads this to remove embed nodes when an embedded item is dragged out (move mode).
export const embedDeleteRegistry = new Map();

/**
 * An occurrence was DELETED: remove its embed node from the editor showing it.
 *
 * A moduleEmbed does not remove itself when its occurrence goes away — it draws
 * `embed: <id>`, and the host editor's next save writes that dead node straight
 * back into the textmap (user, 2026-09-19: un-picking a mood on the wheel left
 * `embed: 4edd87c8…` behind, and it was re-persisted after the server had
 * scrubbed it). Removing the node is an ordinary local edit, so the host saves
 * a clean textmap itself — no dependence on a sync reaching a focused editor.
 *
 * Called on the DELETE EVENT, never on "absent from the store": artifact
 * occurrences arrive in a deferred chunk, so absence is normal on every load.
 */
export function dropEmbedsOf(occurrenceId) {
  const remove = occurrenceId ? embedDeleteRegistry.get(occurrenceId) : null;
  if (!remove) return false;
  // SILENT: a sync, not a user edit — see ModuleEmbedNode's handler.
  try { remove({ silent: true }); } catch { /* the node may already be gone */ }
  return true;
}
