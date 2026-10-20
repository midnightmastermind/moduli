// A popup an editor opens (the "/" palette, the @ field picker, the doc-link and embed pickers)
// is absolutely positioned inside the editor, and every row (.instance-wrap, z-index 3) and
// container (.container-shell, z-index 1) is its own stacking context — so the NEXT row painted
// over it and the menu read as see-through (UI sweep 2026-10-19, item 43). While a popup is open
// its hosting rows/containers are lifted above their siblings; the returned function undoes it.
export const POPUP_LIFT_CLASS = "has-editor-popup";
const HOSTS = ".instance-wrap, .container-shell";

export function liftPopupHosts(el) {
  const lifted = [];
  for (let e = el?.parentElement?.closest(HOSTS) ?? (el?.matches?.(HOSTS) ? el : null); e; e = e.parentElement?.closest(HOSTS)) {
    if (!e.classList.contains(POPUP_LIFT_CLASS)) { e.classList.add(POPUP_LIFT_CLASS); lifted.push(e); }
  }
  return () => lifted.forEach((e) => e.classList.remove(POPUP_LIFT_CLASS));
}
