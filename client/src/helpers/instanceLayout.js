// helpers/instanceLayout.js
//
// A PLACEMENT's own layout of its row (user, 2026-10-15): the label, the cover and
// each field are items in a NESTED tree of boxes, each box laid out as a row or a
// column, rearranged by dragging — "like the fields organizer … col 1 Completed,
// col 2 Movement, col 3 all the sets and weights, and inside that col 1 Set 1 +
// Weight 1, etc."
//
// Stored on the occurrence (per placement, the user's pick):
//   occurrence.meta.instanceLayout = {
//     tree:  { dir: "row" | "col", wrap?: false, grow?: true, items: [ "label" | "cover" | "field:<id>" | <group> ] },
//     cover: "layout" | "background" | "hidden",          // default "layout"
//     fieldStyles: { [fieldId]: { width, size, color, ownLine } },
//   }
// A field's hidden NAME is not here: it is the row's existing per-field flag
// (`occurrence.fields[id].hideName`, read by FieldRenderer), so there is one switch.
//
// Every function is pure and returns a NEW layout; nothing here touches the store.

export const LABEL = "label";
export const COVER = "cover";
export const fieldKey = (id) => `field:${id}`;
export const fieldIdOf = (key) => (typeof key === "string" && key.startsWith("field:") ? key.slice(6) : null);
const isGroup = (x) => !!x && typeof x === "object" && Array.isArray(x.items);

const clone = (x) => JSON.parse(JSON.stringify(x));

/** The layout a row starts from when its editor first opens: label, then the fields in a row, then the cover. */
export function defaultLayout(fieldIds = [], { hasCover = false } = {}) {
  const items = [LABEL, { dir: "row", items: fieldIds.map(fieldKey) }];
  if (hasCover) items.push(COVER);
  return { tree: { dir: "col", items }, cover: "layout", fieldStyles: {} };
}

/** Every item key the tree holds, in order. */
export function keysIn(tree) {
  const out = [];
  const walk = (g) => { for (const it of g?.items || []) { if (isGroup(it)) walk(it); else out.push(it); } };
  walk(tree);
  return out;
}

/**
 * The tree to DRAW: items that no longer exist are dropped, each key appears once,
 * and anything available but not placed (a field bound after the layout was made)
 * is appended to the root — a new binding must never vanish because a layout
 * predates it.
 */
export function resolveTree(layout, availableKeys) {
  const avail = new Set(availableKeys);
  const seen = new Set();
  const prune = (g) => ({
    ...(g?.wrap === false ? { wrap: false } : {}),
    ...(g?.grow ? { grow: true } : {}),
    dir: g?.dir === "row" ? "row" : "col",
    items: (g?.items || []).flatMap((it) => {
      if (isGroup(it)) return [prune(it)];
      if (!avail.has(it) || seen.has(it)) return [];
      seen.add(it);
      return [it];
    }),
  });
  const tree = prune(layout?.tree || { dir: "col", items: [] });
  const unplaced = availableKeys.filter((k) => !seen.has(k));
  tree.items.push(...unplaced);
  return { tree, unplaced };
}

/** The group at `path` (indices from the root), or null. */
export function groupAt(tree, path) {
  let g = tree;
  for (const i of path) { g = g?.items?.[i]; if (!isGroup(g)) return null; }
  return g;
}

function removeKey(g, key) {
  g.items = g.items.filter((it) => it !== key);
  for (const it of g.items) if (isGroup(it)) removeKey(it, key);
}

/** Move an item into the group at `path`, at `index` (end when null). */
export function moveItem(layout, key, path, index = null) {
  const next = clone(layout);
  // Resolve the destination BEFORE removing the item: taking it out of an earlier slot
  // in the same parent shifts the indices the path is written in, and the drop would
  // name a different box (or none).
  const g = groupAt(next.tree, path);
  if (!g) return layout;
  // `index` is the slot before the item dropped on; leaving an earlier slot in the same
  // group moves that item one place up.
  const from = g.items.indexOf(key);
  removeKey(next.tree, key);
  let at = index == null ? g.items.length : index;
  if (index != null && from > -1 && from < index) at -= 1;
  g.items.splice(Math.max(0, Math.min(at, g.items.length)), 0, key);
  return next;
}

/**
 * Move the item (a field key or a box) at `fromIndex` of the group at `fromPath` to slot
 * `toIndex` of the group at `toPath` — the row-layout editor's drag and drop (user,
 * 2026-10-27: "the arrows are too slow"). Slot 0 is the top of a box, so the top is always
 * reachable. A box can never go inside itself. Both groups are resolved BEFORE anything is
 * removed, so a path written against the old tree still names the right box. Returns the
 * same layout object when nothing would change.
 */
export function moveNode(layout, fromPath, fromIndex, toPath, toIndex) {
  const next = clone(layout);
  const src = groupAt(next.tree, fromPath);
  const dst = groupAt(next.tree, toPath);
  if (!src || !dst || fromIndex < 0 || fromIndex >= src.items.length) return layout;
  const item = src.items[fromIndex];
  if (isGroup(item)) {
    const self = [...fromPath, fromIndex];
    if (toPath.length >= self.length && self.every((v, i) => toPath[i] === v)) return layout;
  }
  let at = Math.max(0, Math.min(toIndex ?? dst.items.length, dst.items.length));
  if (src === dst && (at === fromIndex || at === fromIndex + 1)) return layout;
  src.items.splice(fromIndex, 1);
  if (src === dst && fromIndex < at) at -= 1;
  dst.items.splice(at, 0, item);
  return next;
}

/** Add an empty group inside the group at `path`; it runs the other way to its parent. */
export function addGroup(layout, path) {
  const next = clone(layout);
  const g = groupAt(next.tree, path);
  if (!g) return layout;
  // First in the box it was made in, so it shows up where you are looking (user, 2026-10-27).
  g.items.unshift({ dir: g.dir === "row" ? "col" : "row", items: [] });
  return next;
}

/** Remove the group at `path` (never the root); its items take its place in the parent. */
export function removeGroup(layout, path) {
  if (!path.length) return layout;
  const next = clone(layout);
  const parent = groupAt(next.tree, path.slice(0, -1));
  const i = path[path.length - 1];
  const g = parent?.items?.[i];
  if (!isGroup(g)) return layout;
  parent.items.splice(i, 1, ...g.items);
  return next;
}

/** Switch the group at `path` between rows and columns. */
export function toggleDir(layout, path) {
  const next = clone(layout);
  const g = groupAt(next.tree, path);
  if (!g) return layout;
  g.dir = g.dir === "row" ? "col" : "row";
  return next;
}

/** Merge a style patch into one field's style; a null/"" value removes that key. */
export function setFieldStyle(layout, fieldId, patch) {
  const next = clone(layout);
  const cur = { ...(next.fieldStyles?.[fieldId] || {}) };
  for (const [k, v] of Object.entries(patch)) { if (v === null || v === "" || v === false) delete cur[k]; else cur[k] = v; }
  next.fieldStyles = { ...(next.fieldStyles || {}) };
  if (Object.keys(cur).length) next.fieldStyles[fieldId] = cur; else delete next.fieldStyles[fieldId];
  return next;
}

/**
 * What a COPY of a placement carries from the original's meta (user, 2026-10-15:
 * "it should be copied with all the other stuff if copied"). One list so every copy
 * path — copy, copy-link, duplicate, an operation's COPY_LINK — carries the same.
 */
export const CARRIED_PLACEMENT_META = ["instanceLayout"];
export function carriedPlacementMeta(sourceOccurrence) {
  const out = {};
  for (const k of CARRIED_PLACEMENT_META) {
    const v = sourceOccurrence?.meta?.[k];
    if (v != null) out[k] = clone(v);
  }
  return out;
}

/** Set flags on the group at `path` (e.g. `{ wrap: false }`); a null value removes the flag. */
export function setGroupProps(layout, path, patch) {
  const next = clone(layout);
  const g = groupAt(next.tree, path);
  if (!g) return layout;
  for (const [k, v] of Object.entries(patch)) { if (v == null) delete g[k]; else g[k] = v; }
  return next;
}

/** Flex style for a drawn group. A group WRAPS (responsive) unless `wrap: false`. */
export function groupFlexStyle(group = {}) {
  const row = group.dir === "row";
  return {
    display: "flex",
    flexDirection: row ? "row" : "column",
    flexWrap: row && group.wrap !== false ? "wrap" : "nowrap",
    gap: row ? 6 : 3,
    alignItems: row ? "flex-start" : "stretch",
    minWidth: 0,
    ...(group.grow ? { flex: "1 1 0%" } : {}),
  };
}

export function setCoverMode(layout, mode) {
  return { ...clone(layout), cover: ["background", "hidden"].includes(mode) ? mode : "layout" };
}

const WIDTHS = { narrow: 80, wide: 220 };
const SIZES = { sm: 0.85, lg: 1.2 };
/** Inline style for a field's wrapper in the drawn layout. */
export function fieldWrapStyle(style = {}) {
  const s = {};
  if (style.width === "full" || style.ownLine) { s.flex = "1 1 100%"; s.width = "100%"; }
  else if (WIDTHS[style.width]) { s.width = WIDTHS[style.width]; s.flex = "0 0 auto"; }
  if (SIZES[style.size]) s.zoom = SIZES[style.size];
  if (style.color) { s.background = style.color; s.borderRadius = 999; }
  return s;
}

/**
 * The fields a row's layout arranges: the module's visible, non-media bindings, in binding order.
 * One definition for the editor and for "Apply to all", so the two cannot disagree about a shape.
 */
export function layoutFieldIds(module, fieldsById = {}) {
  return (module?.fieldBindings || [])
    .filter((b) => b?.fieldId && fieldsById[b.fieldId] && !b.hidden && b.role !== "media" && b.role !== "files")
    .map((b) => b.fieldId);
}

/**
 * Every OTHER placement a layout can be applied to as-is (user, 2026-10-16: "the exercise layout
 * and anything that can be reorganized in the same way in my routines and tasks"). A layout is
 * per placement, and every day's copy of a routine is its own placement — often its own module
 * (a template application clones the module) — so "the same row" is: an instance with the same
 * name whose layout fields are the same SET. A variant with other fields (Time 1 where this one
 * has Weight 1) is a different shape and is left alone; drawn with this layout it would append
 * its odd fields at the end.
 */
export function sameShapeTargets(sourceOcc, { occurrencesById = {}, modulesById = {}, fieldsById = {} } = {}) {
  const srcMod = sourceOcc ? modulesById[sourceOcc.moduleId] : null;
  if (!srcMod || srcMod.role !== "instance") return [];
  const label = (sourceOcc.label || srcMod.label || "").trim();
  const shape = [...layoutFieldIds(srcMod, fieldsById)].sort().join("|");
  const out = [];
  for (const o of Object.values(occurrencesById)) {
    if (!o || o.id === sourceOcc.id || o.meta?.feedSourceId) continue;
    const m = modulesById[o.moduleId];
    if (m?.role !== "instance") continue;
    if ((o.label || m.label || "").trim() !== label) continue;
    if ([...layoutFieldIds(m, fieldsById)].sort().join("|") !== shape) continue;
    out.push(o.id);
  }
  return out;
}
