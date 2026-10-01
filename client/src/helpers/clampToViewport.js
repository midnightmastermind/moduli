// helpers/clampToViewport.js — keep a popup that opens at a point fully on
// screen. Measured AFTER it renders (its real size), so it holds for any
// content. Found 2026-10-01: a folder's "Set cover…" popup opened at the click
// point beside the manifest tree and ran off the right edge of the window,
// leaving most swatches unreachable.

/** PURE: the top-left that keeps a `w`×`h` box inside a `vw`×`vh` viewport. */
export function clampToViewport({ x, y, w, h }, vw, vh, pad = 6) {
  const left = Math.max(pad, Math.min(x, vw - w - pad));
  const top = Math.max(pad, Math.min(y, vh - h - pad));
  return { left, top };
}
