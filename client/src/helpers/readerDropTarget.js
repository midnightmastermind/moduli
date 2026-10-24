// helpers/readerDropTarget.js — where a drag carried in from ANOTHER headset window lands in this one.
//
// The headset knows where the controller let go only as (u, v) on the panel it hit — 0..1 across, 0..1 down the
// whole panel, which includes the reader's toolbar above the page. `wM` x `hM` is the panel's size in metres; the page
// fills the panel's width, so px-per-metre is innerWidth / wM and the toolbar is whatever height is not the page.
//
// The answer is a list and a slot in it: the board/list container under that point (its rows split by their
// middles), else the window's own root when that is a container. Null when it is neither — a doc's text or a page's
// margin is not somewhere a row can go.

/** Panel (u, v) to a point in this page's CSS pixels. Pure. */
export function panelPointToPage({ u, v, wM, hM, innerWidth, innerHeight }) {
  const pxPerM = innerWidth / wM;
  const toolbarPx = Math.max(0, hM * pxPerM - innerHeight);
  return { x: u * innerWidth, y: v * hM * pxPerM - toolbarPx };
}

/** The slot among `rowRects` (top-to-bottom) a point at `y` falls before. Pure. */
export function slotAt(rowRects, y) {
  let i = 0;
  for (const r of rowRects) { if (y > r.top + r.height / 2) i += 1; else break; }
  return i;
}

export function readerDropTarget({ u, v, wM, hM, rootId, occurrences = [], modules = [], doc = document, win = window }) {
  const { x, y } = panelPointToPage({ u, v, wM, hM, innerWidth: win.innerWidth, innerHeight: win.innerHeight });
  const byId = new Map(occurrences.map((o) => [o.id, o]));
  const modOf = (o) => modules.find((m) => m.id === o?.moduleId);
  const el = doc.elementFromPoint(x, y);
  const shell = el?.closest?.(".container-shell[data-occ-id]");
  let parentId = shell?.getAttribute("data-occ-id") || null;
  if (!parentId || modOf(byId.get(parentId))?.kind === "doc") {
    const root = byId.get(rootId);
    const rm = modOf(root);
    parentId = rm?.role === "container" && rm.kind !== "doc" ? rootId : null;
  }
  if (!parentId) return null;
  const parent = byId.get(parentId);
  const ids = parent?.occurrences || [];
  const scope = shell && shell.getAttribute("data-occ-id") === parentId ? shell : doc;
  const rects = ids.map((id) => scope.querySelector(`[data-occurrence-id="${CSS.escape(id)}"]`)?.getBoundingClientRect()).filter(Boolean);
  return { parentId, index: rects.length ? slotAt(rects, y) : ids.length, x, y };
}
