/**
 * 0282 — six kanban columns each printing the same inherited date.
 *
 * `0279` laid the columns out at 260px. Looking at the result, every column
 * header read "Backburn", "Working I", "In Revie" — the label truncated by a
 * filter pill showing `Fri, Aug 28`, six times over. That date is set on the
 * PAGE and merely inherited, so it is one fact printed six times, in the six
 * places with the least room for it.
 *
 * `hideFilterPill` suppresses the VALUE and keeps the funnel icon, which matters:
 * the icon is the only route into a container's own menu, so hiding it would
 * make every column unconfigurable. It is a VIEW key rather than a shape key —
 * a statement about descendants — so setting it once on the kanban board reaches
 * all six columns, the way `dragInView` and `locked` already do.
 *
 * ── IT DELEGATES TO `0279` RATHER THAN REPEATING IT ────────────────────────
 * The key is added to `PROJECT_KANBAN_LAYOUT`, the constant the seed and `0279`
 * both read, so there is exactly one definition of what a project kanban looks
 * like. This migration just re-runs `0279`'s planner, whose `needsLayout` check
 * compares every key and therefore notices the new one.
 *
 * A SEPARATE MIGRATION rather than an edit to `0279`, because `0279` has already
 * executed on the live grid and a ledger entry has to describe what actually
 * ran — the 2026-08-07 (4) rule, applied the same way `0276` delegates to
 * `0274`.
 */

import { up as applyKanbanLayout } from "./0279-a-kanban-that-stacked-its-columns.mjs";

export const id = "0282-six-columns-printing-one-date";
export const describe =
  "Hide the inherited date pill in kanban column headers (hideFilterPill), which was truncating every column label " +
  "at 260px. Delegates to 0279 so the kanban's layout has one definition.";
export const touches = ["occurrences"];

export async function up(ctx) {
  ctx.log("  re-applying PROJECT_KANBAN_LAYOUT — it has gained `hideFilterPill`");
  await applyKanbanLayout(ctx);
}
