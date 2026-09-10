// 0330 — thirty bookmarks are labelled with nothing but their host.
//
// User, 2026-09-10: *"we cant pull a better title for the youtube video i have
// in bookmarks? it just says youtube as the occurance label"*.
//
// **MEASURED FIRST, AND THE MEASUREMENT SHRANK THE JOB BY FIFTY TIMES.** This
// reads like a systemic import defect and is not:
//
//     bookmarks                         1468
//     uninformative label                 30   (2%)
//     youtube bookmarks                   91
//     youtube bookmarks affected           1   <- the one they noticed
//
// Ninety of the ninety-one YouTube rows carry a real title. The one that does
// not is a page Raindrop captured before the video title had rendered, which is
// exactly the shape of the other twenty-nine.
//
// **AND A BETTER TITLE IS AVAILABLE.** For that row, live:
//
//     stored label   "YouTube"
//     <title>        "Futuristic HUD Sound Design | Blake Sanchez - YouTube"
//     og:title       "Futuristic HUD Sound Design | Blake Sanchez"
//
// `og:title` is preferred over `<title>`: it is what the page calls ITSELF for
// sharing, without the " - YouTube" site suffix that `<title>` carries. Falls
// back to `<title>` (suffix trimmed) when no og tag exists.
//
// ── WHAT COUNTS AS UNINFORMATIVE, AND WHY IT IS NARROW ──────────────────────
//
// This rewrites labels the user can see, so the predicate refuses anything it
// is not sure about. A label is uninformative ONLY when it is:
//
//   • empty, or
//   • the host verbatim ("jpoms.com", "192.168.3.1"), or
//   • the host's brand word alone ("YouTube", "Google", "CodeSandbox")
//
// A label that merely CONTAINS the brand is left alone — "The Egg - A Short
// Story" is a real title and so is "YouTube Rewind 2018". The rule is equality,
// never a substring, because a substring rule would rewrite the ninety rows
// that are already right.
//
// ── AND IT NEVER REPLACES A TITLE WITH ANOTHER USELESS ONE ──────────────────
//
// The fetched title is put through the SAME predicate before it is written. A
// page that calls itself "YouTube" gets left as it was rather than rewritten to
// the identical string, and a fetch that fails changes nothing.
import { fetchPageHtml } from "../utils/safeFetchUrl.js";

export const id = "0330-a-bookmark-that-names-only-its-host";
export const description =
  "Refetch the title of bookmarks labelled with nothing but their host (30 of 1,468).";
export const touches = ["modules"];

/** The host, minus "www.". */
export function hostOf(url) {
  try { return new URL(String(url)).hostname.replace(/^www\./i, ""); } catch { return ""; }
}

/**
 * Is this label telling you nothing about the page?
 * EQUALITY ONLY — a substring rule would rewrite every real title containing
 * the brand, which is 90 of this grid's 91 YouTube rows.
 */
export function isUninformative(label, url) {
  const l = String(label || "").trim();
  if (!l) return true;
  const h = hostOf(url);
  if (!h) return false;
  const brand = h.split(".")[0];
  return l.toLowerCase() === h.toLowerCase() || l.toLowerCase() === brand.toLowerCase();
}

/** og:title, else <title> with a trailing " - Site" suffix trimmed. */
export function titleFrom(html, url) {
  const s = String(html || "");
  const og =
    (s.match(/property=["']og:title["'][^>]*content=["']([^"']{1,200})/i) || [])[1] ||
    (s.match(/content=["']([^"']{1,200})["'][^>]*property=["']og:title["']/i) || [])[1];
  if (og) return decodeEntities(og.trim());
  const t = (s.match(/<title[^>]*>([\s\S]{1,300}?)<\/title>/i) || [])[1];
  if (!t) return "";
  const brand = hostOf(url).split(".")[0];
  // "Foo | Bar - YouTube" -> "Foo | Bar". Only the site's OWN name, and only at
  // the end, so a title that legitimately ends in a dash is untouched.
  const trimmed = brand
    ? t.replace(new RegExp(`\\s*[-–|]\\s*${brand}\\s*$`, "i"), "")
    : t;
  return decodeEntities(trimmed.trim());
}

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module } = models;
  const mods = await Module.find({ gridId, role: "artifact", kind: "bookmark" }).lean();
  const targets = mods.filter((m) => isUninformative(m.label, m.fileRef));
  log(`bookmarks: ${mods.length} · uninformative label: ${targets.length}`);
  if (!targets.length) return { changed: 0 };

  let changed = 0, refused = 0, failed = 0;
  for (const m of targets) {
    const r = await fetchPageHtml(m.fileRef, { timeoutMs: 8000 });
    if (!r.ok) { failed++; log(`  · "${m.label}" — ${r.reason}`); continue; }
    const next = titleFrom(r.html, m.fileRef);
    // THE SAME PREDICATE, applied to what came back. A page that also calls
    // itself by its host is left exactly as it was.
    if (!next || isUninformative(next, m.fileRef) || next === m.label) {
      refused++; log(`  · "${m.label}" — no better title offered`); continue;
    }
    log(`  ✓ "${m.label}" → "${next}"`);
    if (!dryRun) await Module.updateOne({ _id: m._id }, { $set: { label: next } });
    changed++;
    await new Promise((res) => setTimeout(res, 300));  // polite to 30 strangers
  }
  log(`${dryRun ? "would update" : "updated"} ${changed} · refused ${refused} · unreachable ${failed}`);
  return { changed };
}
