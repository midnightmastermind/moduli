// helpers/convertRelink.js
//
// After "Convert to page", every OTHER chip pointing at the same URL becomes an
// in-app jump. Task 6's remaining win, and the shape the user confirmed on
// 2026-08-07 in preference to the migration.
//
// ── WHY THIS INSTEAD OF THE MIGRATION ───────────────────────────────────────
//
// Step 2 measured the migration against poms grid and the answer was DO NOT RUN
// IT. With the correct selector it would relink exactly ONE chip, and that one
// is `"Eminem" -> Eminem`: a link inside the Eminem page repointed at the Eminem
// page, i.e. a jump to the top of what you are already reading. The looser
// selector found 10 and ALL TEN WERE FALSE POSITIVES — "Shady Records" and
// "Shade 45" are section HEADINGS at depth 2 inside the Eminem article, so
// relinking them would send a reader who clicked "Shady Records" to a heading
// instead of out to the real thing.
//
// Root cause: title matching is a guess. It has to decide whether a chip labelled
// X and a container labelled X are the same subject, and on real data that guess
// is wrong far more often than it is right.
//
// **At convert time there is nothing to guess.** The chip being converted and
// the page just minted are both in hand, so the match is URL EQUALITY against a
// URL the user personally acted on. The entire false-positive class measured
// above cannot occur here.
//
// ── THE ONE REFUSAL THAT STILL MATTERS: THE SELF-LOOP ───────────────────────
//
// An imported article usually links to ITSELF somewhere (an infobox row, a "see
// also"). Those chips are INSIDE the page that was just created, and repointing
// them makes a link that goes nowhere the reader can perceive — the exact
// `Eminem -> Eminem` case above. So chips inside the new page's own subtree are
// skipped. Everything else on the grid is fair game: a chip on some other page
// pointing at this URL is precisely what should now jump inward.
//
// Pure: no React, no store, no writes. Returns the writes to make.

/**
 * Compare two URLs as "the same page".
 *
 * A fragment is a position WITHIN a page, not a different page, so
 * `…/wiki/Eminem#Career` and `…/wiki/Eminem` are the same target. Trailing
 * slashes and host case are noise too. A QUERY is deliberately kept: `?page=2`
 * can be a genuinely different document, and treating it as noise would send a
 * reader somewhere they did not ask to go — the failure Step 1 refuses by design.
 */
export function sameLinkTarget(a, b) {
  const norm = (u) => {
    if (typeof u !== "string" || !u.trim()) return null;
    try {
      const parsed = new URL(u.trim());
      const path = parsed.pathname.replace(/\/+$/, "");
      return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
    } catch {
      return u.trim().replace(/#.*$/, "").replace(/\/+$/, "");
    }
  };
  const na = norm(a);
  const nb = norm(b);
  return !!na && !!nb && na === nb;
}

/** Every occurrence id in the subtree rooted at `rootId`, the root included. */
function subtreeIds(rootId, occurrencesById) {
  const out = new Set();
  if (!rootId) return out;
  const stack = [rootId];
  // A corrupt parent chain must not spin the walk forever — the same paranoia
  // guard filesFolder's folder walk carries.
  let guard = 0;
  while (stack.length && guard++ < 20000) {
    const id = stack.pop();
    if (!id || out.has(id)) continue;
    out.add(id);
    const occ = occurrencesById?.[id];
    for (const cid of (occ?.occurrences || [])) stack.push(cid);
  }
  // Anything claiming the root as an ancestor by parentId, which an importer
  // sets on structural children that the parent does not list.
  for (const occ of Object.values(occurrencesById || {})) {
    if (occ?.parentId && out.has(occ.parentId)) out.add(occ.id);
  }
  return out;
}

/** The external URL a chip points at, or null. Mirrors TextblockCard's precedence. */
function externalUrlOf(occ, module) {
  const link = occ?.meta?.link || module?.meta?.link || null;
  if (!link) return null;
  if (link.kind && link.kind !== "url") return null; // already an in-app jump
  return typeof link.url === "string" && link.url.trim() ? link.url.trim() : null;
}

/**
 * Plan the relink after a convert.
 *
 * @returns Array<{ occurrenceId, meta }> — `meta` is the MERGED object to write,
 *          never a replacement: a chip carries more than its link.
 */
export function planConvertRelink({ url, rootOccurrenceId, occurrencesById, modulesById }) {
  if (!url || !rootOccurrenceId || !occurrencesById) return [];
  const inNewPage = subtreeIds(rootOccurrenceId, occurrencesById);

  const writes = [];
  for (const occ of Object.values(occurrencesById)) {
    if (!occ?.id || inNewPage.has(occ.id)) continue; // the self-loop refusal
    const module = modulesById?.[occ.moduleId];
    const chipUrl = externalUrlOf(occ, module);
    if (!chipUrl || !sameLinkTarget(chipUrl, url)) continue;

    writes.push({
      occurrenceId: occ.id,
      meta: {
        ...(occ.meta || {}),
        link: { kind: "occurrence", occId: rootOccurrenceId, url: chipUrl },
      },
    });
  }
  return writes;
}
