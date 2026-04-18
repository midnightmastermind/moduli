// embedRegistry.js
// Tracks deleteNode callbacks for active moduleEmbed TipTap nodes, keyed by occurrenceId.
// DragProvider reads this to remove embed nodes when an embedded item is dragged out (move mode).
export const embedDeleteRegistry = new Map();
