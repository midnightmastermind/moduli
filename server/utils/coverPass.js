// utils/coverPass.js
//
// Planning the cover pass. Pure — the fetching lives in the migration.
//
// The pass has two halves and only the second touches the network:
//
//   1,030 rows  already carry a cover URL from the Raindrop export, and have
//               been drawing a generic 📄 ever since because nothing rendered
//               it. Free to fix — no request at all.
//     437 rows  carry none, and need their page fetched for its og:image.
//
// ── WHY THE ORDER OF THE FETCH LIST MATTERS ────────────────────────────────
//
// 437 bookmarks are not 437 different sites — this export has runs of Wikipedia
// and Reddit links sitting next to each other, because that is the order they
// were saved in. Handing that list to a worker pool puts several requests
// against ONE host in flight at once, which is the one thing a polite crawler
// must not do, while leaving the pool idle on hosts further down.
//
// Interleaving by host fixes both at once: round-robin across hosts means the
// pool is nearly always working on distinct sites, without needing a lock.

/** The host of a URL, or "" when it does not parse. Grouping key only. */
export function hostOf(url) {
  try { return new URL(String(url || "")).host.toLowerCase(); } catch { return ""; }
}

/**
 * Round-robin a list across its hosts.
 *
 * [a1 a2 a3 b1 c1] -> [a1 b1 c1 a2 a3]
 *
 * STABLE within a host and across hosts (first-seen order), so a re-run walks
 * the same sequence and a resumed pass is reading the same list it was.
 */
export function interleaveByHost(rows, urlOf = (r) => r.url) {
  const buckets = new Map();
  for (const r of rows || []) {
    const h = hostOf(urlOf(r));
    if (!buckets.has(h)) buckets.set(h, []);
    buckets.get(h).push(r);
  }
  const queues = [...buckets.values()];
  const out = [];
  for (let i = 0; out.length < (rows?.length || 0); i++) {
    let moved = false;
    for (const q of queues) {
      if (i < q.length) { out.push(q[i]); moved = true; }
    }
    if (!moved) break;   // cannot happen with a consistent input; not a hang if it does
  }
  return out;
}

/**
 * Split rows into "already covered" and "needs a fetch".
 *
 * RESUMABILITY IS THIS FUNCTION. A row is only fetched when it has no cover
 * VALUE, so a run that dies at 300 leaves 137 to do and a re-run does exactly
 * those — it can never double-fetch what it already has, and it can never
 * overwrite a cover a person set by hand.
 */
export function planCoverPass(rows, { coverOf, urlOf }) {
  const covered = [], needsFetch = [], unfetchable = [];
  for (const r of rows || []) {
    const cover = String(coverOf(r) || "").trim();
    if (cover) { covered.push({ row: r, cover }); continue; }
    const url = String(urlOf(r) || "").trim();
    // No URL means there is nothing to fetch and nothing to guess from. Counted
    // rather than silently skipped, so the totals always add up to the input.
    if (!url) { unfetchable.push(r); continue; }
    needsFetch.push({ row: r, url });
  }
  return { covered, needsFetch: interleaveByHost(needsFetch, (e) => e.url), unfetchable };
}

/**
 * Has the pass failed for a reason that is about US rather than about the sites?
 *
 * A dead bookmark is NORMAL here — this is a five-year-old export and some
 * links are gone. So a per-site failure must not stop the run. But EVERY one of
 * the first N failing is not a set of coincidences, it is no network, and
 * burning the remaining 400-odd requests to discover that is the waste this
 * check exists to prevent.
 */
export function shouldAbortEarly(attempted, failed, probe = 20) {
  return attempted >= probe && failed === attempted;
}
