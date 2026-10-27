// utils/gridLayoutKeys.js — the parts of a grid that are a DEVICE's layout, not the grid's data.
//
// The client keeps the same list (client/src/helpers/localLayout.js LAYOUT_GRID_KEYS / LAYOUT_META_KEYS). Windows
// inside the headset (the grid screen, readers, the control panel) lay the grid out for their own small screens; their
// grid writes carry `keepLayout`, and the server keeps its stored layout instead of theirs (user, 2026-10-27: the
// desktop's 2-column layout kept turning into a 2x2 grid — the headset's grid screen had written its own).
export const LAYOUT_GRID_KEYS = ["rows", "cols", "colSizes", "rowSizes", "occurrences", "activeFilterValues", "activeFilterId"];
export const LAYOUT_META_KEYS = ["layoutTree", "layoutRules"];

/**
 * `patch` with the stored layout kept: top-level layout keys dropped; a `meta` patch (which replaces meta whole) gets
 * the stored layout entries put back, so it can neither change nor delete them. Pure.
 */
export function withStoredLayout(patch, stored) {
  if (!patch || typeof patch !== "object") return patch;
  const out = { ...patch };
  for (const k of LAYOUT_GRID_KEYS) delete out[k];
  if (out.meta && typeof out.meta === "object") {
    const meta = { ...out.meta };
    for (const k of LAYOUT_META_KEYS) {
      if (stored?.meta && k in stored.meta) meta[k] = stored.meta[k];
      else delete meta[k];
    }
    out.meta = meta;
  }
  // Dotted meta paths (`meta.layoutTree`) are layout too.
  for (const k of Object.keys(out)) if (LAYOUT_META_KEYS.some((m) => k === `meta.${m}` || k.startsWith(`meta.${m}.`))) delete out[k];
  return out;
}
