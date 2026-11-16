// services/buildEdit.js — Jonah's change / remove, the pure half (2026-11-15, Phase 2 of "Jonah builds anything").
// Spec: docs/superpowers/specs/2026-11-15-jonah-build-anything-design.md. Routes POST /change and POST /remove
// (routes/apiV1.js) load the records, call these, write, and record ONE undo step each.
import { coerceValue, findFieldByName } from "./assistantBuildTools.js";

const lc = (s) => String(s ?? "").trim().toLowerCase();

/**
 * A name as the model writes it in prose → the path form. "Social section from Eval Notebook page" →
 * "Eval Notebook › Social" (Jonah, 2026-11-15: every remove sent the phrase and found nothing). Leading "the/my" and
 * a trailing kind word (section, page, container, board, folder, row, item) are dropped on each side. A name already
 * a path, or with no linking word, comes back trimmed and otherwise unchanged. Pure.
 */
export function normalizeTargetName(name) {
  const raw = String(name || "").trim();
  if (/[›»>/]/.test(raw)) return raw;
  const clean = (t) => t.trim().replace(/^(the|my)\s+/i, "").replace(/\s+(section|page|container|board|folder|row|item|instance)$/i, "").trim();
  const m = raw.match(/^(.+?)\s+(?:from|on|in|of|under)\s+(.+)$/i);
  if (!m) return clean(raw);
  return `${clean(m[2])} › ${clean(m[1])}`;
}

/**
 * Which occurrence a name means. `candidates` = [{ occ, module, parentLabel }]. A path "A › B" picks the one whose
 * parent is A. Pages and sections win over rows when a bare name matches both; still several → ambiguous (listed),
 * never a guess. Pure. @returns {{ hit } | { error } | { ambiguous: string[] }}
 */
export function pickByName(name, candidates) {
  const parts = normalizeTargetName(name).split(/\s*(?:›|»|>|\/)\s*/).filter(Boolean);
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

/**
 * What a named thing holds, for a question (Jonah's look_up, 2026-11-16: the 3B claimed to look things up and
 * answered "0 links" / "4 books" for a page with 2 links and a board with 3 books). Walks the listed children
 * (depth ≤ 4) and sorts what it meets: sections, items (instances, files, bookmarks), links (link chips + bookmarks).
 * `count` is the items. Pure: rows and modules are handed in. Lists are capped; `count` is not.
 */
export function summarizeSubtree(rootId, occurrencesById, modulesById, { cap = 40 } = {}) {
  const root = occurrencesById[rootId];
  if (!root) return null;
  const label = (o) => o.label || modulesById[o.moduleId]?.label || "";
  const sections = []; const items = []; const links = [];
  const seen = new Set([rootId]);
  const walk = (o, depth) => {
    for (const id of o.occurrences || []) {
      const c = occurrencesById[id]; if (!c || seen.has(id) || depth > 4) continue;
      seen.add(id);
      const m = modulesById[c.moduleId] || {};
      const link = c.meta?.link || m.meta?.link;
      if (link?.kind === "url" || link?.url) links.push({ label: label(c), url: link.url });
      else if (link?.kind === "occurrence") links.push({ label: label(c), to: label(occurrencesById[link.occId] || {}) || link.occId });
      else if (m.kind === "bookmark") { links.push({ label: label(c), url: m.fileRef || c.meta?.url }); items.push(label(c)); }
      else if (m.role === "container" || m.role === "page") sections.push({ name: label(c), holds: (c.occurrences || []).length });
      else if (m.role === "instance" || m.role === "artifact") items.push(label(c));
      walk(c, depth + 1);
    }
  };
  walk(root, 0);
  const m = modulesById[root.moduleId] || {};
  return { name: label(root), kind: [m.role, m.kind].filter(Boolean).join(" "), count: items.length,
    items: items.slice(0, cap), sections: sections.slice(0, cap), links: links.slice(0, cap) };
}
