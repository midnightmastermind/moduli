// server/utils/providers/wikipedia.js
//
// The first provider, and deliberately the KEYLESS one — it proves the whole
// path (search → pick → mint → prefill) with no account, no secret and no
// approval step.
//
// ── WHAT IT CAN AND CANNOT ANSWER ──────────────────────────────────────────
//
// Wikipedia answers "does this thing exist and what is it called", and its
// INFOBOX is a real prefill source: `extractInfobox` already parses the sidebar
// into label/value rows, and `0041` already had to clean two artifacts out of it
// (empty `<li>`s emitting bare commas, and zero-width characters that survive
// every `\s+` collapse). It cannot answer per-serving macros, a muscle group, or
// an ISBN-level edition — those want a domain source, which is why this is a
// registry and not a Wikipedia special case.
//
// Nothing here fetches a full article. `fullMarkdown` builds a whole page tree
// and is the right answer to "keep this"; a dropdown wants a name and a few facts.
import { search as wikiSearch, summary as wikiSummary, extractInfobox } from "../../services/wikipediaTools.js";
import { normalizeResult, registerProvider } from "../searchProviders.js";

const WIKI_API = "https://en.wikipedia.org/w/api.php";

/** Infobox rows → a flat map, keyed by the row's own label. */
export function infoboxToFields(rows) {
  const out = {};
  for (const r of rows || []) {
    const k = String(r?.label || "").trim();
    const v = String(r?.value || "").trim();
    // A row with no label is not addressable, and an empty value is worse than
    // absent: `0052`/`0054`'s rule is that a blank is honest and a guess is not.
    if (!k || !v) continue;
    if (out[k] === undefined) out[k] = v;      // first wins; infoboxes repeat labels
  }
  return out;
}

export const wikipediaProvider = registerProvider({
  id: "wikipedia",
  label: "Wikipedia",
  requiresEnv: null,                            // keyless

  async search(query, { limit = 6 } = {}) {
    const hits = await wikiSearch(query, { limit });
    return hits.map((h) => normalizeResult({
      provider: "wikipedia",
      // The pageid is STABLE across renames, which a title is not — and it is
      // what stops a result already on the grid being offered twice.
      externalId: h.pageid,
      title: h.title,
      subtitle: h.snippet || null,
      url: h.url,
    }));
  },

  /**
   * One picked result → the fields worth writing. Two requests, deliberately:
   * the REST summary carries the thumbnail and lede, and the infobox needs the
   * rendered HTML the summary endpoint does not return.
   */
  async detail({ title, externalId } = {}) {
    if (!title) return null;
    const sum = await wikiSummary(title).catch(() => null);
    let infobox = {};
    try {
      const res = await fetch(
        `${WIKI_API}?action=parse&page=${encodeURIComponent(title)}&prop=text&formatversion=2&format=json&origin=*`,
        { headers: { "User-Agent": "Moduli/1.0 (+https://viafluere.com)" }, signal: AbortSignal.timeout(15000) },
      );
      if (res.ok) {
        const j = await res.json();
        infobox = infoboxToFields(extractInfobox(j?.parse?.text || ""));
      }
    } catch { /* the infobox is a bonus; a page without one is still importable */ }

    return normalizeResult({
      provider: "wikipedia",
      externalId: externalId ?? null,
      title: sum?.title || title,
      subtitle: sum?.description || null,
      thumbnail: sum?.thumbnail || null,
      url: sum?.url || null,
      fields: { ...infobox, ...(sum?.extract ? { Summary: sum.extract } : {}) },
    });
  },
});
