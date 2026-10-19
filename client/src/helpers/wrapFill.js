/**
 * A wrap grid whose tiles FILL the row (`childFill` in the layout cascade).
 *
 * User 2026-10-19, on the Books board: "have books layout be full panel please so each one
 * expands to share the 100% width. right now theres a gap on the right." A wrap grid lays out
 * fixed-width tiles, so whatever width is left after the last tile on a line is a gap. With fill
 * on, each tile is `(row width - gaps) / columns`, where `columns` is how many tiles of the square
 * size fit — the same count the virtual grid computes (`gridColumns`), so the two never disagree.
 *
 * The count is written as a CSS variable straight onto the list element from a ResizeObserver, not
 * held in React state: a panel resize then re-lays out the tiles without re-rendering the board.
 */
import { useLayoutEffect } from "react";
import { gridColumns } from "./virtualRows";

/** PURE: how many columns a filled row has. */
export function fillColumns(listWidth, minTileWidth, gap) {
  return gridColumns(listWidth, minTileWidth, gap);
}

export function useWrapFillColumns(listRef, { enabled, minW, gap }) {
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    if (!enabled) { el.style.removeProperty("--wrap-cols"); return undefined; }
    const apply = (width) => {
      const cols = fillColumns(width, minW, gap);
      if (el.style.getPropertyValue("--wrap-cols") !== String(cols)) el.style.setProperty("--wrap-cols", String(cols));
    };
    const style = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
    const pad = style ? (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0) : 0;
    apply(el.clientWidth - pad);
    if (typeof ResizeObserver === "undefined") return () => el.style.removeProperty("--wrap-cols");
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w > 0) apply(w);
    });
    ro.observe(el);
    return () => { ro.disconnect(); el.style.removeProperty("--wrap-cols"); };
  }, [listRef, enabled, minW, gap]);
}
