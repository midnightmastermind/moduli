// helpers/phoneCells.js — where each panel sits on a PHONE when the grid is a mosaic on desktop.
//
// User, 2026-11-02: "the mosaic isnt working on mobile with the track and the new layouts. we should only keep
// the non mosaic mode for mobile, so it shouldnt share the same layout as desktop." A phone pages one cell at a
// time with the rails (rows × cols), so it uses the grid's rows × cols and each panel's own `placement`, never
// the desktop's split tree.
//
// A mosaic grid's placements are not kept up by the mosaic, though: panels added there (Add panel, a snap layout)
// land on cells another panel already holds (poms grid, measured: two "Board 5" panels on Panel A's and Panel C's
// cells). In rows × cols mode a shared cell is a STACK — one panel hidden behind the other — which none of these
// are. So, on a phone, every panel gets a cell of its own: its placement when that is in bounds and free (panels
// taken in grid order), otherwise the first free cell row by row, adding rows when the grid is full.
//
// PURE and display-only: nothing is written, so the desktop layout is never touched.

/** @returns {{ rows: number, cols: number, panels: object[] }} panels carry row/col/width/height + shown. */
export function phoneCells(panels, gridRows, gridCols) {
  const cols = Math.max(1, gridCols || 1);
  let rows = Math.max(1, gridRows || 1);
  const taken = new Set();
  const key = (r, c) => `${r}:${c}`;
  const fits = (r, c, w, h) => {
    if (r < 0 || c < 0 || c + w > cols) return false;
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (taken.has(key(y, x))) return false;
    return true;
  };
  const take = (r, c, w, h) => { for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) taken.add(key(y, x)); };
  const out = [];
  const later = [];
  for (const p of panels || []) {
    const r = p.row ?? 0, c = p.col ?? 0, w = Math.max(1, p.width || 1), h = Math.max(1, p.height || 1);
    if (r + h <= rows && fits(r, c, w, h)) { take(r, c, w, h); out.push(shown({ ...p, row: r, col: c, width: w, height: h })); }
    else later.push(p);
  }
  for (const p of later) {
    let placed = false;
    for (let r = 0; !placed; r++) {
      if (r >= rows) rows = r + 1;
      for (let c = 0; c < cols && !placed; c++) {
        if (fits(r, c, 1, 1)) { take(r, c, 1, 1); out.push(shown({ ...p, row: r, col: c, width: 1, height: 1 })); placed = true; }
      }
    }
  }
  return { rows, cols, panels: out };
}

// A panel with a cell of its own is not hidden behind another one.
function shown(p) {
  const display = p?.layout?.style?.display;
  if (!display || display !== "none") return p;
  return { ...p, layout: { ...p.layout, style: { ...p.layout.style, display: "block" } } };
}
