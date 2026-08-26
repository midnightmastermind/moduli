// helpers/rootTreeLayout.js
//
// WHEN MAY THE ROOT-TREE SIDEBAR PUSH THE PAGE, RATHER THAN OVERLAY IT?
//
// Extracted from ModulePanel because mounting that component needs the whole
// grid store, and this rule is where the bug lived — the same reason
// `autoscrollMath` and `wrapAnchor` are their own files.
//
// THE THRESHOLD IS DERIVED FROM THE SIDEBAR, NOT PICKED. The page keeps at
// least TWICE what the sidebar takes, so the minimum viewport is 3x the
// sidebar's width. Change ROOT_TREE_W and the rule follows instead of quietly
// becoming wrong.
//
// IT DELIBERATELY DOES NOT KEY ON `isMobileLayout`, and that is the whole fix.
// That flag is `(isTouch && (isPortrait || width < 980)) || width <= 600`, so a
// TABLET IN PORTRAIT is "mobile layout" at 800-1180px wide — and the sidebar
// full-screened (`width: 100%`) on a viewport with ample room for it. User,
// 2026-08-26: *"on tablet, make the manifest tree sidebar open in the same way
// as desktop. right now it full screens and makes it look weird."*
//
// "Is this session phone-shaped" and "does a fixed 222px box fit" are two
// different questions, and answering the second with the first is what broke it.
export const ROOT_TREE_W = 222;
export const ROOT_TREE_PUSH_MIN_W = ROOT_TREE_W * 3;

// True when a viewport of `width` can give the sidebar its column and still
// leave the page at least twice that much.
export function rootTreeCanPushAt(width) {
  return typeof width === "number" && width >= ROOT_TREE_PUSH_MIN_W;
}
