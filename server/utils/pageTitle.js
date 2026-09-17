// utils/pageTitle.js
//
// WHAT A PAGE CALLS ITSELF.
//
// There were two answers to this and they disagreed on real pages. Migration
// `0330` prefers `og:title` and trims the site's own name off the end;
// `linkPreview.titleFromHtml` read `<title>` verbatim. Measured on the same
// YouTube video, the same afternoon:
//
//     0330 (og:title)          "Jung, Alcoholics Anonymous, And Drug Seeking Behaviour"
//     fetchLinkPreview(<title>) "- YouTube"
//
// So a bookmark saved in the app was about to be labelled "- YouTube" while the
// migration that exists to FIX bad labels would have named it properly. That is
// the twin drift this repo keeps paying for, so the rule lives in one place and
// both import it.
//
// ── WHY og:title WINS ──────────────────────────────────────────────────────
//
// `og:title` is what the page calls itself FOR SHARING — no site suffix, no
// "(3) " unread counter, no "| Home". `<title>` is what the tab says, which is
// a different job. When there is no og tag, `<title>` is the fallback with the
// site's OWN name trimmed from the end only ("Foo | Bar - YouTube" -> "Foo |
// Bar"), so a title that legitimately ends in a dash is untouched.
//
// ── THIS IS NOT THE READER'S HEADER ────────────────────────────────────────
//
// `titleFromHtml` (raw `<title>`) is deliberately still used to head Reader and
// Magic, because "which page am I reading" is a different question from "what
// should this bookmark be called", and whether that header should carry the
// site suffix is an open decision (CLAUDE.md 2026-09-15 (2), "worth deciding,
// not changed"). Resolving it as a side effect of a label fix would be a
// silent answer to someone else's question.

import { decodeEntities } from "./htmlEntities.js";

/** The registrable-ish host, lowercased, without `www.`. */
export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, "").toLowerCase(); }
  catch { return ""; }
}

// THE DECODER ALREADY EXISTS — `utils/htmlEntities.js`, extracted on
// 2026-09-15 precisely because an inline replace-chain was the wrong shape and
// was reachable by nobody else. A fourth hand-rolled chain here would have had
// the same hole the third one did: my own first version matched `&#0?39;` and
// therefore missed `&#0039;` (two zeros), which is what a real page sends. The
// shared decoder handles decimal, hex and the named entities real pages use,
// and gets `&amp;` LAST on purpose.

/**
 * The best title a page offers for being NAMED: og:title, else `<title>` with
 * the site's own brand word trimmed off the end.
 * @returns {string} "" when the page offers neither.
 */
export function bestTitleFrom(html, url) {
  const s = String(html || "");
  // Attribute order is not guaranteed, so both orderings are matched.
  const og =
    (s.match(/property=["']og:title["'][^>]*content=["']([^"']{1,200})/i) || [])[1] ||
    (s.match(/content=["']([^"']{1,200})["'][^>]*property=["']og:title["']/i) || [])[1];
  if (og && og.trim()) return decodeEntities(og.trim()).replace(/\s+/g, " ").trim();

  const t = (s.match(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i) || [])[1];
  if (!t) return "";
  const brand = hostOf(url).split(".")[0];
  // ONLY the site's own name, and ONLY at the end.
  const trimmed = brand
    ? t.replace(new RegExp(`\\s*[-–|]\\s*${brand}\\s*$`, "i"), "")
    : t;
  return decodeEntities(trimmed).replace(/\s+/g, " ").trim();
}
