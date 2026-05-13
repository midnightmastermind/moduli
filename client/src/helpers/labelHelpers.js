// helpers/labelHelpers.js
// Shared ID → human-readable label resolver.
// Used by SelectDrilldown (path picker chips) and OperationLogPanel (run log rows)
// so both views agree on how to present IDs to the user.

/**
 * Resolve an ID to a human-readable label using the provided entity maps.
 *
 * @param {string} id
 * @param {{ fieldsById?: Object, modulesById?: Object, occurrencesById?: Object }} maps
 * @returns {{ label: string|null, shortId: string, kind: string }|null}
 *   label: the best human-readable label found, or null if unknown
 *   shortId: last 6 chars of the ID — rendered as a faint monospace suffix
 *   kind: "field" | "panel" | "container" | "instance" | "occurrence" | "module" | "unknown"
 */
export function labelForId(id, { fieldsById, modulesById, occurrencesById } = {}) {
  if (!id) return null;
  const shortId = String(id).slice(-6);

  const f = fieldsById?.[id];
  if (f) return { label: f.name, shortId, kind: "field" };

  const m = modulesById?.[id];
  if (m) return { label: m.label, shortId, kind: m.role ?? "module" };

  const occ = occurrencesById?.[id];
  if (occ) {
    const targetMod = modulesById?.[occ.moduleId];
    return { label: targetMod?.label ?? "occurrence", shortId, kind: "occurrence" };
  }

  return { label: null, shortId, kind: "unknown" };
}

/**
 * Format a labelForId result as "Water · …a8f3b2" (or just "…a8f3b2" when unknown).
 * Keeps the ID visible for disambiguation when multiple entities share a name.
 */
export function formatLabel(result) {
  if (!result) return "";
  if (!result.label) return `…${result.shortId}`;
  return `${result.label} · …${result.shortId}`;
}
