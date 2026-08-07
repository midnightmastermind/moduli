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

// Absolute (any language subdomain) OR the site-relative form older imports carry.
// The `[^#?]+` stops at an anchor or query, so `/wiki/Dr._Dre#Career` and
// `/wiki/Dr._Dre?action=raw` both resolve to the same title — one page, one link.
const WIKI_HREF_RX = /^(?:https?:\/\/[a-z0-9-]+\.wikipedia\.org)?\/wiki\/([^#?]+)/i;

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

// ════════════════════════════════════════════════════════════════════════════
// LINK CHIPS — the half that reaches TODAY'S imports (Task 6)
// ════════════════════════════════════════════════════════════════════════════
//
// `relinkTextmap` above rewrites inline link MARKS. Since 2026-06-06 the
// importer no longer emits those for prose: each link is its own
// `role:"textblock" kind:"inline"` OCCURRENCE carrying `meta.link`, embedded via
// an `instanceTextblockInline` node (see markdownImporter.buildInlineLink). So
// **the mark-based relink never touches anything imported today** — which is why
// every chip on the existing Eminem page still opens wikipedia.org.
//
// The target shape already exists: `TextblockCard` renders
// `meta.link.kind === "occurrence"` as an in-app jump. Only the conversion was
// missing, and it is a change to the OCCURRENCE, not to any textmap.
//
// ── THE RULE THAT MATTERS: EXACT MATCHES ONLY ───────────────────────────────
//
// A chip is rewritten only when its URL resolves to a title that is a KEY in the
// map. No fuzzy matching, no prefix matching, no "closest article". **A wrong
// resolution sends the reader to the wrong page, which is worse than leaving the
// link on the web** — the failure is silent and looks like the app lying.

const isUrlChipLink = (link) => !!link && link.kind === "url" && typeof link.url === "string";

/**
 * The link chips among a set of occurrences — those carrying a `meta.link`
 * that still points OUT at a URL.
 *
 * An already-converted chip (`kind: "occurrence"`) is deliberately excluded, so
 * running this twice is a no-op and a hand-repointed link is never clobbered.
 */
export function collectLinkChips(occurrences) {
  const out = [];
  for (const occ of occurrences || []) {
    const link = occ?.meta?.link;
    if (!isUrlChipLink(link)) continue;
    out.push({ id: occ.id, url: link.url, title: wikiTitleFromHref(link.url) });
  }
  return out;
}

/**
 * Which chips should become in-app jumps, and what their new `meta.link` is.
 *
 * Returns only the occurrences that CHANGE — an unimported chip is absent from
 * the result entirely, so a caller that persists this list cannot accidentally
 * rewrite one to a byte-identical value and bump its `updatedAt`.
 *
 * @param {Array} occurrences  raw occurrences (the chips are found among them)
 * @param {Map|Object} titleToOccId  article title → the occurrence to jump to
 * @returns {{ changes: Array<{id, meta}>, matched: number, unmatched: number,
 *             skippedNonWiki: number }}
 */
export function relinkLinkChips(occurrences, titleToOccId) {
  const map = titleToOccId instanceof Map
    ? new Map([...titleToOccId].map(([k, v]) => [norm(k), v]))
    : new Map(Object.entries(titleToOccId || {}).map(([k, v]) => [norm(k), v]));

  const byId = new Map((occurrences || []).filter(o => o?.id).map(o => [o.id, o]));
  const changes = [];
  let matched = 0, unmatched = 0, skippedNonWiki = 0;

  for (const chip of collectLinkChips(occurrences)) {
    if (!chip.title) { skippedNonWiki += 1; continue; }
    const occId = map.get(norm(chip.title));
    // A chip that resolves to ITSELF is not a link, it is a loop.
    if (!occId || occId === chip.id) { unmatched += 1; continue; }

    matched += 1;
    const occ = byId.get(chip.id);
    changes.push({
      id: chip.id,
      // MERGED, never replaced: `meta` also carries whatever else the chip was
      // minted with, and a whole-meta write would drop it.
      meta: { ...(occ?.meta || {}), link: { kind: "occurrence", occId } },
    });
  }
  return { changes, matched, unmatched, skippedNonWiki };
}
