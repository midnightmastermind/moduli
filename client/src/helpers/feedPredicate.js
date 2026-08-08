// helpers/feedPredicate.js
//
// A feed's conditions, as the PREDICATE TREE `evalGroupAgainstRecord` already
// understands.
//
// User 2026-08-07: "if i finish a todo, it gets put in a completed container …
// include appointments there too after the date passes for it." One container,
// two unrelated reasons to be in it:
//
//   Completed IS true   OR   (Date DATE_BEFORE $today  AND  Time Slot IS_NOT_EMPTY)
//
// `resolveFeedItems` ANDed a flat list, so that could not be said. The
// evaluator was never the gap — `evalGroupAgainstRecord` has handled AND/OR and
// nesting since 2026-05-03 and detects a sub-group by `Array.isArray(entry.rules)`.
// What was missing is a feed shape that can express one, and this builds it.
//
// ── THE STORED SHAPE ────────────────────────────────────────────────────────
//
//   feed.conditionOperator : "AND" | "OR"   (ABSENT MEANS AND)
//   feed.conditions        : Entry[]
//
//   Entry = { id, fieldId, comparator, value }              // a leaf
//         | { id, operator, conditions: Entry[] }           // a nested group
//
// A group is recognised by carrying `conditions`, so a leaf can never be
// mistaken for one. The output uses `rules` for its children because that is
// the key the evaluator looks for.
//
// ── BACK-COMPAT IS THE ENTIRE RISK ──────────────────────────────────────────
//
// 77 enabled feeds across the three grids carry flat AND lists and 208 rows
// between them. A feed that quietly changes what it matches is wrong in a way
// nobody sees — no error, just different rows. So an absent `conditionOperator`
// means AND, an unknown one is normalised to AND rather than guessed at, and
// every drop rule below reproduces what the old inline loop already did.
//
// ── WHAT GETS DROPPED, AND WHY EACH ONE MATTERS ─────────────────────────────
//
// * A leaf with no `fieldId` — FeedSection's "+ condition" mints exactly that,
//   so a half-configured row must stay inert. The old loop did `continue`.
// * A group that ends up with no usable children — an empty AND evaluates TRUE,
//   so leaving one inside an OR would make the whole feed match EVERYTHING.
// * Anything past the depth cap. That is a backstop against a hand-edited or
//   cyclic structure, not a path the editor can reach; it degrades to
//   "unconfigured", which is the same reading the resolver has always given a
//   condition it cannot use.
//
// Returning `null` means "no usable predicate" — the caller matches everything,
// which is what the old loop did when every condition was skipped.

import { resolveFeedConditionValue } from "./feedTokens.js";

// 1 = the top-level list. Three nested groups is far past anything the editor
// offers and still bounded for the sync path.
const MAX_DEPTH = 4;

const isGroup = (entry) => Array.isArray(entry?.conditions);
const normaliseOperator = (op) => (String(op).toUpperCase() === "OR" ? "OR" : "AND");

function buildNode(entry, now, depth) {
  if (isGroup(entry)) {
    if (depth >= MAX_DEPTH) return null;
    const rules = [];
    for (const child of entry.conditions) {
      const node = buildNode(child, now, depth + 1);
      if (node) rules.push(node);
    }
    if (!rules.length) return null;
    return { operator: normaliseOperator(entry.operator), rules };
  }
  if (!entry?.fieldId) return null;
  return {
    left: `fields.${entry.fieldId}.value`,
    comparator: entry.comparator || "IS",
    right: resolveFeedConditionValue(entry.value, now),
  };
}

/**
 * Build the group `evalGroupAgainstRecord` evaluates, or null when the feed has
 * nothing usable to say.
 *
 * `now` is injectable and resolved ONCE for the whole tree: a sync straddling
 * midnight must not evaluate two rows against two different "todays".
 */
export function buildFeedPredicate(feed, { now = new Date() } = {}) {
  const conditions = Array.isArray(feed?.conditions) ? feed.conditions : [];
  if (!conditions.length) return null;
  const rules = [];
  for (const entry of conditions) {
    const node = buildNode(entry, now, 1);
    if (node) rules.push(node);
  }
  if (!rules.length) return null;
  return { operator: normaliseOperator(feed?.conditionOperator), rules };
}
