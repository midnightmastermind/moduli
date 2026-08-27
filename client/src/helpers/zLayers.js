// helpers/zLayers.js
//
// The stacking levels that portalled surfaces share, in ONE place, because the
// bug they exist to prevent is a comparison between two numbers written in two
// files by two different people.
//
// ── WHAT WENT WRONG ────────────────────────────────────────────────────────
//
// The instance settings sheet is a Radix `PopoverContent`, classed `z-[10000]`
// in `components/ui/popover.jsx`. `DrilldownPicker` — the "Add field" control
// INSIDE that sheet — portals its dropdown to `document.body` at `zIndex: 9999`.
// Both are `position: fixed` with an explicit numeric z-index, and the Radix
// popper wrapper carries `z-index: auto` (so it creates NO stacking context and
// the content's 10000 competes in the root one). It is therefore a direct
// comparison, and the picker loses by ONE:
//
//     settings sheet   z 10000
//     the menu it opens z  9999   -> painted behind it, unreachable
//
// User, 2026-08-27: *"add field button to add a field to an occurance is opening
// an unreachable menu behind the instance settings menu"*.
//
// ── THE FIX IS A DERIVATION, NOT A BIGGER NUMBER ───────────────────────────
//
// `PORTAL_MENU = POPOVER + 10` states the rule that was being violated: a menu
// opened FROM a popover sits ABOVE it. Move the popover and the menu follows,
// instead of quietly becoming wrong again — the same trick as
// `LABEL_MIN_ARC_PX = LABEL_FONT_PX * 1.8` and `ROOT_TREE_W * 3`.
//
// ── THE NEIGHBOURS, so a new surface is placed rather than guessed ─────────
//
//   1050          App toolbar row
//   1100-1200     backdrops, drawers, dialogs, the mobile settings sheet WRAPPER
//   10000         POPOVER      — Radix PopoverContent
//   10010         PORTAL_MENU  — a menu portalled open from one of those
//   12000         ImagePickerMenu / AddressPickerMenu — full-screen modal pickers,
//                 deliberately above a menu because they REPLACE the surface
//   2147483647    RadialMenu / containerPopups — the drag handle, above all
//
// Anything portalled at or below POPOVER that can be opened from a popover is
// the bug above, waiting. `__tests__/portalMenuStacking.test.js` fails on one.

/** Radix `PopoverContent`: settings sheets and field dropdowns. */
export const Z_POPOVER = 10000;

/**
 * A menu that PORTALS ITSELF OPEN from inside a popover — the field picker, the
 * action picker, the container-kind selector. Strictly above `Z_POPOVER`, by
 * construction rather than by coincidence.
 */
export const Z_PORTAL_MENU = Z_POPOVER + 10;
