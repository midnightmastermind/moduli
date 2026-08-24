// helpers/wikipediaPage.js
//
// "a wikipedia page button on the quick add menu so i can search for wikipedia
// articles to turn into pages on the fly" — user, 2026-08-24.
//
// Everything this needs already exists and none of it is re-implemented here:
//   • the SEARCH is the `wikipedia` provider, through `/api/search/...`, the
//     same route every dropdown uses (`useProviderSearch` debounces + aborts).
//   • the IMPORT is `convertLinkToPage` -> the server's `import_url`, which
//     fetches the article and builds the whole tree with `markdownToModuli`.
//     That is the same path "convert this link to a page" has used since
//     2026-08-07, so a searched article and a dropped link produce the SAME
//     page rather than two importers that drift.
//
// What is genuinely new is one decision, and it lives here as a pure function
// so the menu's gating is testable without a DOM.

/** Hosts an article link may legitimately have. Any language, and the mobile
 *  host, because a result's own `url` is whatever the API returned. */
const WIKI_HOST = /^(?:[a-z-]+\.)?(?:m\.)?wikipedia\.org$/i;

/**
 * The article URL to import, or null.
 *
 * **The host is checked, and that is not paranoia about the provider.** This
 * tile says "Wikipedia" on it; a result whose url pointed anywhere else would
 * import a page the user did not ask for, under a button that promised
 * otherwise. A result with no url at all is the ordinary case for a search hit
 * that carries only a title — it is not importable and must not be offered.
 */
export function wikipediaUrlOf(result) {
  const raw = typeof result?.url === "string" ? result.url.trim() : "";
  if (!raw) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  // http is refused rather than upgraded: the grid is https, and a silent
  // upgrade is a guess about someone else's server.
  if (u.protocol !== "https:") return null;
  if (!WIKI_HOST.test(u.hostname)) return null;
  return u.toString();
}

/** Can this search result become a page? */
export function canImportAsPage(result) {
  return !!wikipediaUrlOf(result);
}

/**
 * The page's name. The provider's title, falling back to the last path
 * segment — an article always has one, and "Inception" reads better than a
 * blank row in the tree. Never an empty string: `0203` paid for a page whose
 * label was "" and rendered as a blank row.
 */
export function pageTitleOf(result) {
  const t = String(result?.title || "").trim();
  if (t) return t;
  const url = wikipediaUrlOf(result);
  if (!url) return "Untitled";
  try {
    const seg = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() || "");
    return seg.replace(/_/g, " ").trim() || "Untitled";
  } catch { return "Untitled"; }
}

/**
 * The exact payload the import request carries, or null when the result is not
 * importable.
 *
 * **This exists so the thing that LEAVES the menu can be asserted without
 * mounting it.** 2026-08-11 (5) is the reason: an operation was verified by
 * driving the callee directly for months while the caller passed a single
 * object into a positional function, so the feature was dead and every test
 * green. *Driving the callee proves nothing about the call.*
 *
 * `parentId` is the occurrence whose "+" was clicked — `markdownToModuli` homes
 * the import root there, which is what puts the page where you asked for it.
 * A null parent is legal and means the server's own default home.
 */
export function buildWikipediaImport(result, { gridId, hostOccurrence = null } = {}) {
  const url = wikipediaUrlOf(result);
  if (!url || !gridId) return null;
  return { gridId, url, title: pageTitleOf(result), parentId: hostOccurrence?.id || null };
}
