// helpers/treeOrder.js
//
// The three questions every drop in the file tree and on a folder page asks,
// answered once (user, 2026-09-17: *"make sure i can drag and drop to reorder or
// move to a diff folder"*). The reorder math was written out four times inside
// ManifestTree, which is how one copy quietly stops agreeing with the others.

/**
 * Where on a row the pointer is. With `into`, the middle third means "drop INTO
 * this row" (a folder) and only the outer thirds reorder; without it the row
 * splits in half.
 */
export function edgeForPoint(rect, clientY, { into = false } = {}) {
  if (!rect || typeof clientY !== "number") return null;
  const rel = (clientY - rect.top) / Math.max(1, rect.height);
  if (into) {
    if (rel < 0.3) return "top";
    if (rel > 0.7) return "bottom";
    return "into";
  }
  return rel < 0.5 ? "top" : "bottom";
}

/**
 * The sortOrder that puts a dropped row just above (`top`) or below (`bottom`)
 * `targetId` among `siblings`. Midpoint between neighbours, so nothing else is
 * rewritten. The dragged row itself is ignored if it is in the list, or moving
 * a row one step down would land it on its own old value.
 */
export function sortOrderForDrop(siblings, targetId, edge, draggedId = null) {
  const sorted = (siblings || [])
    .filter((s) => s && s.id !== draggedId)
    .slice()
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const idx = sorted.findIndex((s) => s.id === targetId);
  if (idx === -1) {
    const max = sorted.reduce((m, s) => Math.max(m, s.sortOrder ?? 0), -1);
    return max + 1;
  }
  const mine = sorted[idx].sortOrder ?? 0;
  if (edge === "top") {
    const prev = sorted[idx - 1];
    return prev ? ((prev.sortOrder ?? 0) + mine) / 2 : mine - 1;
  }
  const next = sorted[idx + 1];
  return next ? (mine + (next.sortOrder ?? 0)) / 2 : mine + 1;
}

/** The end of a list: one past the highest sortOrder. */
export function sortOrderAtEnd(siblings) {
  return (siblings || []).reduce((m, s) => Math.max(m, s?.sortOrder ?? 0), -1) + 1;
}

/**
 * Would moving folder `draggedId` into `targetId` create a cycle? True when the
 * target IS the dragged folder or sits anywhere beneath it.
 */
export function wouldNestInsideItself(foldersById, draggedId, targetId) {
  let cur = targetId;
  for (let i = 0; i < 64 && cur; i++) {
    if (cur === draggedId) return true;
    cur = foldersById?.[cur]?.parentId ?? null;
  }
  return false;
}

/**
 * Pragmatic fires `onDrop` on EVERY accepting target under the pointer, innermost
 * first — so a page row inside a folder inside a folder gets three handlers for
 * one drop. Only the innermost one may act.
 */
export function isInnermostTarget(location, element) {
  return location?.current?.dropTargets?.[0]?.element === element;
}

/**
 * Which part of a CARD the pointer is over. Cards on a folder page sit in a
 * wrapping grid, so a reorder can be left/right as well as above/below. With
 * `into`, the middle of the card (both axes between 25% and 75%) means "drop
 * INTO this card" — a folder — and the rim reorders.
 */
export function cardZoneForPoint(rect, clientX, clientY, { into = false, horizontal = true } = {}) {
  if (!rect || typeof clientX !== "number" || typeof clientY !== "number") return null;
  const rx = (clientX - rect.left) / Math.max(1, rect.width);
  const ry = (clientY - rect.top) / Math.max(1, rect.height);
  if (into && rx >= 0.25 && rx <= 0.75 && ry >= 0.25 && ry <= 0.75) return "into";
  if (!horizontal) return ry < 0.5 ? "top" : "bottom";
  // Nearest edge wins.
  const d = { left: rx, right: 1 - rx, top: ry, bottom: 1 - ry };
  return Object.keys(d).reduce((a, b) => (d[b] < d[a] ? b : a));
}

const isFolderPage = (mod) => mod?.role === "page" && mod?.kind === "folder";
// What a folder may FILE. An instance or a container lives in a container's
// occurrences[]; giving it a folder parentId would strand it out of the place
// it renders, so those never move on a folder page.
const isFileable = (mod) => mod?.role === "page" || mod?.role === "artifact";

/**
 * What a drop on a folder-page card should do, or null to ignore it.
 *   { kind: "occ",    id, parentId, sortOrder }   re-file a page / artifact
 *   { kind: "folder", id, parentId, sortOrder }   move a sub-folder
 *
 * `zone` comes from `cardZoneForPoint`. A folder card is a folder-page
 * occurrence PARENTED TO its folder, so the folder it stands for is
 * `occ.parentId`. `childrenOf(folderId)` lists that folder's occurrences and
 * `foldersById` backs the cycle check.
 */
export function planFolderPageDrop({
  dragged, draggedModule, target, targetModule, zone,
  currentFolderId, siblings, childrenOf, foldersById,
}) {
  if (!dragged?.id || !target?.id || !zone || dragged.id === target.id) return null;
  const draggedIsFolder = isFolderPage(draggedModule);
  if (!draggedIsFolder && !isFileable(draggedModule)) return null;

  if (zone === "into") {
    if (!isFolderPage(targetModule)) return null;
    const destFolderId = target.parentId;
    if (!destFolderId) return null;
    if (draggedIsFolder) {
      const folderId = dragged.parentId;
      if (!folderId || folderId === destFolderId) return null;
      if (wouldNestInsideItself(foldersById, folderId, destFolderId)) return null;
      const kids = Object.values(foldersById || {}).filter((f) => f?.parentId === destFolderId);
      return { kind: "folder", id: folderId, parentId: destFolderId, sortOrder: sortOrderAtEnd(kids) };
    }
    if (dragged.parentId === destFolderId) return null;
    return { kind: "occ", id: dragged.id, parentId: destFolderId, sortOrder: sortOrderAtEnd(childrenOf?.(destFolderId)) };
  }

  const edge = zone === "left" || zone === "top" ? "top" : "bottom";
  const sortOrder = sortOrderForDrop(siblings, target.id, edge, dragged.id);
  if (draggedIsFolder) {
    // A sub-folder card only reorders among THIS folder's cards; one dragged in
    // from elsewhere has to be dropped INTO a folder to move.
    if (dragged.parentId && foldersById?.[dragged.parentId]?.parentId !== currentFolderId) return null;
    return { kind: "occ", id: dragged.id, parentId: dragged.parentId, sortOrder };
  }
  return { kind: "occ", id: dragged.id, parentId: currentFolderId, sortOrder };
}
