// helpers/fieldPresets.js
// Field presets for a new item (user, 2026-10-23: "can we add field presets when adding new items" — fields +
// default values, saved from the add-item picker, offered on the whole grid).
//
// Stored on the grid: `grid.meta.fieldPresets = [{ id, name, fieldIds: [...], values: { fieldId: raw } }]`.
// `values` holds what was typed in the picker for ticked fields, in the picker's own raw form, so applying a
// preset puts the picker back exactly as it was saved. A field deleted since is dropped when applied.
import * as CommitHelpers from "./CommitHelpers";

const uid = () => (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `fp-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const isBlank = (v) => v == null || v === "" || (Array.isArray(v) && v.length === 0);
const sameName = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

export function presetsOf(grid) {
  const list = grid?.meta?.fieldPresets;
  return Array.isArray(list) ? list.filter((p) => p && p.id && Array.isArray(p.fieldIds)) : [];
}

/** A preset from the picker's state. Values are kept only for ticked fields and only when filled in. */
export function presetFromPick({ name, fieldIds = [], values = {} }) {
  const ids = [...new Set(fieldIds)];
  const kept = {};
  for (const fid of ids) if (!isBlank(values?.[fid])) kept[fid] = values[fid];
  return { id: uid(), name: String(name || "").trim(), fieldIds: ids, values: kept };
}

/** Save into the list: a preset with the same name is REPLACED in place (keeps its id); otherwise appended. */
export function withPreset(list, preset) {
  const i = list.findIndex((p) => sameName(p.name, preset.name));
  if (i === -1) return [...list, preset];
  const next = [...list];
  next[i] = { ...preset, id: list[i].id };
  return next;
}

export function withoutPreset(list, id) {
  return list.filter((p) => p.id !== id);
}

/** The picker state a preset puts back. Fields that no longer exist are dropped. */
export function applyPreset(preset, fieldsById = {}) {
  const live = (fid) => fieldsById[fid] && !fieldsById[fid].trashed;
  const fieldIds = (preset?.fieldIds || []).filter(live);
  const values = {};
  for (const fid of fieldIds) if (preset.values && fid in preset.values) values[fid] = preset.values[fid];
  return { fieldIds, values };
}

/**
 * Order for the menu: presets whose fields the rows already in this container wear come first (so the one you
 * use here is at the top), then the rest by name.
 */
export function orderPresets(list, siblingFieldIds = []) {
  const have = new Set(siblingFieldIds);
  const fits = (p) => p.fieldIds.length > 0 && p.fieldIds.every((f) => have.has(f));
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  return [...list.filter(fits).sort(byName), ...list.filter((p) => !fits(p)).sort(byName)];
}

/** Write the list onto the grid, keeping every other meta key. `getGrid` is read at write time. */
export function writePresets({ dispatch, socket, getGrid, list }) {
  const grid = getGrid?.();
  const gridId = grid?._id || grid?.id;
  if (!gridId) return false;
  CommitHelpers.updateGrid({ dispatch, socket, gridId: String(gridId), grid: { meta: { ...(grid.meta || {}), fieldPresets: list } }, emit: true });
  return true;
}
