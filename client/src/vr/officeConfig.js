// vr/officeConfig.js — what the VR office keeps on the grid.
//
// grid.meta.vrOffice = {
//   shelves: [{ id, title, asset: "book"|"record"|"vhs", feed }],
//   screens: [{ id, title, source: "page"|"grid", pageOccId }],
// }
//
// A shelf is a SAVED QUERY, not a board (user, 2026-10-21: "it wouldnt be a
// board page, it would just be a query"). Its `feed` has the shape an
// occurrence feed has (conditions / roles / scope / sort / limit), so the
// app's own feed editor edits it and `resolveFeedItems` answers it. Nothing is
// copied: a shelf reads the grid each time it is drawn.
//
// Where each thing STANDS in the room stays in the browser for now (room
// anchors are plan §7) — this is only what the things ARE.
//
// Every function is pure and returns a new grid meta; the caller writes it.

export const SHELF_ASSETS = ["book", "record", "vhs"];
export const ASSET_LABELS = { book: "Bookshelf", record: "Record crate", vhs: "VHS shelf" };

const newId = (prefix) => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

export function emptyShelfFeed() {
  return { enabled: true, conditions: [], roles: ["instance", "artifact"], scope: null, sort: null, limit: 200 };
}

/** The office config on this grid, with both lists always present. */
export function readOffice(grid) {
  const v = grid?.meta?.vrOffice || {};
  return {
    shelves: Array.isArray(v.shelves) ? v.shelves : [],
    screens: Array.isArray(v.screens) ? v.screens : [],
  };
}

function withOffice(grid, office) {
  return { ...(grid?.meta || {}), vrOffice: office };
}

/** A new shelf of `asset`. Returns { meta, shelf }. */
export function addShelf(grid, asset) {
  const kind = SHELF_ASSETS.includes(asset) ? asset : "book";
  const office = readOffice(grid);
  const shelf = { id: newId("shelf"), title: ASSET_LABELS[kind], asset: kind, feed: emptyShelfFeed() };
  return { meta: withOffice(grid, { ...office, shelves: [...office.shelves, shelf] }), shelf };
}

/** Patch one shelf. A shelf's feed is always ON — a shelf with its query off would just be empty. */
export function updateShelf(grid, id, patch) {
  const office = readOffice(grid);
  const shelves = office.shelves.map((s) => {
    if (s.id !== id) return s;
    const next = { ...s, ...patch };
    if (patch.feed) next.feed = { ...patch.feed, enabled: true };
    return next;
  });
  return withOffice(grid, { ...office, shelves });
}

export function removeShelf(grid, id) {
  const office = readOffice(grid);
  return withOffice(grid, { ...office, shelves: office.shelves.filter((s) => s.id !== id) });
}

// A screen shows ONE PAGE (`source: "page"`, `pageOccId`) or THE WHOLE GRID as
// it looks in the app (`source: "grid"`, user 2026-10-21 12:08).
export const SCREEN_SOURCES = ["page", "grid"];

/** A new screen. Returns { meta, screen }. */
export function addScreen(grid, { source = "page", pageOccId = null } = {}) {
  const office = readOffice(grid);
  const screen = {
    id: newId("screen"), title: "Screen",
    source: SCREEN_SOURCES.includes(source) ? source : "page",
    pageOccId: pageOccId || null,
  };
  return { meta: withOffice(grid, { ...office, screens: [...office.screens, screen] }), screen };
}

export function updateScreen(grid, id, patch) {
  const office = readOffice(grid);
  return withOffice(grid, { ...office, screens: office.screens.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
}

export function removeScreen(grid, id) {
  const office = readOffice(grid);
  return withOffice(grid, { ...office, screens: office.screens.filter((s) => s.id !== id) });
}
