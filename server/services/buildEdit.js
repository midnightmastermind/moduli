// services/buildEdit.js — Jonah's change / remove, the pure half (2026-11-15, Phase 2 of "Jonah builds anything").
// Spec: docs/superpowers/specs/2026-11-15-jonah-build-anything-design.md. Routes POST /change and POST /remove
// (routes/apiV1.js) load the records, call these, write, and record ONE undo step each.
import { coerceValue, findFieldByName } from "./assistantBuildTools.js";

const lc = (s) => String(s ?? "").trim().toLowerCase();

/**
 * Which occurrence a name means. `candidates` = [{ occ, module, parentLabel }]. A path "A › B" picks the one whose
 * parent is A. Pages and sections win over rows when a bare name matches both; still several → ambiguous (listed),
 * never a guess. Pure. @returns {{ hit } | { error } | { ambiguous: string[] }}
 */
export function pickByName(name, candidates) {
  const parts = String(name || "").split(/\s*(?:›|»|>|\/)\s*/).filter(Boolean);
  const leaf = lc(parts.pop());
  const parent = parts.length ? lc(parts.pop()) : null;
  let hits = candidates.filter((c) => lc(c.occ.label || c.module?.label) === leaf);
  if (parent) hits = hits.filter((c) => lc(c.parentLabel) === parent);
  if (hits.length > 1) {
    const places = hits.filter((c) => ["page", "container"].includes(c.module?.role));
    if (places.length === 1) hits = places;
  }
  if (!hits.length) return { error: `nothing named "${name}"` };
  if (hits.length > 1) return { ambiguous: hits.slice(0, 6).map((c) => `${c.parentLabel ? `${c.parentLabel} › ` : ""}${c.occ.label || c.module?.label}`) };
  return { hit: hits[0] };
}

/**
 * A rename and field values for one occurrence. A module placed only here is renamed itself; one shared with other
 * placements gets the new name on THIS placement (occurrence.label), so the others keep theirs. Field values are
 * coerced by type; a field the row does not show yet is bound. Pure.
 * @returns {{ occPatch, modPatch, problems }}
 */
export function planChange({ occ, module, placements = 1, rename = null, fields = null, fieldsAll = [] }) {
  const occPatch = {}; const modPatch = {}; const problems = [];
  if (rename != null && String(rename).trim()) {
    if (placements <= 1 && !occ.label) modPatch.label = String(rename).trim();
    else occPatch.label = String(rename).trim();
  }
  if (fields && typeof fields === "object") {
    const next = { ...(occ.fields || {}) };
    const bindings = [...(module?.fieldBindings || [])];
    for (const [name, raw] of Object.entries(fields)) {
      const f = findFieldByName(fieldsAll, name);
      if (f.error) { problems.push(f.error); continue; }
      if (f.field.type === "occurrence") { problems.push(`${name}: a value pointing at another row is not set here yet`); continue; }
      if (raw === null || raw === "") { delete next[f.field.id]; continue; }
      const v = coerceValue(f.field, raw);
      if (v.error) { problems.push(v.error); continue; }
      next[f.field.id] = { value: v.value, flow: "in" };
      if (!bindings.some((b) => b.fieldId === f.field.id)) bindings.push({ fieldId: f.field.id, role: "input", order: bindings.length });
    }
    occPatch.fields = next;
    if (bindings.length !== (module?.fieldBindings || []).length) modPatch.fieldBindings = bindings;
  }
  return { occPatch, modPatch, problems };
}

/** Every occurrence id under `rootId` through the listed children (root included), cycle-safe. Pure. */
export function subtreeIds(rootId, occurrencesById) {
  const out = []; const seen = new Set(); const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    if (!id || seen.has(id) || !occurrencesById[id]) continue;
    seen.add(id); out.push(id);
    for (const c of occurrencesById[id].occurrences || []) stack.push(c);
  }
  return out;
}

/** The doc textmap without any node embedding one of `ids` (top level and nested). Pure; null when unchanged. */
export function stripEmbeds(textmap, ids) {
  if (!textmap || typeof textmap !== "object") return null;
  const drop = new Set(ids);
  let changed = false;
  const walk = (n) => {
    if (!n || !Array.isArray(n.content)) return n;
    const content = [];
    for (const c of n.content) {
      if (c?.attrs?.occurrenceId && drop.has(c.attrs.occurrenceId)) { changed = true; continue; }
      content.push(walk(c));
    }
    return { ...n, content };
  };
  const next = walk(textmap);
  return changed ? next : null;
}
