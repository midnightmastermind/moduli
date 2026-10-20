// A popup an editor opens (the "/" palette, the @ field picker, the doc-link and embed pickers)
// is absolutely positioned inside the editor, and every row (.instance-wrap, z-index 3) and
// container (.container-shell, z-index 1) is its own stacking context — so the NEXT row painted
// over it and the menu read as see-through (UI sweep 2026-10-19, item 43). While a popup is open
// its hosting rows/containers are lifted above their siblings; the returned function undoes it.
// A data attribute, not a class: React rewrites `className` whenever the row re-renders.
export const POPUP_LIFT_ATTR = "data-editor-popup";
const HOSTS = ".instance-wrap, .container-shell";

export function liftPopupHosts(el) {
  const lifted = [];
  for (let e = el?.parentElement?.closest(HOSTS) ?? (el?.matches?.(HOSTS) ? el : null); e; e = e.parentElement?.closest(HOSTS)) {
    if (!e.hasAttribute(POPUP_LIFT_ATTR)) { e.setAttribute(POPUP_LIFT_ATTR, ""); lifted.push(e); }
  }
  return () => lifted.forEach((e) => e.removeAttribute(POPUP_LIFT_ATTR));
}

// The keys an open pick-list (the "/" palette, the @ picker, [[ links, = expressions, @: embeds)
// navigates and picks with. The editor leaves them to the list while one is open.
const POPUP_KEYS = new Set(["ArrowUp", "ArrowDown", "Enter", "Tab"]);
export function popupOwnsKey(event) {
  return POPUP_KEYS.has(event?.key) && !event.altKey && !event.ctrlKey && !event.metaKey;
}
