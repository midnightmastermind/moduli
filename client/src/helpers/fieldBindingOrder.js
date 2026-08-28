// helpers/fieldBindingOrder.js
// ============================================================
// WHERE A FIELD SITS ON AN OCCURRENCE — the one rule, and the one way to move it.
//
// `resolveOccurrenceFields` has always ended with
//     .sort((a, b) => (a.binding.order || 0) - (b.binding.order || 0))
// so a binding's `order` IS its render position. What had no authoring surface
// was changing it: the Fields editor could bind, hide and unbind, and the only
// way to reorder was a migration (`0117` inserted `Set 4` "AFTER Set 3 because
// binding order is render order" — by hand, in a migration, for that reason).
//
// ── THE EDITOR WAS LISTING THEM IN THE WRONG ORDER, and that had to be fixed
//    FIRST or arrows would be unusable ──────────────────────────────────────
//
// The editor rendered `module.fieldBindings` in ARRAY order while the occurrence
// renders them in `order` order. Measured on poms grid, 2026-08-28:
//
//     modules with 2+ bindings                              2136
//       where the editor's list order != the render order    104   (4.9%)
//          e.g. Pay Bill · Sleep · Chicken Breast · Eggs
//
// One module in twenty listed its fields in an order that did not match the
// screen. Nobody reported it, because a list with no positional control reads as
// unordered — you only notice once there is an arrow next to it and pressing it
// moves the wrong row. *An affordance can turn a harmless inconsistency into a
// bug; check what the list means before putting a control on it.*
//
// ── ONE COMPARATOR, USED BY BOTH ───────────────────────────────────────────
//
// `bindingOrderOf` is exported and `resolveOccurrenceFields` now calls it, so
// the editor's list and the rendered row cannot drift into disagreeing again —
// a test pins that they sort identically. Two copies of a sort rule is the drift
// this repo keeps paying for.
//
// ── MOVING RENUMBERS THE WHOLE MODULE, deliberately ────────────────────────
//
// Swapping two `order` values is the obvious implementation and it is wrong on
// this grid's real data:
//
//     bindings carrying a numeric order   11313 / 11591  (97.6%)
//     modules with DUPLICATE order values   287   <- ties, broken by array order
//     fully ordered but NOT 0..n-1          464   <- gaps (Field.jsx writes order: 99)
//     modules with NO order at all           80   <- pure array order
//     modules MIXED (some order, some not)   41   <- the missing ones sort to 0
//
// Against ties, gaps and absent values, a swap moves a row by an unpredictable
// distance or not at all. Renumbering the module 0..n-1 from its CURRENT
// EFFECTIVE order makes every press move exactly one position, and converges the
// module onto the shape `handlePick` already writes (`order: bindings.length`).
//
// It renumbers from 0 because that is that same house convention. Measured
// before choosing: only **4** modules on the grid have a lowest order above 0,
// so this cannot silently reshuffle a module relative to the auto-applied
// cascade fields (which carry no order and therefore sort at 0).
//
// THE ARRAY IS REORDERED TOO, not just the numbers. `order` decides the render,
// but ties fall back to array position, and leaving the two disagreeing is what
// produced the 104 mismatched modules above.
// ============================================================

/**
 * A binding's sort key. The `|| 0` is load-bearing and pre-existing: a binding
 * with no `order` — an auto-applied cascade field, or one of the 80 modules that
 * never had one — sorts to the front rather than the back.
 */
export function bindingOrderOf(binding) {
  return binding?.order || 0;
}

/** The comparator `resolveOccurrenceFields` sorts by. Exported so it is shared, not copied. */
export function compareBindingOrder(a, b) {
  return bindingOrderOf(a) - bindingOrderOf(b);
}

/**
 * The bindings in the order the occurrence actually renders them.
 *
 * `Array.prototype.sort` is stable, so equal `order` values keep array order —
 * which is exactly how the renderer breaks its own ties, and why this must sort
 * a COPY rather than the caller's array.
 */
export function sortBindingsForDisplay(bindings) {
  if (!Array.isArray(bindings)) return [];
  return [...bindings].sort(compareBindingOrder);
}

/**
 * Move one binding by `delta` positions and renumber the module.
 *
 * PURE. Returns a NEW array in display order with every binding's `order` set to
 * its index, or `null` when the move is a no-op (unknown field, already at the
 * end it is being pushed against, fewer than two bindings). Returning null
 * rather than an unchanged copy is what lets the caller skip the socket write —
 * a press on a disabled edge must not mint a transaction.
 *
 * @param {Array}  bindings  module.fieldBindings, in any order
 * @param {string} fieldId   the binding to move
 * @param {number} delta     -1 for up, +1 for down
 */
export function moveBinding(bindings, fieldId, delta) {
  const list = sortBindingsForDisplay(bindings);
  if (list.length < 2 || !fieldId || !delta) return null;

  const from = list.findIndex((b) => b?.fieldId === fieldId);
  if (from === -1) return null;

  const to = from + delta;
  if (to < 0 || to >= list.length) return null;   // already at the edge

  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);

  // Renumber every binding, not just the two that swapped — see the header.
  return next.map((b, i) => ({ ...b, order: i }));
}
