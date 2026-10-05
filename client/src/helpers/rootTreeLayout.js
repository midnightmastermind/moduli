// helpers/rootTreeLayout.js
//
// WHEN MAY THE ROOT-TREE SIDEBAR PUSH THE PAGE, RATHER THAN OVERLAY IT?
//
// Extracted from ModulePanel because mounting that component needs the whole
// grid store, and this rule is where the bug lived — the same reason
// `autoscrollMath` and `wrapAnchor` are their own files.
//
// THE THRESHOLD IS DERIVED FROM THE SIDEBAR, NOT PICKED. The page keeps at
// least 1.5x what the sidebar takes, so the minimum viewport is 2.5x the
// sidebar's width. Change ROOT_TREE_W and the rule follows instead of quietly
// becoming wrong.
//
// IT DELIBERATELY DOES NOT KEY ON `isMobileLayout`, and that is the whole fix.
// That flag is `(isTouch && (isPortrait || width < 980)) || width <= MOBILE_BREAKPOINT`, so a
// TABLET IN PORTRAIT is "mobile layout" at 800-1180px wide — and the sidebar
// full-screened (`width: 100%`) on a viewport with ample room for it. User,
// 2026-08-26: *"on tablet, make the manifest tree sidebar open in the same way
// as desktop. right now it full screens and makes it look weird."*
//
// "Is this session phone-shaped" and "does a fixed 222px box fit" are two
// different questions, and answering the second with the first is what broke it.
// The TREE's own width lives here too, and the column is derived from it. They
// were two numbers: the tree went 220 -> 280 (2026-10-01) and the column stayed
// 222, so the column clipped the tree's right 58px — its header's New folder /
// New page buttons sat past the panel edge, unclickable (found 2026-10-05).
// The column holds the tree plus its 2px side padding and 1px left border.
export const TREE_WIDTH = 280;
export const ROOT_TREE_W = TREE_WIDTH + 2 * 2 + 1;
// The page keeps at least 1.5x the column, so the minimum viewport is 2.5x it.
// It was 3x a 222px column (666px); at the column's true width that would be
// 855px and iPad portrait (768) — the case this file exists for — would overlay
// again. 2.5x keeps every tablet pushing and every phone overlaying.
export const ROOT_TREE_PUSH_RATIO = 2.5;
export const ROOT_TREE_PUSH_MIN_W = Math.ceil(ROOT_TREE_W * ROOT_TREE_PUSH_RATIO);

// True when a viewport of `width` can give the sidebar its column and still
// leave the page at least twice that much.
export function rootTreeCanPushAt(width) {
  return typeof width === "number" && width >= ROOT_TREE_PUSH_MIN_W;
}
