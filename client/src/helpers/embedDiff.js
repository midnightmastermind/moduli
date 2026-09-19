// helpers/embedDiff.js
//
// Apply an operation's textmap write as the SMALLEST change, not a replace.
//
// User, 2026-09-19: *"after clicking on an emotion, the entire daypage moves up
// again ... we need it to not restart back to the top everytime i selected a
// mood."* An op write that reached the day column was applied with
// `setContent` — which rebuilds EVERY node view in the column, the Emotions
// Wheel's canvas included. While they re-mount the column's height collapses
// and the scroll clamps to the top. It also re-created the Check In's own node
// view, whose cleanup then unregistered its successor, so the delete that
// un-picking sends found nothing to remove (the ghost `embed: <id>`).
//
// The Mood op's writes differ from what the editor holds ONLY by top-level
// moduleEmbed nodes added or removed. That case is applied as node-level
// deletes and inserts, leaving every other node — and its view — untouched.
// Anything else returns null and the caller keeps its full replace.

const embedId = (n) => (n?.type === "moduleEmbed" ? n.attrs?.occurrenceId || null : null);
// The editor appends an empty paragraph after a trailing atom (TipTap's
// trailing-node rule) and a column's textmap may carry one too, so empty lines
// are layout, not content, for this comparison.
const isEmptyPara = (n) => n?.type === "paragraph" && !(Array.isArray(n.content) && n.content.length);

/**
 * PURE. `oldNodes`/`newNodes` are top-level node JSON arrays.
 * @returns {{ remove: string[], insert: {afterId: string|null, node: object}[] } | null}
 *   null when the two differ by anything other than top-level embeds.
 */
export function planEmbedDiff(oldNodes, newNodes) {
  if (!Array.isArray(oldNodes) || !Array.isArray(newNodes)) return null;
  const oldIds = new Set(oldNodes.map(embedId).filter(Boolean));
  const newIds = new Set(newNodes.map(embedId).filter(Boolean));
  const removed = [...oldIds].filter((id) => !newIds.has(id));
  const addedSet = new Set([...newIds].filter((id) => !oldIds.has(id)));
  if (!removed.length && !addedSet.size) return null;

  const strip = (arr, drop) => arr.filter((n) => !isEmptyPara(n) && !drop.has(embedId(n)));
  if (JSON.stringify(strip(oldNodes, new Set(removed))) !== JSON.stringify(strip(newNodes, addedSet))) return null;

  // Each added embed goes right after the embed that precedes it in the target.
  const insert = [];
  let lastEmbed = null;
  for (const n of newNodes) {
    const id = embedId(n);
    if (!id) continue;
    if (addedSet.has(id)) insert.push({ afterId: lastEmbed, node: n });
    lastEmbed = id;
  }
  return { remove: removed, insert };
}

/** Top-level position of the embed for `id`, or -1. */
function topLevelPos(doc, id) {
  let pos = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const c = doc.child(i);
    if (c.type.name === "moduleEmbed" && c.attrs?.occurrenceId === id) return pos;
    pos += c.nodeSize;
  }
  return -1;
}

/**
 * Apply a plan to a live TipTap editor in ONE transaction that is neither an
 * undo step nor an `onUpdate` (it mirrors a write that is already persisted).
 * @returns {boolean} whether it applied.
 */
export function applyEmbedDiff(editor, plan) {
  if (!editor || editor.isDestroyed || !plan) return false;
  const { state } = editor;
  let tr = state.tr;
  for (const id of plan.remove) {
    const at = topLevelPos(tr.doc, id);
    if (at < 0) continue;
    tr = tr.delete(at, at + tr.doc.nodeAt(at).nodeSize);
  }
  for (const { afterId, node } of plan.insert) {
    let pmNode;
    try { pmNode = state.schema.nodeFromJSON(node); } catch { return false; }
    let at = 0;
    if (afterId) {
      const prev = topLevelPos(tr.doc, afterId);
      if (prev < 0) return false;
      at = prev + tr.doc.nodeAt(prev).nodeSize;
    }
    tr = tr.insert(at, pmNode);
  }
  tr.setMeta("addToHistory", false);
  tr.setMeta("preventUpdate", true);
  editor.view.dispatch(tr);
  return true;
}

/** PURE — two docs equal once empty paragraphs (layout) are ignored. */
export function sameIgnoringEmptyLines(a, b) {
  const strip = (d) => (Array.isArray(d?.content) ? d.content : []).filter((n) => !isEmptyPara(n));
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}
