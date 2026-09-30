// client/src/helpers/sharePresets.js
//
// A saved SHAPE — "a Movie is an artifact/movie in Movies with these fields" —
// so adding your own stuff is quick. It is NOT a rule: nothing here carries a
// condition and nothing fires on its own (user, 2026-09-28: "there is no rule
// from IMDB").
//
// Per GRID, because a preset names that grid's fields and containers. Stored as
// `grid.meta.sharePresets` through `PUT /api/v1/share/presets`, which writes
// that key alone.
import { uid } from "../uid";

export function readPresets(grid) {
  const list = grid?.meta?.sharePresets;
  return Array.isArray(list) ? list : [];
}

const key = (name) => String(name || "").trim().toLowerCase();

/** Append, or replace one of the same name — saving twice is an edit. */
export function withPreset(presets, preset) {
  const rest = (presets || []).filter((p) => key(p.name) !== key(preset.name));
  return [...rest, preset];
}

// OVERWRITE THE ONE YOU ARE LOOKING AT. `withPreset` matches on the NAME, which
// means the only way to change a preset was to retype its name exactly — and the
// control for it sat below the fold in a window that could not scroll (user,
// 2026-09-29: "allow you to overwrite presets"). These two keep the preset's own
// id, so a rename is an edit rather than a second copy, and IN PLACE, so the
// dropdown does not reorder under the cursor.
export function replacePreset(presets, id, preset) {
  let found = false;
  const out = (presets || []).map((p) => {
    if (p.id !== id) return p;
    found = true;
    return { ...preset, id };
  });
  // A preset that is no longer there (another tab deleted it) is ADDED rather
  // than silently dropped — the user pressed save.
  return found ? out : [...out, preset];
}

export function deletePreset(presets, id) {
  return (presets || []).filter((p) => p.id !== id);
}

// AN OVERRIDE IS NOT SAVED. Typing a value in the window fixes THIS clip; if a
// preset kept it, saving one movie would write "2006" into every movie after
// it. A literal survives, because choosing "a literal" is a deliberate constant.
const withoutOverride = (m) => {
  const { override, ...rest } = m || {};
  return rest;
};

export function presetFromForm({ name, destination, shape, mappings, labelMapping }) {
  const cleaned = {};
  for (const [fieldId, m] of Object.entries(mappings || {})) cleaned[fieldId] = withoutOverride(m);
  return {
    id: uid(), name: String(name || "").trim(),
    role: shape?.role || "instance",
    kind: shape?.kind || null,
    bindingsLike: shape?.bindingsLike || null,
    bindFields: shape?.bindFields || [],
    fileFrom: shape?.fileFrom || null,
    destinationId: destination?.id || null,
    destinationLabel: destination?.label || null,
    mappings: cleaned,
    labelMapping: labelMapping ? withoutOverride(labelMapping) : null,
  };
}

export function formFromPreset(preset) {
  const mappings = {};
  for (const [fieldId, m] of Object.entries(preset?.mappings || {})) mappings[fieldId] = withoutOverride(m);
  return {
    destination: preset?.destinationId
      ? { id: preset.destinationId, label: preset.destinationLabel || preset.name, childCount: null }
      : null,
    shape: {
      role: preset?.role || "instance", kind: preset?.kind || null,
      bindingsLike: preset?.bindingsLike || null, bindFields: preset?.bindFields || [],
      autoFields: {}, fileFrom: preset?.fileFrom || null,
    },
    mappings,
    labelMapping: preset?.labelMapping ? withoutOverride(preset.labelMapping) : null,
  };
}
