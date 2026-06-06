// services/importRelink.js
// ============================================================
// Internal-link rewrite for batch Wikipedia imports.
//
// When several linked articles are imported together, links between them
// should navigate WITHIN Moduli instead of out to wikipedia.org. This module
// rewrites a textmap's inline Wikipedia link marks into the editor's native
// internal-link primitive — a `docLink` inline node (see
// client/src/docs/DocLinkExtension.js) carrying the target occurrence id — when
// the linked article's title was one of the imported pages. Links to articles
// that were NOT imported stay as ordinary external link marks.
// ============================================================

const WIKI_HREF_RX = /^https?:\/\/en\.wikipedia\.org\/wiki\/([^#?]+)/i;

// "https://en.wikipedia.org/wiki/Dr._Dre#Career" → "Dr. Dre" (null if not a wiki href).
export function wikiTitleFromHref(href) {
  const m = WIKI_HREF_RX.exec(String(href || ""));
  if (!m) return null;
  let t = m[1];
  try { t = decodeURIComponent(t); } catch { /* keep raw */ }
  return t.replace(/_/g, " ").trim() || null;
}

const norm = (t) => String(t || "").toLowerCase();

// Rewrite a single textmap. `titleToOccId` maps article title → occurrence id
// (a Map, or a plain object). Returns { textmap, changed }.
export function relinkTextmap(textmap, titleToOccId) {
  if (!textmap || typeof textmap !== "object") return { textmap, changed: false };
  const map = titleToOccId instanceof Map
    ? new Map([...titleToOccId].map(([k, v]) => [norm(k), v]))
    : new Map(Object.entries(titleToOccId || {}).map(([k, v]) => [norm(k), v]));
  if (!map.size) return { textmap, changed: false };

  let changed = false;
  function walk(content) {
    if (!Array.isArray(content)) return content;
    const out = [];
    for (const node of content) {
      if (node?.type === "text" && Array.isArray(node.marks)) {
        const link = node.marks.find((mk) => mk?.type === "link");
        const title = link && wikiTitleFromHref(link.attrs?.href);
        const occId = title && map.get(norm(title));
        if (occId) {
          out.push({ type: "docLink", attrs: { targetId: occId, label: node.text || title, linkType: "doc" } });
          changed = true;
          continue;
        }
      }
      const copy = { ...node };
      if (Array.isArray(node.content)) copy.content = walk(node.content);
      out.push(copy);
    }
    return out;
  }

  const nextContent = walk(textmap.content);
  return changed ? { textmap: { ...textmap, content: nextContent }, changed: true } : { textmap, changed: false };
}

// Convenience: rewrite a batch of { id, textmap } occurrences against a title map.
// Returns the subset that changed, as { id, textmap }.
export function relinkOccurrences(occurrences, titleToOccId) {
  const out = [];
  for (const occ of occurrences || []) {
    if (!occ?.textmap) continue;
    const { textmap, changed } = relinkTextmap(occ.textmap, titleToOccId);
    if (changed) out.push({ id: occ.id, textmap });
  }
  return out;
}
