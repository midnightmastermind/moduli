// helpers/feedTokens.js
//
// Built-in date tokens for a FEED condition's value.
//
// A feed condition is `{ fieldId, comparator, value }` and `resolveFeedItems`
// turns it into a rule evaluated by `evalRuleAgainstRecord(rule, record, {})`.
// That `$vars` is EMPTY and always has been, so a `$`-expression on the right
// hand side resolved to nothing — which made "before today" inexpressible on
// any feed. A literal date typed into the config is not an answer: it is
// correct for one day and silently wrong afterwards.
//
// WHY A SEPARATE RESOLVER RATHER THAN THREADING REAL $vars IN: the executor's
// $vars carries the whole grid ($allItems, $allOccurrences, the enriched
// collections). Handing that to a feed would make every feed condition able to
// reach anything, on a path that runs over every occurrence on the grid. This
// is deliberately a closed, tiny vocabulary instead.
//
// FAILS CLOSED BY PASSING THROUGH. An unknown token is returned verbatim, so a
// typo reaches the comparator as an unparseable date and DATE_BEFORE answers
// false. The alternative — resolving an unknown token to null/empty — reads as
// "no filter set" downstream and would match EVERYTHING.

import { dayKey } from "./dueSpan.js";

// The whole vocabulary. Keep it small: every entry here is reachable from any
// feed on the grid.
const TOKENS = {
  // Matches the executor's `$today` exactly — a LOCAL day key, never
  // toISOString (which rolls a day at the UTC boundary).
  $today: (now) => dayKey(now),
};

/**
 * Resolve a feed condition's `value` if it names a built-in token.
 *
 * Anything that is not a `$`-led string is returned unchanged and untouched by
 * identity, which is what makes this additive: measured 2026-08-08, all 71
 * feed conditions across the three live grids are plain strings or a boolean,
 * and none begins with "$".
 *
 * @param {*} value      the condition's stored value
 * @param {Date} [now]   the clock, injectable so the day boundary is testable
 * @returns {*}          the resolved value, or `value` unchanged
 */
export function resolveFeedConditionValue(value, now = new Date()) {
  if (typeof value !== "string") return value;
  const s = value.trim();
  if (s.charCodeAt(0) !== 36 /* "$" */) return value;
  const resolve = Object.prototype.hasOwnProperty.call(TOKENS, s) ? TOKENS[s] : null;
  return resolve ? resolve(now) : value;
}
