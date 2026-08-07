// utils/mainContent.js
//
// A converted link should become the ARTICLE, not the whole website.
//
// Measured on a real page before writing this: importing
// https://en.wikipedia.org/wiki/Pomodoro_Technique raw produced 89 occurrences
// whose first textblock read *"Jump to content Main menu Main menu move to
// sidebar hide Navigation Main page…"* — the site's nav chrome, imported as
// prose. `/research/wikipedia/import` never had this problem because it asks
// the MediaWiki API for the rendered article body; an arbitrary URL gives us
// the whole document, chrome included.
//
// Two passes, both conservative:
//   1. NARROW to the main content region when the page marks one (<main>,
//      <article>, [role=main], #content …). Modern semantic HTML makes this
//      reliable; when nothing matches we keep the whole body rather than
//      guessing with heuristics that could throw away the actual content.
//   2. STRIP the furniture that is chrome anywhere it appears (nav, header,
//      footer, aside, script, style, forms, and the usual cookie/banner ids).
//
// The bias throughout is "keep too much rather than lose the article" — a
// noisy import is annoying, a truncated one is a lie about the source.

import * as cheerio from "cheerio";

// Ordered by confidence: the first that matches AND has real text wins.
const MAIN_SELECTORS = [
  "main",
  "article",
  "[role='main']",
  "#mw-content-text",     // MediaWiki
  "#content",
  "#main-content",
  ".post-content",
  ".entry-content",
  ".article-body",
];

const CHROME_SELECTORS = [
  "script", "style", "noscript", "template", "svg",
  "nav", "header", "footer", "aside",
  "form", "button",
  "[role='navigation']", "[role='banner']", "[role='contentinfo']", "[role='search']",
  "[aria-hidden='true']",
  ".navbox", ".sidebar", ".mw-editsection", ".mw-jump-link", ".vector-header",
  ".toc", "#toc", "#siteNotice", "#mw-navigation", "#footer",
  ".cookie-banner", ".newsletter", ".advertisement", "[id*='cookie']",
];

// Below this a "main" region is almost certainly a wrapper we mis-picked, so
// we fall back rather than import an empty page.
const MIN_MAIN_TEXT = 200;

/**
 * Narrow raw page HTML to its article content.
 * @returns {{ html: string, usedSelector: string|null, strippedChrome: boolean }}
 */
export function extractMainContent(rawHtml) {
  const input = String(rawHtml || "");
  if (!input.trim()) return { html: input, usedSelector: null, strippedChrome: false };

  let $;
  try { $ = cheerio.load(input); }
  catch { return { html: input, usedSelector: null, strippedChrome: false }; }

  // (2) first — so a nav INSIDE <main> goes too (Wikipedia puts several there).
  $(CHROME_SELECTORS.join(",")).remove();

  // (1) pick the narrowest region that still holds the article.
  let usedSelector = null;
  let region = null;
  for (const sel of MAIN_SELECTORS) {
    const el = $(sel).first();
    if (el.length && (el.text() || "").trim().length >= MIN_MAIN_TEXT) {
      region = el;
      usedSelector = sel;
      break;
    }
  }

  const html = region ? ($.html(region) || "") : ($.html("body") || $.html() || input);
  return { html, usedSelector, strippedChrome: true };
}
