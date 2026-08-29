/**
 * 0283 — clear it AGAIN, now that the thing re-stamping it is fixed.
 *
 * `0271` cleared this exact occurrence on 2026-08-28. Twenty-four hours later
 * `gridIntegrity` reported it again, on the SAME id:
 *
 *     SOURCE LnLC5V1KIMt_ "Todo"   Date = 2026-08-29   stamped 08:14 CDT
 *     linked group lg-LnLC5V1KIMt_  8 members, 1 distinct Date value
 *     one member's parent           "Wednesday, August 26th, 2026"
 *
 * THAT LAST LINE IS WHY THIS IS A SECOND MIGRATION RATHER THAN A THIRD REPAIR.
 * A copy sitting in the AUG 26 day column carrying AUG 29 cannot come from a
 * per-column stamp. It comes from `update_occurrence`'s copy-link fan-out,
 * which propagated EVERY field of a write to every other member of the group —
 * including the field the grid FILTERS on, which is per-PLACEMENT by definition
 * and is the whole reason two copies sit in two different columns.
 *
 * So `0145` (clear the source) and `0271` (clear the copies too) were both
 * correct and both temporary: they repaired the data, and the next morning's
 * stamp fanned straight back in. The durable half shipped with this migration —
 * `utils/filterFields.js` + the guard in `socketHandlers/occurrences.js` — and
 * only with that in place does clearing hold.
 *
 * A CONTROL RULED OUT THE FIRST SUSPECT. `APPLY_TEMPLATE`'s `defaultFields`
 * became a denylist on 2026-08-05 and now stamps containers, which looked like
 * the cause. It is not: of the "Day" template's **49 children exactly ONE
 * carries a Date** — the Todo, the only one of the 49 in a linked group. A
 * template-wide stamp would have dated all 49.
 *
 * IT DELEGATES TO `0271` RATHER THAN REPEATING IT. That migration already holds
 * the remedy (CLEAR rather than re-stamp — stamping works today and goes stale
 * tomorrow) and the discriminator that makes it safe (a copy is cleared only
 * when its value EQUALS its source's; one that differs was set deliberately and
 * is KEPT and REPORTED). Two copies of that reasoning would drift. A SEPARATE
 * migration rather than an edit to `0271` because `0271` has executed and a
 * ledger entry has to describe what ran — the `0276`→`0274` pattern.
 *
 * AFTER APPLYING: restart pm2 (the warm cache is authoritative for reads) and
 * reload the tab.
 */
import { up as clearInheritedFilterValues } from "./0271-dated-copy-link-copies.mjs";

export const id = "0283-the-fan-out-re-dated-it";
export const describe =
  "Re-clear inherited filter values off copy-link groups, now that the fan-out no longer re-stamps them.";
export const touches = ["occurrences"];

export async function up(ctx) {
  ctx.log("0283 — re-running 0271's repair; the fan-out that undid it is fixed in this same deploy.");
  return clearInheritedFilterValues(ctx);
}
