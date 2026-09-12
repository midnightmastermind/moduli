// helpers/readerPlan.js
//
// READER MODE RENDERS REAL OCCURRENCES (user, 2026-09-12: *"the reader mode
// should be turning the things into textblocks and containers like the
// wikipedia import"*).
//
// Before this, the reader printed `reader.markdown` into a `pre-wrap` div.
// Measured on the article the user was looking at, through the real extractor:
//
//     reader body          11,077 chars / 1,617 words
//     URL targets printed   9 links = 1,255 chars = 11.3% of the body
//     longest single URL    196 chars
//     bold **x**           13 runs  -> asterisks on screen
//     italic *x* / _x_      7 runs  -> asterisks/underscores
//     escaped  \[ \]        6       -> backslashes
//
// An eighth of what you were reading was archive.org URLs. The fix is NOT a
// markdown-to-React renderer: this repo's standing rule is *never re-render
// occurrence content as a static copy — use the real occurrences*, and a
// bespoke renderer is precisely that hack. `markdownToModuli` already turns
// this exact markdown into containers, textblocks, quote artifacts and tables,
// and the app already has renderers for all four.
//
// ── WHY THE TREE IS PLANNED AND NOT MINTED ────────────────────────────────
//
// Measured with the real planner (`dryRun: true`) over three real pages:
//
//     WaPo article    1,619 words  ->   11 occurrences
//     danbrown.com      814 words  ->   84 occurrences
//     Wikipedia      11,678 words  ->  803 occurrences   (712 inline links)
//                                 avg  299 per page read
//     the live grid today               21,415 occurrences
//
// Reading ~26 Wikipedia-sized pages would double the grid, and the spread page
// these would otherwise hang off is permanent by design ("parented to NOTHING
// and listed in no manifest, so ... there is nothing to clean up on close").
// There is no teardown to lean on, so reading stays READ-ONLY and `import_url`
// remains the deliberate "keep this page" action it already was.
//
// ── WHY AN ISOLATED STATE AND NOT THE GRID STORE ──────────────────────────
//
// Folding planned rows into the real store would put occurrences in the client
// that Mongo has never heard of — the phantom class that cost a whole session
// on 2026-08-04, where a cached row taught `update_occurrence`'s guard that a
// dangling child id was real and it persisted a parent listing a child that did
// not exist. These rows are handed to `PagePreviewBody` as its own
// `parentState` instead: the same seam preview cards already render through,
// with `dispatch` and `socket` nulled, so there is no path from here to a write
// at all. It is structural, not a promise to be careful.

/**
 * An isolated grid state carrying nothing but a planned reader tree.
 *
 * @param {{ rootOccurrenceId?: string, modules?: any[], occurrences?: any[] }} plan
 *   an `import_plan` reply
 * @returns {null | { state: object, rootOccurrenceId: string }}
 *   `null` when the plan is unusable — a caller that renders nothing is
 *   correct, and is what a page with no readable structure should produce.
 *
 * PURE, and exported for the same reason `planSpreadBrowser` is: mounting the
 * view needs the whole grid store, so the decision has to be testable without
 * one.
 */
export function readerStateFromPlan(plan) {
  const root = plan?.rootOccurrenceId;
  const occurrences = Array.isArray(plan?.occurrences) ? plan.occurrences : [];
  const modules = Array.isArray(plan?.modules) ? plan.modules : [];
  if (!root || !occurrences.length || !modules.length) return null;

  // The root must actually be IN the plan. A plan naming a root it does not
  // carry renders an empty box that looks exactly like a page with no text,
  // and the two want different messages.
  if (!occurrences.some((o) => o && o.id === root)) return null;

  return {
    rootOccurrenceId: root,
    state: {
      occurrences,
      modules,
      // The importer binds no fields and mints no views or folders. Every one
      // of these already defaults to `[]` inside `PagePreviewBody` (checked —
      // they are all `parentState?.x || []`), so they are stated rather than
      // omitted only to make the shape of an isolated state obvious at a
      // glance. Nothing depends on their presence.
      fields: [],
      views: [],
      folders: [],
      hydrated: true,
      // DELIBERATELY ABSENT: `computedValues`. The store behind it is a
      // module-level singleton shared with the live app, so a reader that
      // published its own empty map would blank every display field on the
      // grid. The caller passes `publishComputed={false}` instead and this
      // state never goes near it — see PagePreviewApp's publish block.
    },
  };
}
