// utils/harvestLinks.js
//
// "…and follow its links" — the pages a dropped link POINTS AT, listed so the
// user can tick the ones worth importing (user decision D5, 2026-08-09: one
// hop, any domain, CONFIRM FIRST, nothing imported until approved).
//
// The decision this file makes is WHICH links are worth offering. It is pure so
// that decision is testable without a network: the handler does the guarded
// fetch, this does the reading.
//
// THREE THINGS IT REFUSES, each because offering them wastes a fetch or a
// checkbox on something that cannot become a page:
//
//   1. Anything that is not http/https — `mailto:`, `tel:`, `javascript:`.
//   2. A link back to the page you dropped (bare `#anchor`s, and the source
//      URL itself). Importing the page you are already importing is a
//      duplicate, and on a long article the in-page table of contents is
//      dozens of them.
//   3. A URL whose path ends in a FILE extension we know is not a web page.
//      `import_url` refuses a non-HTML content-type anyway, so these would
//      each cost a round trip to fail. The list is deliberately short —
//      guessing from the extension is only safe where the answer is obvious,
//      and an extensionless URL is always kept.
//
// The bias is the same one `mainContent` takes: keep too much rather than drop
// a real link. Every refusal above is a fact about the URL, never a guess about
// whether the page is INTERESTING — that is the user's call, which is what the
// confirm list is for.

import * as cheerio from "cheerio";

/** Extensions that are never a web page. Short on purpose — see the header. */
const NON_PAGE_EXT =
  /\.(jpe?g|png|gif|webp|svg|bmp|ico|avif|mp[34]|m4[av]|wav|ogg|webm|mov|avi|mkv|pdf|zip|t?gz|rar|7z|bz2|xz|docx?|xlsx?|pptx?|csv|rtf|epub|exe|dmg|apk|iso)$/i;

/** Default ceiling. A hub page can carry hundreds of links; a list that long
 *  is unreadable, and every entry is a full page import if ticked. */
export const HARVEST_LINK_CAP = 100;

/**
 * The URL as an identity: no fragment, everything else kept.
 *
 * The QUERY stays because `?page=2` is a different document — the same rule
 * `helpers/convertRelink.sameLinkTarget` holds, and for the same reason.
 * Returns null when the href cannot be resolved at all.
 */
export function normalizeLinkUrl(href, baseUrl) {
  if (typeof href !== "string" || !href.trim()) return null;
  let u;
  try { u = new URL(href.trim(), baseUrl || undefined); }
  catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  return u.toString();
}

/** What to call a link when its anchor text is empty (an image link, an icon). */
function labelFromUrl(url) {
  try {
    const u = new URL(url);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    if (seg) return decodeURIComponent(seg).replace(/[-_]+/g, " ").slice(0, 120);
    return u.hostname;
  } catch { return url.slice(0, 120); }
}

/**
 * Every distinct page this HTML links out to, in document order.
 *
 * @param {string} html     the page's HTML (already narrowed to the article by
 *                          `extractMainContent` — a raw page's nav and footer
 *                          are chrome, and their links are the site's, not the
 *                          article's)
 * @param {string} baseUrl  the URL the html came FROM; relative hrefs resolve
 *                          against it and it is excluded from the result
 * @param {{max?:number}} [opts]
 * @returns {{links: Array<{url:string,label:string}>, truncated:boolean, total:number}}
 *          `total` is what was found BEFORE the cap, so the caller can say how
 *          many were dropped rather than silently showing a short list.
 */
export function extractLinks(html, baseUrl, { max = HARVEST_LINK_CAP } = {}) {
  const out = [];
  const seen = new Set();
  if (typeof html !== "string" || !html) return { links: out, truncated: false, total: 0 };

  const self = normalizeLinkUrl(baseUrl, baseUrl);
  if (self) seen.add(self);

  let $;
  try { $ = cheerio.load(html); }
  catch { return { links: out, truncated: false, total: 0 }; }

  let total = 0;
  $("a[href]").each((_, el) => {
    const url = normalizeLinkUrl($(el).attr("href"), baseUrl);
    if (!url) return;
    // The extension test reads the PATH only — a `?download=file.zip` query is
    // not a claim about what the page is.
    let path = "";
    try { path = new URL(url).pathname; } catch { /* keep it */ }
    if (NON_PAGE_EXT.test(path)) return;
    if (seen.has(url)) return;
    seen.add(url);
    total += 1;
    if (out.length >= max) return;
    const text = $(el).text().replace(/\s+/g, " ").trim();
    out.push({ url, label: (text || labelFromUrl(url)).slice(0, 120) });
  });

  return { links: out, truncated: total > out.length, total };
}
