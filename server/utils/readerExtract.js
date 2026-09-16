// utils/readerExtract.js
//
// READER MODE's extraction — the same chain `import_url` uses, stopped one step
// short of writing anything.
//
//     fetchPageHtml -> extractMainContent -> wikiHtmlToMarkdown -> [markdownToModuli]
//                                                                   ^ import_url only
//
// Reusing that chain is the point: a second extractor would mean the text you
// READ and the text you IMPORT could disagree, and the one nobody tests would
// be the one that drifts.
//
// WHY A WORD COUNT COMES BACK. The user asked for reader mode "if possible", and
// possible is doing real work: measured across fourteen of their own bookmarks,
// one per domain, about half return a real article server-side and the rest
// return a JavaScript shell —
//
//     wikipedia 12,997 words · coffeehousetheology 11,941 · cslewisinstitute 5,709
//     ...
//     scribd 195 · blog.spl.org 108 · amazon 62 · reddit 29
//
// Reddit is the clearest: 29 words, because the page builds itself in the
// browser. A reader view showing 29 words of nav chrome is worse than the site,
// so the CALLER decides — this returns the count and does not judge.
// CALIBRATED AGAINST THE REAL EXTRACTOR, not a regex tag-strip. A first pass
// estimated word counts by stripping tags with sed and was badly wrong in both
// directions — amazon.com read 62 words that way and 4,965 through this chain,
// catholiceducation 108 vs 4,278. Tuning a threshold against the wrong
// instrument would have hidden half the collection behind the wrong mode.
//
// Fourteen of the user's own bookmarks, one per domain, through THIS code:
//
//     0    reddit.com          <- builds itself in the browser
//     0    viafluere.com
//    35    scribd.com
//   ------------------------- nothing lands in here -------------------------
//   542    blog.spl.org        599 danbrown      638 prs.org
//   964    divinity.uchicago  1011 eppc.org     4278 catholiceducation
//  4897    cslewisinstitute   4965 amazon       6106 wikipedia
// 11429    coffeehousetheology
//
// The number sits in the GAP. A threshold inside a cluster is arbitrary; this
// one has 165 words of margin below and 342 above, so a page has to change
// character completely before it crosses.
export const READER_MIN_WORDS = 200;

import { wikiHtmlToMarkdown, leadImageFromHtml, injectLeadBlocks } from "../services/wikipediaTools.js";
import { extractMainContent } from "../utils/mainContent.js";

/** Words of prose in a markdown string, ignoring syntax and link targets. */
export function wordCount(markdown) {
  if (typeof markdown !== "string" || !markdown) return 0;
  const prose = markdown
    .replace(/```[\s\S]*?```/g, " ")        // fenced code is not prose
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")  // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")// keep link TEXT, drop the target
    .replace(/[#>*_`|~-]+/g, " ");
  return prose.split(/\s+/).filter(Boolean).length;
}

/**
 * HTML -> { markdown, words }. Pure, so the threshold can be calibrated against
 * the REAL extractor rather than against a regex tag-strip.
 */
export function readerFromHtml(html, title = "") {
  const { html: mainHtml } = extractMainContent(html || "");
  let markdown = wikiHtmlToMarkdown(mainHtml, title) || "";
  // THE ARTICLE'S ONLY PICTURE IS OFTEN THE ONE IN ITS INFOBOX, and the infobox
  // is stripped as a metadata table — so the reader showed a wikipedia article
  // with no images at all (user, on Albert Ellis). `leadImageFromHtml` reads it
  // off the SAME html the converter just consumed, so this costs no fetch. The
  // dedupe matters: an article whose body already carries the photo (Eminem)
  // must not show it twice.
  const lead = leadImageFromHtml(mainHtml);
  if (lead && !markdown.includes(lead)) {
    markdown = injectLeadBlocks(markdown, [`![${title || ""}](${lead})`]);
  }
  return { markdown, words: wordCount(markdown) };
}

/**
 * Is the reader worth showing for this extraction?
 * The caller decides what to do about `false` — this only answers the question.
 */
export function readerIsUsable(words, min = READER_MIN_WORDS) {
  return typeof words === "number" && words >= min;
}
