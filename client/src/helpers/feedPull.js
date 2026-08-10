// helpers/feedPull.js
// ============================================================
// Some feeds OWN their matches; some only READ them.
//
// User, 2026-08-10: *"the graphs are supposed to hold a representation of the
// occurance, not the occurances themselves. its pulling data in for the graph"*
// … *"make it use a feed and pull in the data"* … *"it should work like our
// dropdowns in a way (like movies, etc). it would be like a mood dropdown, so
// pulling in the data"*.
//
// That last line is the whole model. An occurrence DROPDOWN resolves its options
// from a query every time it renders and materialises NOTHING — the field stores
// the picked occurrence's id, not a copy of it. A graph is the same shape: it
// draws a REPRESENTATION of each matching occurrence, and clicking one records
// the id. It never needed to own them.
//
// The default is unchanged: a feed on a board or a page still materialises its
// matches as copy-linked children, because those surfaces render CHILDREN and
// the copies are what you see and drag. Only a PULL-ONLY feed skips that.
//
// WHY IT MATTERED, measured on the live grid before this existed: the Day Page
// template's Emotions Wheel had 128 materialised copies, and APPLY_TEMPLATE
// cloned all of them into a day column — 136 occurrences and 136 modules for one
// day. Pulling instead of owning removes the rows the duplication was made of.

/**
 * Does this feed only READ its matches?
 *
 * Two ways to be pull-only, and the first is why no migration is needed:
 *   • the owner renders as a GRAPH (`meta.graph`) — a chart draws a
 *     representation of each row, so owning a copy buys nothing. Structural,
 *     like knowing a doc renders a textmap; not domain knowledge.
 *   • `feed.materialize === false` — the explicit, surface-agnostic opt-in, for
 *     anything else that wants to read a query without owning it.
 */
export function isPullOnlyFeed(occurrence) {
  if (!occurrence) return false;
  if (occurrence.meta?.graph) return true;
  return occurrence.feed?.materialize === false;
}
