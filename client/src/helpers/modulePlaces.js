// helpers/modulePlaces.js
// Where a module is shown, for its Settings (user, 2026-10-22: "have something that says theres this many of
// this module … and maybe list them … with its ancestory").
//
// A place is a placement of the module, named by the chain of things above it (folders › page › container).
// An uploaded file is different in one way: its placement in a Files folder is its HOME, not a place you look
// at, so it does not count — but a board or doc that LISTS or EMBEDS that home placement does (an upload
// dropped on a board stays filed in Files and is listed by the board).
// The viewer's hidden page, a folder page and a file's own page show files without placing them anywhere, so
// nothing under them counts.
import { cachedParentMap } from "./dragHitTesting.js";
import { isUploadedFile } from "./fileHome.js";
import { occurrenceDisplayLabel } from "./occurrenceLabel.js";

const MAX_DEPTH = 24;

const isHiddenHost = (o) => !!(o?.meta?.spreadFor || o?.meta?.folderPage || o?.meta?.artifactPage);

/** Names from the top down to the thing directly above `startId` — folders, then pages and containers. */
export function ancestryOf(startId, { occurrencesById = {}, modulesById = {}, foldersById = {} } = {}, parentByChild = null) {
  const pbc = parentByChild || cachedParentMap(occurrencesById);
  const names = [];
  const seen = new Set([startId]);
  let cur = occurrencesById[startId];
  let hidden = false;
  for (let depth = 0; cur && depth < MAX_DEPTH; depth++) {
    // A row filed in a folder is homed there, whatever else lists it.
    if (cur.parentId && foldersById[cur.parentId]) {
      let f = foldersById[cur.parentId];
      for (let d = 0; f && d < MAX_DEPTH; d++) {
        names.push(f.name || "Folder");
        f = f.parentId ? foldersById[f.parentId] : null;
      }
      break;
    }
    const nextId = pbc[cur.id] ?? cur.parentId ?? null;
    if (!nextId || seen.has(nextId)) break;
    seen.add(nextId);
    const next = occurrencesById[nextId];
    if (!next) break;
    if (isHiddenHost(next)) { hidden = true; break; }
    const mod = modulesById[next.moduleId];
    if (mod?.role === "panel") break; // "Panel A" says nothing about where the row is
    names.push(occurrenceDisplayLabel(next, mod, "Untitled"));
    cur = next;
  }
  return { path: names.reverse(), hidden };
}

const embedsId = (o, id) => {
  if (!o?.textmap || typeof o.textmap !== "object") return false;
  return JSON.stringify(o.textmap).includes(`"occurrenceId":"${id}"`);
};

/**
 * Every place `moduleId` is shown: `[{ occId, jumpId, path: [names…] }]`, top-down paths. `jumpId` is what
 * to open to see it (the lister, for a Files home shown on a board).
 */
export function modulePlaces(moduleId, maps = {}) {
  const { occurrencesById = {}, modulesById = {}, foldersById = {} } = maps;
  if (!moduleId) return [];
  const module = modulesById[moduleId];
  const pbc = cachedParentMap(occurrencesById);
  const all = Object.values(occurrencesById);
  const placements = all.filter((o) => o?.moduleId === moduleId);
  const fileHomes = new Set(
    isUploadedFile(module) ? placements.filter((o) => o.parentId && foldersById[o.parentId]).map((o) => o.id) : [],
  );
  const places = [];
  for (const p of placements) {
    if (fileHomes.has(p.id)) continue;
    const { path, hidden } = ancestryOf(p.id, maps, pbc);
    if (hidden) continue;
    // A placement renamed on its own (a day column, a copy) is told apart from its siblings by that name.
    const own = typeof p.label === "string" && p.label.trim() && p.label !== module?.label ? p.label : null;
    places.push({ occId: p.id, jumpId: p.id, path: own ? [...path, own] : path });
  }
  if (fileHomes.size) {
    for (const o of all) {
      if (!o || o.moduleId === moduleId || isHiddenHost(o)) continue;
      if (foldersById[o.id]) continue;
      for (const homeId of fileHomes) {
        if (!(o.occurrences || []).includes(homeId) && !embedsId(o, homeId)) continue;
        const { path, hidden } = ancestryOf(o.id, maps, pbc);
        if (hidden) continue;
        const own = occurrenceDisplayLabel(o, modulesById[o.moduleId], "Untitled");
        places.push({ occId: homeId, jumpId: o.id, path: [...path, own] });
      }
    }
  }
  return places;
}
