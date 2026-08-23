/**
 * 0201 — every bookmark gets a picture, and none of them gets an artifact.
 *
 * USER, 2026-08-23: *"make all of those image searches. use the urls as the
 * image search, we dont need an artifact for each cover"* — then, asked which
 * mechanism, chose **each page's own og:image**, with the **site favicon** when
 * a page declares nothing.
 *
 * ── THE MEASUREMENT CHANGED THE PLAN, AND IT CHANGED IT TWICE ───────────────
 *
 * The spec said `Cover` = "`cover` from the export, else an image search by
 * title". Both halves turned out to be wrong on the live data.
 *
 * FIRST: the 1,030 rows that ALREADY have a cover were rendering nothing.
 * `0199` stored the export's image URL in a text field and said so in as many
 * words — *"it is NOT rendered as a picture yet"* — and nothing has rendered it
 * since. So two thirds of this pass needs no network at all; it is a display
 * fix that has been sitting in the data for a day.
 *
 * SECOND: an image search by TITLE cannot be done here. The 437 coverless rows
 * do have titles, but they are these:
 *
 *     "Microsoft Word - 2007-109.doc - 2007-109.pdf"
 *     "Pausanias, Description of Greece, a target="_blank" onclick=..."   <- raw HTML
 *     "diape search results - PornZog Free Porn Clips"
 *
 * Searching images for the third would put pornography on the user's board.
 * And the 1,030 covers the export DID supply are og:images
 * (`upload.wikimedia.org/…`, `imgv2-1-f.scribdassets.com/…`), so taking each
 * page's own og:image is also the only route that makes all 1,467 one kind of
 * thing rather than two.
 *
 * ── WHERE THE COVER LIVES, AND WHY IT IS NOT `primaryMediaOf` ───────────────
 *
 * `module.meta.cover` — a plain remote URL, read by `ArtifactCard` exactly the
 * way it already reads `meta.thumb256`. No artifact occurrence per cover, which
 * is the user's own instruction and also 1,467 modules and occurrences not
 * created.
 *
 * It deliberately does NOT go through `helpers/occurrenceMedia.primaryMediaOf`.
 * That resolver refuses a bare string ON PURPOSE, so an unmigrated media value
 * cannot render and hide the fact that it was never migrated (2026-08-08 (5)).
 * Teaching it to accept a URL would reopen exactly that hole for every grid.
 * A cover is a different question, so it gets its own answer.
 *
 * ── THE `Cover` FIELD STAYS AUTHORITATIVE, and `meta.cover` is derived ──────
 *
 * The field is what a person can read, edit and filter on; `meta.cover` is what
 * the renderer reads. The field WINS on every run — so editing the field and
 * re-running this migration republishes it, and the two cannot drift in the
 * direction that matters. Stated rather than hidden: until a re-run, an edit to
 * the field is not on screen.
 *
 * ── IT IS RESUMABLE, WHICH IS THE WHOLE SAFETY OF 437 OUTBOUND REQUESTS ─────
 *
 * A row is fetched only when it has NO cover value, so a run that dies at 300
 * leaves 137 and a re-run does exactly those — it can never double-fetch, and
 * it can never overwrite a cover a person set by hand.
 *
 * A per-site failure is NORMAL: this is a years-old export and some links are
 * dead. So one failure never stops the run. But every one of the first 20
 * failing is not twenty coincidences, it is no network — and the run REFUSES
 * there rather than spending the remaining 400 requests finding out.
 */
import { fetchPageHtml } from "../utils/safeFetchUrl.js";
import { coverFromHtml } from "../utils/pageCover.js";
import { planCoverPass, shouldAbortEarly } from "../utils/coverPass.js";

export const id = "0201-covers-for-the-bookmarks";
export const describe =
  "Give every bookmark a picture: publish the 1,030 covers the export already supplied, and fetch each remaining page's own og:image (favicon fallback). Plain URLs on the module — no artifact per cover.";

/** Politeness + pace. The list is interleaved by host, so 4 in flight is 4 sites. */
const CONCURRENCY = 4;
const PER_PAGE_TIMEOUT_MS = 12000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The module patch, or null when the module already says this. */
export function coverPatch(module, url) {
  if (!module || !url) return null;
  return module?.meta?.cover === url ? null : { "meta.cover": url };
}

export async function up({ gridId, models, log, dryRun }) {
  const { Occurrence, Module, Field } = models;
  const fields = await Field.find({ gridId }).lean();
  const coverField = fields.find((f) => f.name === "Cover");
  const urlField = fields.find((f) => f.name === "URL");
  if (!coverField || !urlField) { log("  REFUSING: this grid has no `Cover` / `URL` field"); return; }

  const rows = await Occurrence.find({ gridId, "meta.raindropId": { $regex: "^b:" } }).lean();
  if (!rows.length) { log("  nothing to do — no imported bookmark rows"); return; }
  const mods = new Map((await Module.find({ gridId, id: { $in: rows.map((r) => r.moduleId) } }).lean())
    .map((m) => [m.id, m]));

  const plan = planCoverPass(rows, {
    coverOf: (r) => r.fields?.[coverField.id]?.value,
    urlOf: (r) => r.fields?.[urlField.id]?.value,
  });
  log(`  ${rows.length} bookmark(s): ${plan.covered.length} already have a cover URL, ` +
      `${plan.needsFetch.length} need a page fetch, ${plan.unfetchable.length} have no URL`);

  // ── PHASE 1 — publish what is already known. No network. ──────────────────
  const publish = [];
  for (const { row, cover } of plan.covered) {
    const patch = coverPatch(mods.get(row.moduleId), cover);
    if (patch) publish.push({ id: row.moduleId, patch });
  }
  log(`  phase 1: ${publish.length} existing cover(s) to publish to the module ` +
      `(${plan.covered.length - publish.length} already published)`);

  if (dryRun) {
    const sample = plan.needsFetch.slice(0, 5).map((e) => e.url);
    log(`  phase 2 would fetch ${plan.needsFetch.length} page(s), ${CONCURRENCY} at a time, interleaved by host`);
    sample.forEach((u) => log(`     e.g. ${u.slice(0, 90)}`));
    log("  (dry run — nothing written, nothing fetched)");
    return;
  }

  for (let i = 0; i < publish.length; i += 500) {
    await Module.bulkWrite(publish.slice(i, i + 500).map((e) => ({
      updateOne: { filter: { id: e.id, gridId }, update: { $set: e.patch } },
    })));
  }
  log(`  phase 1 done — ${publish.length} module(s) now carry meta.cover`);

  // ── PHASE 2 — fetch the rest. ─────────────────────────────────────────────
  if (!plan.needsFetch.length) { log("  phase 2: nothing to fetch"); return; }

  const queue = [...plan.needsFetch];
  // THE ABORT KEYS ON FETCH FAILURES, NOT ON COVER MISSES, and that distinction
  // is the whole point of the check. With a favicon fallback a "miss" is nearly
  // impossible — every URL that parses yields an origin favicon — so counting
  // misses would make the guard unfireable, and a total network outage would
  // quietly stamp 437 rows with a `/favicon.ico` nobody could load.
  let attempted = 0, fetchFailed = 0, uncovered = 0, aborted = false;
  const byVia = { og: 0, icon: 0, "origin-favicon": 0 };
  const found = [];   // { row, url, cover, via }

  async function worker() {
    for (;;) {
      if (aborted) return;
      const entry = queue.shift();
      if (!entry) return;
      let res = null;
      try {
        res = await fetchPageHtml(entry.url, { timeoutMs: PER_PAGE_TIMEOUT_MS });
      } catch (e) {
        res = { ok: false, reason: e?.message || "threw" };
      }
      attempted++;
      if (!res?.ok) fetchFailed++;
      // A page we could not read still has an ORIGIN, and the user chose the
      // favicon over a blank card knowing the dead case. It is a better guess
      // than it sounds: a large share of these failures are LOGIN WALLS, where
      // the site is perfectly alive and its favicon certainly exists.
      const hit = res?.ok
        ? coverFromHtml(res.html, res.url || entry.url)
        : coverFromHtml("", entry.url);
      if (hit?.url) { found.push({ ...entry, cover: hit.url, via: hit.via }); byVia[hit.via]++; }
      else uncovered++;
      if (shouldAbortEarly(attempted, fetchFailed)) {
        aborted = true;
        log(`  REFUSING to continue: the first ${attempted} fetches ALL failed. ` +
            `That is not ${attempted} dead links, it is no network. Nothing further was requested; ` +
            `re-run to resume — the rows already covered are kept.`);
        return;
      }
      if (attempted % 50 === 0) log(`     …${attempted}/${plan.needsFetch.length} fetched, ${found.length} covered`);
      await sleep(120);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Write BOTH: the field (the record a person reads and filters on) and the
  // module meta (what the card draws).
  const occEdits = found.map((e) => ({
    updateOne: {
      filter: { id: e.row.id, gridId },
      update: { $set: { [`fields.${coverField.id}`]: { value: e.cover, flow: "in" } } },
    },
  }));
  // `coverVia` rides along so a later pass can find the rows that only got a
  // guessed favicon and try them again, without re-fetching the 300 that got a
  // real og:image.
  const modEdits = found.map((e) => ({
    updateOne: {
      filter: { id: e.row.moduleId, gridId },
      update: { $set: { "meta.cover": e.cover, "meta.coverVia": e.via } },
    },
  }));
  for (let i = 0; i < occEdits.length; i += 500) await Occurrence.bulkWrite(occEdits.slice(i, i + 500));
  for (let i = 0; i < modEdits.length; i += 500) await Module.bulkWrite(modEdits.slice(i, i + 500));

  log(`  phase 2 done — ${found.length} of ${attempted} attempted got a cover ` +
      `(${byVia.og} a real og:image, ${byVia.icon} a declared icon, ${byVia["origin-favicon"]} a guessed /favicon.ico); ` +
      `${uncovered} could not be covered at all; ${fetchFailed} page(s) could not be read`);
  if (queue.length) log(`  ${queue.length} left unattempted — re-run to finish them`);
}
