// vr/decorLibrary.js — the VR office's decor library (user, 2026-10-21: "a
// library of custom assets to put places … so i can decorate the room").
//
// Built-in pieces (drawn in code, officeScene MAKERS) plus EVERY 3D model file
// on the grid: upload a .glb anywhere in Moduli and it is on the palette. No
// separate catalogue to keep in step — a model file IS a library entry.
import { resolveFileRef } from "../helpers/fileRef";

export const BUILTIN_DECOR = [
  { key: "armchair", title: "Armchair" },
  { key: "swivelchair", title: "Swivel chair" },
  { key: "ottoman", title: "Ottoman" },
  { key: "longtable", title: "Long table" },
  { key: "smalltable", title: "Small table" },
  { key: "desk", title: "Desk" },
  { key: "keyboard", title: "Keyboard" },
  { key: "tvframe", title: "TV frame" },
  { key: "recordplayer", title: "Record player" },
  { key: "vhsplayer", title: "VHS player" },
  { key: "clock", title: "Wall clock" },
  { key: "window", title: "Window" },
  { key: "couch", title: "Couch" },
  { key: "bed", title: "Queen bed" },
  { key: "lamp", title: "Floor lamp" },
  { key: "desklamp", title: "Desk lamp" },
  { key: "plant", title: "Plant" },
  { key: "rug", title: "Rug" },
  { key: "candle", title: "Candle" },
  { key: "gridscreen", title: "Grid screen" },
  { key: "notepad", title: "New note screen" },
  { key: "browser", title: "Browser screen" },
  { key: "claude", title: "Claude screen" },
];

/** Every 3D model on this grid: [{ key: "model:<occId>", occId, title, src }], by title. */
export function decorModels({ grid, occurrencesById, modulesById } = {}) {
  const gridId = grid?._id || grid?.id || null;
  const out = [];
  const seen = new Set();
  for (const occ of Object.values(occurrencesById || {})) {
    const mod = modulesById?.[occ?.moduleId];
    if (mod?.role !== "artifact" || mod.kind !== "model" || !mod.fileRef || mod.trashed) continue;
    if (gridId && occ.gridId && occ.gridId !== gridId) continue;
    // One entry per FILE: the same model placed on two pages is one piece of decor.
    if (seen.has(mod.id)) continue;
    seen.add(mod.id);
    const title = (occ.label || mod.label || mod.meta?.originalName || "Model").replace(/\.(glb|gltf)$/i, "");
    out.push({ key: "model:" + occ.id, occId: occ.id, title, src: resolveFileRef(mod.fileRef) });
  }
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** The whole library, built-ins first. */
export function decorLibrary(ctx) {
  return [...BUILTIN_DECOR, ...decorModels(ctx)];
}

/** One page of the palette's decor list. */
export function decorPage(items, page, perPage) {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const p = ((page % pages) + pages) % pages;
  return { items: items.slice(p * perPage, p * perPage + perPage), page: p, pages };
}
