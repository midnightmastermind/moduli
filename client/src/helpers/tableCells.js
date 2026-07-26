// helpers/tableCells.js
// Pure helpers for the table container's layout-only cell model.
// A cell's content is a TipTap doc fragment stored in
// occurrence.meta.table.cells["r:c"]. Cells are not entities.
//
// plainText lives in helpers/textmapText.js (the occurrence search index needs
// it too, and a search helper shouldn't depend on table code); re-exported here
// so existing `import { plainText } from "./tableCells"` call sites keep working.
import { plainText } from "./textmapText";

export { plainText };

export function cellKey(r, c) {
  return `${r}:${c}`;
}

export function emptyCellDoc() {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

export function makeEmbedCellDoc(occurrenceId) {
  return {
    type: "doc",
    content: [{ type: "moduleEmbed", attrs: { occurrenceId } }],
  };
}

export function firstEmbedOccId(doc) {
  let found = null;
  const walk = (n) => {
    if (found || !n) return;
    if (n.type === "moduleEmbed" || n.type === "instancePill") {
      found = n.attrs?.occurrenceId || n.attrs?.id || null;
      if (found) return;
    }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return found;
}

/**
 * Derive one comparable scalar for a cell, for TanStack sort/filter.
 * ctx: { occurrencesById, modulesById }
 */
export function getCellSortValue(doc, column, ctx) {
  if (!doc) return "";
  const occId = firstEmbedOccId(doc);
  if (occId) {
    const occ = ctx?.occurrencesById?.[occId];
    if (column?.displayFieldId && occ) {
      const fv = occ.fields?.[column.displayFieldId];
      const v = fv && typeof fv === "object" ? fv.value : fv;
      return v == null ? "" : v;
    }
    const mod = occ && ctx?.modulesById?.[occ.targetId];
    return mod?.label || occ?.label || "";
  }
  const txt = plainText(doc);
  if (txt === "") return "";
  const asNum = Number(txt);
  return Number.isFinite(asNum) && /^[+-]?\d*\.?\d+$/.test(txt) ? asNum : txt;
}

function reindex(cells, fromCol, delta) {
  const next = {};
  for (const k of Object.keys(cells)) {
    const [r, c] = k.split(":").map(Number);
    if (c < fromCol) next[k] = cells[k];
    else if (delta < 0 && c === fromCol) continue; // dropped
    else next[cellKey(r, c + delta)] = cells[k];
  }
  return next;
}
export function deleteColumn(table, colIndex) {
  return {
    ...table,
    columns: table.columns.filter((_, i) => i !== colIndex),
    cells: reindex(table.cells, colIndex, -1),
  };
}
export function insertColumn(table, colIndex, colDef) {
  const columns = table.columns.slice();
  columns.splice(colIndex, 0, colDef);
  return { ...table, columns, cells: reindex(table.cells, colIndex, +1) };
}

/**
 * Cells the fill gesture should write, given the source cell and the cell
 * under the pointer. Constrained to a single axis (Excel-style): the axis
 * with the larger delta wins; the other axis is pinned to the source.
 * Source cell itself is excluded. Targets clamped to >= 0.
 */
export function fillRange(src, target) {
  const dr = target.r - src.r;
  const dc = target.c - src.c;
  if (dr === 0 && dc === 0) return [];
  const horizontal = Math.abs(dc) >= Math.abs(dr);
  const out = [];
  if (horizontal) {
    const step = dc > 0 ? 1 : -1;
    for (let c = src.c + step; c !== src.c + dc + step; c += step) {
      if (c >= 0) out.push({ r: src.r, c });
    }
  } else {
    const step = dr > 0 ? 1 : -1;
    for (let r = src.r + step; r !== src.r + dr + step; r += step) {
      if (r >= 0) out.push({ r, c: src.c });
    }
  }
  return out;
}
