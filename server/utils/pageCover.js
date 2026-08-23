// utils/pageCover.js
//
// The cover image of a web page, from its HTML.
//
// USER, 2026-08-23: *"make all of those image searches. use the urls as the
// image search, we dont need an artifact for each cover"* — and, asked which
// mechanism, chose fetching each page's own og:image with a favicon fallback.
//
// ── WHY NOT AN IMAGE SEARCH ────────────────────────────────────────────────
//
// The spec's original plan was "an image search by title" for the 437 rows the
// Raindrop export left coverless. Measuring the titles killed it:
//
//     "Microsoft Word - 2007-109.doc - 2007-109.pdf"
//     "Pausanias, Description of Greece, a target=\"_blank\" onclick=..."   <- raw HTML
//     "diape search results - PornZog Free Porn Clips"
//
// Those are the STORED titles. An image search on the third one would put
// pornography on the user's board; on the first two it would return nothing
// related. And the 1,030 covers the export DID supply are og:images
// (`upload.wikimedia.org/...`, `imgv2-1-f.scribdassets.com/...`), so taking the
// page's own og:image is the only route that makes all 1,467 rows one kind of
// thing rather than two.
//
// ── PURE, and that is the point ────────────────────────────────────────────
//
// The fetching lives in the caller. Here the interesting part is the PREFERENCE
// ORDER and what gets refused, and both are testable against real markup
// without touching the network — which is what lets 437 outbound requests be
// spent once rather than debugged by re-running them.
import * as cheerio from "cheerio";

/**
 * A URL is usable as a cover only if it is an ordinary web image reference.
 *
 * `data:` is refused ON PURPOSE even though it parses: a data URI cover is
 * stored in full on the row, and the ones that appear in the wild are 1x1
 * tracking pixels and inline SVG spinners — so it would bloat the document to
 * store a picture of nothing.
 */
export function isUsableCoverUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
}

/**
 * Resolve a possibly-relative reference against the page it came from.
 *
 * THE ABSOLUTE CASE IS TRIED FIRST, and a test is what found that it had to be:
 * `new URL(ref, base)` throws on a malformed BASE even when `ref` is already
 * absolute and needs no base at all — so a page with a perfectly good og:image
 * lost it because of its own URL. A reference that stands on its own is
 * resolved on its own.
 */
export function absolutize(ref, pageUrl) {
  const s = String(ref || "").trim();
  if (!s) return null;
  try { return new URL(s).href; } catch { /* relative — needs the page */ }
  try { return new URL(s, pageUrl).href; } catch { return null; }
}

// Ordered best-first. Each entry is [selector, attribute].
//
// `og:image` first because it is the tag that MEANS "this is the picture of
// this page" — it is what a link preview anywhere else shows, and it is what
// Raindrop itself stored for the other 1,030.
const COVER_SOURCES = [
  ['meta[property="og:image:secure_url"]', "content"],
  ['meta[property="og:image"]', "content"],
  ['meta[name="og:image"]', "content"],          // some sites use name= for OG
  ['meta[name="twitter:image"]', "content"],
  ['meta[name="twitter:image:src"]', "content"],
  ['meta[property="twitter:image"]', "content"],
  ['link[rel="image_src"]', "href"],
  ['meta[itemprop="image"]', "content"],
];

// Icons, only reached when nothing above matched. Biggest-intent first: an
// apple-touch-icon is 180px and looks like a picture; a favicon is 16-32px and
// looks like a broken one. Both beat a blank card, which is the call the user
// made when asked.
const ICON_SOURCES = [
  ['link[rel="apple-touch-icon-precomposed"]', "href"],
  ['link[rel="apple-touch-icon"]', "href"],
  ['link[rel="shortcut icon"]', "href"],
  ['link[rel="icon"]', "href"],
];

/**
 * @returns {{ url: string, via: "og"|"icon"|"origin-favicon" } | null}
 *
 * `via` is reported rather than swallowed so the pass can say how many rows got
 * a real cover and how many got an icon. "437 covered" and "60 covered, 377
 * favicons" are very different outcomes and only one of them is worth showing.
 */
export function coverFromHtml(html, pageUrl) {
  const $ = cheerio.load(String(html || ""));

  for (const [sel, attr] of COVER_SOURCES) {
    for (const el of $(sel).toArray()) {
      const abs = absolutize($(el).attr(attr), pageUrl);
      if (isUsableCoverUrl(abs)) return { url: abs, via: "og" };
    }
  }
  for (const [sel, attr] of ICON_SOURCES) {
    for (const el of $(sel).toArray()) {
      const abs = absolutize($(el).attr(attr), pageUrl);
      if (isUsableCoverUrl(abs)) return { url: abs, via: "icon" };
    }
  }
  // Every site serves /favicon.ico whether or not it declares one, so this is a
  // guess that costs no request HERE — the caller finds out it was wrong when
  // the browser fails to load it, and a broken <img> is the same outcome as no
  // cover at all. It is only reached when the page declared nothing.
  const origin = originFaviconFor(pageUrl);
  return origin ? { url: origin, via: "origin-favicon" } : null;
}

/** `https://x.com/a/b?q=1` -> `https://x.com/favicon.ico` */
export function originFaviconFor(pageUrl) {
  try {
    const u = new URL(pageUrl);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.origin}/favicon.ico`;
  } catch { return null; }
}
