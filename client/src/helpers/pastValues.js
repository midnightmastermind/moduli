// helpers/pastValues.js
//
// "WHAT DID THIS BLOCK SAY ON OTHER DAYS?" — the radial menu's History.
//
// User, 2026-09-25: the radial History showed every TRANSACTION that touched a
// block, and what they wanted from it (the Daily Question on the day page) is
// the block's past VALUES: each other copy, what it said, and what sat under it
// (the question and that day's answer). *"but i dont want it hard coded to
// Date."* So nothing here names a field:
//
//   WHICH COPIES   the same module, or any module in its clone lineage
//                  (`meta.clonedFromModuleId`). A template-applied day page
//                  clones the block's occurrence onto one module — until the
//                  template itself is rebuilt, when the new module records the
//                  one it was cloned from. Lineage is how history survives that.
//   WHICH PERIOD   the block's own join field if it declares one (the bound
//                  header/body `link` — what already ties Question ↔ Answer
//                  across days), else the fields the grid FILTERS on at that
//                  placement (the effective filter's keys). The VALUE is read
//                  off the copy itself or its nearest ancestor that carries it,
//                  never off the filter — the filter holds TODAY's value, which
//                  would stamp every past copy with today's date.
//                  No such field anywhere -> the copy's creation time.
//   WHAT IT SAID   its own text, its field values, and its descendants' — via
//                  both `occurrences[]` and textmap embeds (the answer is
//                  embedded in a doc, not listed).
//
// Reads the store only: no transaction query, works after a reload, and goes
// back as far as the copies do.

import { plainText } from "./textmapText";
import { collectEmbeddedIds } from "./textmapEmbeds";
import { cachedParentMap } from "./dragHitTesting";
import { getEffectiveFilterForOccurrence } from "../state/selectors";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const MAX_DEPTH = 4;

/** Every module id in `moduleId`'s clone lineage (both directions). */
export function blockLineage(moduleId, modulesById = {}) {
  const out = new Set();
  if (!moduleId) return out;
  const parentOf = (id) => modulesById[id]?.meta?.clonedFromModuleId || null;
  // Up to the root…
  let root = moduleId;
  const seen = new Set([root]);
  while (parentOf(root) && !seen.has(parentOf(root))) { root = parentOf(root); seen.add(root); }
  // …then every module descended from it.
  const children = new Map();
  for (const m of Object.values(modulesById)) {
    const p = m?.meta?.clonedFromModuleId;
    if (!p) continue;
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(m.id);
  }
  const stack = [root];
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    for (const c of children.get(id) || []) stack.push(c);
  }
  return out;
}

/** The field ids that say which period a copy belongs to. */
export function periodFieldIds(occ, { module, grid, occurrencesById } = {}) {
  const ids = [];
  for (const slot of ["headerLink", "bodyLink"]) {
    const l = occ?.meta?.[slot]?.link || module?.meta?.[slot]?.link;
    if (typeof l === "string" && l && !ids.includes(l)) ids.push(l);
  }
  if (ids.length) return ids;
  const eff = getEffectiveFilterForOccurrence(occ, { grid, occurrencesById }) || {};
  return Object.keys(eff);
}

function cellValue(cell) {
  if (cell == null) return null;
  return typeof cell === "object" && "value" in cell ? cell.value : cell;
}

/** The copy's own value for `fieldId`, else its nearest ancestor's. */
export function ownOrAncestorValue(occ, fieldId, { occurrencesById = {}, parentByChildId } = {}) {
  const pbc = parentByChildId || cachedParentMap(occurrencesById);
  let cur = occ;
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    const v = cellValue(cur.fields?.[fieldId]);
    if (v != null && v !== "") return v;
    const next = pbc[cur.id] ?? cur.parentId;
    cur = next ? occurrencesById[next] : null;
  }
  return null;
}

function displayValue(v, field) {
  if (v == null || v === "") return "";
  if (typeof v === "object") {
    if (v.type === "doc") return plainText(v);
    if (Array.isArray(v)) return v.map(x => displayValue(x, field)).filter(Boolean).join(", ");
    return v.label || v.name || "";
  }
  if (typeof v === "string" && ISO_DATE_RE.test(v) && (!field || field.type === "date")) {
    const d = new Date(v.slice(0, 10) + "T00:00:00");
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    }
  }
  return String(v);
}

/** Text + non-empty field values of one occurrence and its descendants. */
export function summarizeCopy(occ, { occurrencesById = {}, modulesById = {}, fieldsById = {}, skipFieldIds = [] } = {}) {
  const lines = [];
  const skip = new Set(skipFieldIds);
  const seen = new Set();
  const walk = (o, depth) => {
    if (!o || seen.has(o.id) || depth > MAX_DEPTH) return;
    seen.add(o.id);
    const mod = modulesById[o.moduleId];
    const text = o.textmap && typeof o.textmap === "object" ? plainText(o.textmap) : "";
    const values = [];
    for (const [fid, cell] of Object.entries(o.fields || {})) {
      if (skip.has(fid)) continue;
      const shown = displayValue(cellValue(cell), fieldsById[fid]);
      if (shown) values.push({ fieldId: fid, name: fieldsById[fid]?.name || "", text: shown });
    }
    if (text || values.length) {
      lines.push({ occurrenceId: o.id, depth, label: o.label || mod?.label || "", text, values });
    }
    const kids = new Set([...(o.occurrences || []), ...collectEmbeddedIds(o.textmap)]);
    for (const id of kids) walk(occurrencesById[id], depth + 1);
  };
  walk(occ, 0);
  return lines;
}

/**
 * The other copies of `occ`'s block, newest period first.
 * @returns {{ periodFields: string[], entries: Array<{ occurrence, period, sortKey, lines }> }}
 */
export function buildPastValues(occ, { occurrencesById = {}, modulesById = {}, fieldsById = {}, grid } = {}) {
  if (!occ?.moduleId) return { periodFields: [], entries: [] };
  const module = modulesById[occ.moduleId];
  const lineage = blockLineage(occ.moduleId, modulesById);
  const periodFields = periodFieldIds(occ, { module, grid, occurrencesById });
  const parentByChildId = cachedParentMap(occurrencesById);

  const entries = [];
  for (const o of Object.values(occurrencesById)) {
    if (!o || o.id === occ.id || !lineage.has(o.moduleId)) continue;
    const raw = periodFields.map(fid => ownOrAncestorValue(o, fid, { occurrencesById, parentByChildId }));
    const has = raw.some(v => v != null);
    const period = has
      ? raw.map((v, i) => displayValue(v, fieldsById[periodFields[i]])).filter(Boolean).join(" · ")
      : "";
    const sortKey = has ? raw.map(v => (v == null ? "" : String(v))).join("|") : String(o.createdAt || "");
    entries.push({
      occurrence: o,
      period,
      sortKey,
      lines: summarizeCopy(o, { occurrencesById, modulesById, fieldsById, skipFieldIds: periodFields }),
    });
  }
  entries.sort((a, b) => (a.sortKey < b.sortKey ? 1 : a.sortKey > b.sortKey ? -1 : 0));
  return { periodFields, entries };
}
