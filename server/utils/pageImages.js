// utils/pageImages.js
//
// EVERY picture a page offers, best-first — the choices behind the placement
// window's Cover row (user, 2026-09-29: *"give it that image search thing we
// have as well to choose from (or photos we get from the share)"*).
//
// `pageCover.coverFromHtml` answers a different question: "which ONE picture IS
// this page". That is the right answer for a bookmark tile and for the cover
// row's SUGGESTION, and it is the wrong answer for a movie whose og:image is a
// site banner while the poster sits in the article. So this returns a LIST and
// lets the person choose.
//
// PURE, like pageCover and for the same reason: the interesting part is the
// order and the refusals, and both are testable against real markup without
// spending a request.
import * as cheerio from "cheerio";
import { absolutize, isUsableCoverUrl } from "./pageCover.js";
import { bestImageSrc } from "../services/wikipediaTools.js";

// How many to hand back. The picker shows them as a thumbnail grid, and past a
// screenful the extra ones are scrolling rather than choosing.
export const PAGE_IMAGE_CAP = 24;

// A declared dimension under this is an icon, a spacer or a tracking pixel —
// never a cover. Only applied when the page SAYS how big it is: most real
// images declare nothing, and refusing those would leave most pages empty.
const MIN_DECLARED_PX = 64;

// The page's own declaration of its picture, best-first. Same list and same
// order as pageCover's COVER_SOURCES — imported would be better, but that one
// is a private const there and prising it out would change a file with its own
// migration history. Kept in sync by `pageImages.test.js`, which asserts the
// og:image pageCover picks is the FIRST candidate here.
const DECLARED = [
  ['meta[property="og:image:secure_url"]', "content"],
  ['meta[property="og:image"]', "content"],
  ['meta[name="og:image"]', "content"],
  ['meta[name="twitter:image"]', "content"],
  ['meta[name="twitter:image:src"]', "content"],
  ['meta[property="twitter:image"]', "content"],
  ['link[rel="image_src"]', "href"],
  ['meta[itemprop="image"]', "content"],
];

/** A declared width/height that proves the image is too small to be a cover. */
function tooSmall($el) {
  for (const attr of ["width", "height"]) {
    const n = Number(String($el.attr(attr) || "").replace(/px$/i, ""));
    if (Number.isFinite(n) && n > 0 && n < MIN_DECLARED_PX) return true;
  }
  return false;
}

/**
 * @returns {{ url: string, via: "declared"|"img", alt?: string }[]}
 *   Deduped by absolute URL, declared pictures first, then <img> in document
 *   order. Never a `data:` URI and never an icon — see pageCover for why a
 *   favicon stretched into a poster slot is worse than no picture at all.
 */
export function imagesFromHtml(html, pageUrl, { max = PAGE_IMAGE_CAP } = {}) {
  const $ = cheerio.load(String(html || ""));
  const out = [];
  const seen = new Set();

  const push = (raw, via, alt) => {
    if (out.length >= max) return;
    const abs = absolutize(raw, pageUrl);
    if (!isUsableCoverUrl(abs) || seen.has(abs)) return;
    seen.add(abs);
    out.push(alt ? { url: abs, via, alt } : { url: abs, via });
  };

  for (const [sel, attr] of DECLARED) {
    for (const el of $(sel).toArray()) push($(el).attr(attr), "declared");
  }

  for (const el of $("img").toArray()) {
    const $el = $(el);
    if (tooSmall($el)) continue;
    // `bestImageSrc`, NOT `src`: a lazy-loading page's `src` is a placeholder
    // and a srcset page's `src` can be an alias that 404s (2026-09-15 —
    // badgerherald.com served 3 of 4 images broken through `src` alone). One
    // definition of "which URL does this <img> really mean", shared with the
    // importers.
    const best = bestImageSrc((n) => $el.attr(n));
    if (best) push(best, "img", String($el.attr("alt") || "").trim() || undefined);
  }

  return out;
}
