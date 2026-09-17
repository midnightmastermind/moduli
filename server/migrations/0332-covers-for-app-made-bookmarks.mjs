// 0332 — the bookmarks YOU made never got a picture.
//
// User, 2026-09-16: *"we should either grabbing a wikipedia logo or the first
// image for wikipedia article bookmarks. the cover image i mean."*
//
// ── THE MEASUREMENT MOVED THE SCOPE OFF WIKIPEDIA ENTIRELY ──────────────────
//
// Censused on the live grid before anything was written:
//
//     bookmark modules          1472
//       with a cover            1464
//       NO cover                   8
//     wikipedia bookmarks         39      (38 covered, 1 not)
//
// So it is not a wikipedia problem — and it is not a rule problem either.
// `0201` gave every bookmark a cover through `coverFromHtml`, whose preference
// order is ALREADY what the request asks for: the page's own og:image, then a
// declared icon, then the site favicon (i.e. "the first image OR the logo").
// Re-running `0201` today plans **zero** fetches.
//
// The gap is its SCOPE. `0201` selects
// `Occurrence.find({ "meta.raindropId": /^b:/ })` — the Raindrop import — so it
// has never once covered a bookmark created IN THE APP. All 8 uncovered rows
// are app-made, which is also why they are labelled by a bare host: nothing
// fetched their title either (that half is `0330`, which re-runs cleanly).
//
// ── AND THE PAGES ARE READABLE NOW, which is what makes this worth running ──
//
// Fetched at the time of writing:
//
//     wikipedia   og:image  Photo_of_Albert_Ellis_on_dust_jacket.jpg
//     youtube     og:image  i.ytimg.com/vi/…/hqdefault.jpg
//     reddit      no og:image   (JS shell for a datacentre fetch → site favicon)
//     chopra      unreachable   (left alone, reported)
//
// Nothing was ever missing for want of a rule. Nothing asked the page.
//
// ── THE SHARED UTILS, NOT A SECOND OPINION ─────────────────────────────────
//
// `coverFromHtml` + `planCoverPass` + `shouldAbortEarly` are `0201`'s own
// helpers. Re-deriving a preference order here would make two answers to "what
// is this page's picture", and the two would drift — which is exactly the twin
// drift the reader's lost images turned out to be.
//
// ── IT IS RESUMABLE AND IT NEVER OVERWRITES ────────────────────────────────
//
// A module is fetched only when it has NO `meta.cover`, so a run that dies
// part-way leaves the rest for the next run, it can never double-fetch, and it
// can never replace a cover a person set by hand. A per-site failure is NORMAL
// (some of these links are dead); but every one of the first few failing is not
// a coincidence, it is no network, and the run REFUSES there.
import { fetchPageHtml } from "../utils/safeFetchUrl.js";
import { coverFromHtml } from "../utils/pageCover.js";
import { interleaveByHost, shouldAbortEarly } from "../utils/coverPass.js";

export const id = "0332-covers-for-app-made-bookmarks";
export const description =
  "Give the bookmarks created in the app a cover, the same way 0201 gave the Raindrop import one — 0201 scopes itself to meta.raindropId and has never covered an app-made bookmark.";

const CONCURRENCY = 4;
const PER_PAGE_TIMEOUT_MS = 12000;

/** Is this a bookmark we can actually ask for a picture? */
export function needsCover(module) {
  if (!module || module.role !== "artifact" || module.kind !== "bookmark") return false;
  if (module.meta?.cover) return false;                    // never overwrite
  const url = module.fileRef || module.meta?.url || "";
  return /^https?:\/\//i.test(url);                        // a blank browser has none
}

export async function up({ gridId, models, log, dryRun }) {
  const { Module } = models;
  const mods = await Module.find({ gridId, role: "artifact", kind: "bookmark" }).lean();
  const targets = mods.filter(needsCover);
  const blank = mods.filter((m) => !m.meta?.cover && !needsCover(m));
  log(`bookmarks: ${mods.length} · with a cover: ${mods.filter((m) => m.meta?.cover).length} · ` +
      `to fetch: ${targets.length}${blank.length ? ` · no url, skipped: ${blank.length}` : ""}`);
  if (!targets.length) return { changed: 0 };

  if (dryRun) {
    // Interleaved by host so 4 in flight is 4 SITES, not 4 hits on one.
    for (const m of interleaveByHost(targets, (x) => x.fileRef || x.meta?.url || "")) {
      log(`  · would fetch ${(m.fileRef || m.meta?.url || "").slice(0, 90)}`);
    }
    log("  (dry run — nothing written, nothing fetched)");
    return { changed: 0 };
  }

  const queue = interleaveByHost(targets, (x) => x.fileRef || x.meta?.url || "");
  let attempted = 0, fetchFailed = 0, aborted = false;
  const byVia = { og: 0, icon: 0, "origin-favicon": 0 };
  const found = [];

  async function worker() {
    for (;;) {
      if (aborted) return;
      const m = queue.shift();
      if (!m) return;
      const url = m.fileRef || m.meta?.url || "";
      let res = null;
      try {
        res = await fetchPageHtml(url, { timeoutMs: PER_PAGE_TIMEOUT_MS });
      } catch (e) {
        res = { ok: false, reason: e?.message || "threw" };
      }
      attempted++;
      if (!res?.ok) {
        fetchFailed++;
        log(`  · ${url.slice(0, 70)} — ${res?.reason || "unreachable"}`);
        // NOT a cover miss — a network failure. See the header: counting misses
        // would make this guard unfireable, because a parseable URL always
        // yields an origin favicon.
        if (shouldAbortEarly(attempted, fetchFailed)) {
          aborted = true;
          log(`  REFUSING: ${fetchFailed} of the first ${attempted} fetches failed — that is not ${fetchFailed} dead links, that is no network.`);
        }
        continue;
      }
      const cover = coverFromHtml(res.html, res.url || url);
      if (!cover?.url) { log(`  · ${url.slice(0, 70)} — no cover offered`); continue; }
      byVia[cover.via] = (byVia[cover.via] || 0) + 1;
      found.push({ id: m.id, cover: cover.url, via: cover.via, label: m.label });
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  for (const f of found) log(`  ✓ ${(f.label || "").slice(0, 40)} — ${f.via} — ${f.cover.slice(0, 70)}`);
  if (found.length) {
    await Module.bulkWrite(found.map((f) => ({
      updateOne: { filter: { id: f.id, gridId }, update: { $set: { "meta.cover": f.cover } } },
    })));
  }
  log(`covered ${found.length} of ${targets.length}` +
      ` (og ${byVia.og || 0} · icon ${byVia.icon || 0} · favicon ${byVia["origin-favicon"] || 0})` +
      `${fetchFailed ? ` · unreachable ${fetchFailed}` : ""}${aborted ? " · ABORTED" : ""}`);
  return { changed: found.length };
}
