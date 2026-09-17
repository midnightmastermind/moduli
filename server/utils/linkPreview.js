// utils/linkPreview.js
//
// What a URL calls itself: its <title> and its favicon.
//
// ── WHY THIS IS SERVER-SIDE ─────────────────────────────────────────────────
// It fetches an arbitrary URL the user just dropped, so it goes through
// `fetchPageHtml` — the same guarded fetch `import_url` uses. The guard checks
// EVERY redirect hop, not just the first, and the server is the thing with
// network reach; a client-side check would be advisory at best.
//
// ── IT NEVER THROWS FOR A MISSING PIECE ─────────────────────────────────────
// A bookmark with no title is still a bookmark. Every field here degrades to a
// sensible value rather than failing the whole lookup: no <title> falls back to
// the host, no declared icon falls back to `/favicon.ico`. The ONLY failure is
// "could not reach it at all", which the caller reports.

import { coverFromHtml } from "./pageCover.js";
import { decodeEntities } from "./htmlEntities.js";

/** The page's own name, or "" — same extractor `import_url` already uses. */
export function titleFromHtml(html) {
  const m = /<title[^>]*>([\s\S]{1,300}?)<\/title>/i.exec(String(html || ""));
  // Decoded, because this string is SHOWN (the reader heads its container with
  // it) and STORED (a saved bookmark takes it as a label). badgerherald's title
  // reaches us as "UW&#8217;s underground labyrinth &#8211; The Badger Herald".
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
}

/**
 * The best icon a page declares, resolved to an absolute URL.
 *
 * Preference order is by USEFULNESS AS A FACE, not by what the spec calls
 * canonical: an apple-touch-icon is a real bitmap at a usable size, while
 * `rel="icon"` is often a 16px .ico that looks like grit at card size. Sizes
 * are honoured when declared, so a page offering several gets its biggest.
 */
export function faviconFromHtml(html, pageUrl) {
  const base = (() => { try { return new URL(pageUrl); } catch { return null; } })();
  if (!base) return "";
  const abs = (href) => { try { return new URL(href, base).href; } catch { return ""; } };

  const found = [];
  // Attribute order is not guaranteed, so rel and href are read independently
  // — the same reason `htmlToMarkdown` matches img src/alt separately.
  const linkTags = String(html || "").match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    const rel = (/\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || "").toLowerCase();
    if (!/\b(icon|apple-touch-icon|apple-touch-icon-precomposed|shortcut icon)\b/.test(rel)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!href) continue;
    const sizes = /\bsizes\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] || "";
    const px = Math.max(0, ...(sizes.match(/\d+/g) || ["0"]).map(Number));
    const apple = rel.includes("apple");
    found.push({ url: abs(href), px, apple });
  }
  found.sort((a, b) => (b.px - a.px) || (Number(b.apple) - Number(a.apple)));
  const best = found.find((f) => f.url);
  // Every host serves /favicon.ico whether it declares one or not, so this is a
  // real fallback rather than a guess that produces a broken image.
  return best ? best.url : `${base.origin}/favicon.ico`;
}

/** A readable name when the page declares no title: the host, minus "www.". */
export function hostLabel(pageUrl) {
  try { return new URL(pageUrl).host.replace(/^www\./i, ""); } catch { return ""; }
}

/**
 * @returns {Promise<{ ok: true, url, title, favicon } | { ok: false, error }>}
 */
export async function fetchLinkPreview(url, { fetchPageHtml }) {
  try {
    const fetched = await fetchPageHtml(url);
    const finalUrl = fetched?.url || url;
    // THE COVER IS FREE HERE, and that is the whole reason it belongs in this
    // function: the page is ALREADY fetched for the title and the favicon, so
    // asking for its og:image costs no second request.
    //
    // `coverFromHtml` is the SAME extractor that produced all 1,464 covers the
    // Raindrop import has (migration 0201) — og:image, then a declared icon,
    // then the site favicon. Re-deriving a preference order here would be a
    // second opinion about what a page's picture is, and the two would drift.
    //
    // WHY THIS WAS MISSING AND WHY IT MATTERS: 0201 only ever covered rows
    // carrying `meta.raindropId`, so a bookmark created IN THE APP never got a
    // picture at all — measured on the live grid, every one of the 8 coverless
    // bookmarks is an app-made one, and each is labelled by its bare host
    // because nothing fetched its title either.
    const cover = coverFromHtml(fetched?.html, finalUrl);
    return {
      ok: true,
      url: finalUrl,
      title: titleFromHtml(fetched?.html) || hostLabel(finalUrl) || finalUrl,
      favicon: faviconFromHtml(fetched?.html, finalUrl),
      cover: cover?.url || null,
      coverVia: cover?.via || null,
    };
  } catch (err) {
    return { ok: false, error: err?.message || "could not reach that link" };
  }
}
