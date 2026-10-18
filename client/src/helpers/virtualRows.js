// helpers/virtualRows.js — virtualize a long STACKED child list with
// @tanstack/react-virtual.
//
// WHY THIS REPLACES THE RENDER WINDOW FOR STACKS. `renderWindow.js` mounts the
// first 80 rows and grows on scroll. It never UNMOUNTS anything, so a long
// board gets heavier the further you scroll, and jumping to row 600 (a search)
// has to mount every row above it. Measured 2026-09-30: ~545 rows mounted,
// ~2.3s, before the row could even be found. Here only the rows near the
// viewport exist. Rows above and below are SPACERS with the right height, so
// the scroller is the same length it would be with every row rendered.
//
// THE LIST IS NOT ITS OWN SCROLLER. A board is part of a PAGE that scrolls, so
// the virtualizer watches the nearest scrolling ancestor. Its offset is the
// list's own position inside that scroller, read live
// (`scrollerTop - listTop`). That stays right when content above the list
// changes height, which a `scrollMargin` captured at mount would not.
//
// IN NORMAL FLOW, NOT ABSOLUTE. Rows keep their ordinary flex-column layout:
// spacers before, between and after the rendered rows. Two things follow.
// First, the browser's scroll anchoring already keeps the view steady when a
// row's real height differs from the estimate, so the virtualizer's own
// correction is switched off (two compensations would make the page jump).
// Second, a row PINNED away from the visible range (the search target) can sit
// at its own position with a spacer on each side.
//
// SEARCH. `jumpToOccurrence` dispatches `moduli:render-all` with the target
// id. A list holding that row CLAIMS it synchronously (so the jump does not
// fall back to opening everything) and PINS its index into the rendered set.
// The row then exists in the DOM at its estimated position, the jump finds it
// and scrolls to it, and the rows around it render because they are now in
// view. Nothing above it is mounted.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer, defaultRangeExtractor } from "@tanstack/react-virtual";
import { RENDER_ALL_EVENT } from "./renderWindow";

// Rows rendered beyond the viewport on each side.

// How many grid line-measure passes may run back to back (see the grid measure effect).
export const GRID_MEASURES_PER_BURST = 12;

/** A measured line height replaces the known one only when it moved by a whole pixel. */
export function lineNeedsResize(known, measured) {
  return measured > 0 && (known == null || Math.abs(known - measured) >= 1);
}

/** Counts a grid measure pass; false once more than GRID_MEASURES_PER_BURST ran within 50ms. */
export function takeMeasurePass(burst, now) {
  if (now - burst.at > 50) { burst.at = now; burst.n = 0; }
  burst.n += 1;
  return burst.n <= GRID_MEASURES_PER_BURST;
}
export const VIRTUAL_OVERSCAN = 10;
// The estimate for a row nobody has measured yet. It is replaced by the running
// average of measured rows as soon as any exist; this is only the first guess.
export const VIRTUAL_ESTIMATE = 48;
// How long a jump target stays pinned. It needs to outlast the jump's own
// look-until-mounted loop and the scroll that follows, and no more.
export const PIN_MS = 6000;

/** PURE: the nearest ancestor that scrolls vertically, or null. Read from the
 *  computed style, NOT from `scrollHeight > clientHeight`: at mount the page
 *  may not overflow yet, and a scroller is a scroller before it is full. */
export function findScrollParent(el) {
  if (typeof window === "undefined") return null;
  let node = el?.parentElement || null;
  while (node && node !== document.body && node !== document.documentElement) {
    const oy = window.getComputedStyle(node).overflowY;
    if (oy === "auto" || oy === "scroll" || oy === "overlay") return node;
    node = node.parentElement;
  }
  return null;
}

/** PURE: the rendered range plus any pinned index, sorted and de-duplicated. */
export function rangeWithPin(range, pinIndex) {
  const base = defaultRangeExtractor(range);
  if (pinIndex == null || pinIndex < 0 || pinIndex >= range.count) return base;
  if (base.includes(pinIndex)) return base;
  return [...base, pinIndex].sort((a, b) => a - b);
}

/** PURE: turn the virtualizer's items into a render plan — rows interleaved
 *  with spacer heights. A spacer is emitted only where there is a gap. */
export function planRows(virtualItems, totalSize, lineGap = 0) {
  // In a wrapping grid every flex LINE is followed by the container's row-gap,
  // and a spacer is a line of its own — so the browser adds `lineGap` after
  // each spacer, and the spacer must be that much shorter to land the next row
  // where it belongs. A stack has no gap (lineGap 0).
  const plan = [];
  let cursor = 0;
  for (const vi of virtualItems) {
    const gap = vi.start - cursor;
    if (gap > 0.5) plan.push({ spacer: Math.max(0, gap - lineGap) });
    plan.push({ index: vi.index, key: vi.key });
    cursor = Math.max(cursor, vi.end);
  }
  const tail = totalSize - cursor;
  if (tail > 0.5) plan.push({ spacer: Math.max(0, tail - lineGap) });
  return plan;
}

/** PURE: how many tiles fit on one line of a wrapping grid. */
export function gridColumns(listWidth, tileWidth, gap) {
  if (!(listWidth > 0) || !(tileWidth > 0)) return 1;
  return Math.max(1, Math.floor((listWidth + gap) / (tileWidth + gap)));
}

/**
 * @param {object} o
 * @param {number} o.count      rows in the list
 * @param {boolean} o.enabled   virtualize at all (callers gate on size + layout)
 * @param {{current: Element}} o.listRef  the element the rows render into
 * @param {(i:number)=>string} o.keyOf    a stable key per row (occurrence id)
 * @param {(occId:string)=>number} o.indexOf  where a jump target sits
 */
export function useVirtualRows({ count, enabled, listRef, keyOf, indexOf, grid = null }) {
  const [scrollEl, setScrollEl] = useState(null);
  // GRID MODE (a wrapping tile grid): the virtual items are LINES of `columns`
  // tiles. Tiles stay direct children of the list (the wrap CSS addresses them
  // that way), so a line has no wrapper to measure; its height is read from
  // its tiles' rects after render and fed back with resizeItem.
  const [columns, setColumns] = useState(1);
  const isGrid = !!grid;
  const cols = isGrid ? columns : 1;
  const lineGap = isGrid ? (grid.gap || 0) : 0;
  const lines = Math.ceil(count / cols);
  const [pinIndex, setPinIndex] = useState(null);
  const avgRef = useRef({ total: 0, n: 0 });
  const keyOfRef = useRef(keyOf);
  keyOfRef.current = keyOf;
  const indexOfRef = useRef(indexOf);
  indexOfRef.current = indexOf;

  // The scroller is found after mount, when the list is in the document.
  useEffect(() => {
    if (!enabled) { setScrollEl(null); return; }
    setScrollEl(findScrollParent(listRef.current));
  }, [enabled, listRef]);

  const active = enabled && !!scrollEl;

  // Columns from the list's width; corrected below from the real layout.
  const tileW = grid?.tileW || 0;
  useEffect(() => {
    if (!active || !isGrid || !listRef.current || typeof ResizeObserver === "undefined") return undefined;
    const el = listRef.current;
    const update = () => {
      const cs = window.getComputedStyle(el);
      const w = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      setColumns(gridColumns(w, tileW, lineGap));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, isGrid, tileW, lineGap, listRef]);

  const v = useVirtualizer({
    // NOT flushSync. The adapter's default re-renders the whole board SYNCHRONOUSLY inside each scroll
    // event while scrolling, which made every touch event of a swipe slow to handle (measured in Movies,
    // 2026-10-14: ~72ms of a ~200ms swipe), so Chrome saw a slow finger and flicks coasted little or not at
    // all. Overscan covers the one frame the rows now lag the scroll by.
    useFlushSync: false,
    count: active ? lines : 0,
    enabled: active,
    getScrollElement: () => scrollEl,
    estimateSize: () => {
      const a = avgRef.current;
      return a.n > 0 ? a.total / a.n : VIRTUAL_ESTIMATE;
    },
    overscan: VIRTUAL_OVERSCAN,
    getItemKey: (i) => (isGrid ? `line-${i}` : (keyOfRef.current?.(i) ?? i)),
    rangeExtractor: (range) => rangeWithPin(range, pinIndex),
    // The list's own position inside the scroller, read LIVE.
    observeElementOffset: (instance, cb) => {
      const el = instance.scrollElement;
      if (!el) return undefined;
      const read = () => {
        const list = listRef.current;
        if (!list) return 0;
        return el.getBoundingClientRect().top - list.getBoundingClientRect().top;
      };
      let timer = null;
      const onScroll = () => {
        cb(read(), true);
        clearTimeout(timer);
        timer = setTimeout(() => cb(read(), false), 150);
      };
      cb(read(), false);
      el.addEventListener("scroll", onScroll, { passive: true });
      // Content above the list changing height moves the list without a scroll.
      let ro = null;
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => cb(read(), false));
        ro.observe(el);
        if (listRef.current) ro.observe(listRef.current);
      }
      return () => {
        el.removeEventListener("scroll", onScroll);
        clearTimeout(timer);
        ro?.disconnect();
      };
    },
    scrollToFn: (offset, { adjustments = 0, behavior } = {}, instance) => {
      const el = instance.scrollElement;
      const list = listRef.current;
      if (!el || !list) return;
      const listTop = list.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      el.scrollTo({ top: offset + adjustments + listTop, behavior });
    },
  });
  // Normal flow: the browser's scroll anchoring already holds the view when a
  // row's real height differs from its estimate.
  v.shouldAdjustScrollPositionOnItemSizeChange = () => false;

  const colsRef = useRef(cols);
  colsRef.current = cols;
  // A search for a row in this list: claim it now and pin it into the DOM.
  useEffect(() => {
    if (!active) return undefined;
    let clearPin = null;
    const onRequest = (e) => {
      const d = e?.detail;
      if (!d?.occId) return; // an untargeted "open everything" has no meaning here
      if (d.root && listRef.current && !d.root.contains(listRef.current)) return;
      const i = typeof indexOfRef.current === "function" ? indexOfRef.current(d.occId) : -1;
      if (i < 0) return;
      d.claimed = true;
      setPinIndex(Math.floor(i / colsRef.current));
      clearTimeout(clearPin);
      clearPin = setTimeout(() => setPinIndex(null), PIN_MS);
    };
    window.addEventListener(RENDER_ALL_EVENT, onRequest);
    return () => { window.removeEventListener(RENDER_ALL_EVENT, onRequest); clearTimeout(clearPin); };
  }, [active, listRef]);

  const virtualItems = active ? v.getVirtualItems() : [];
  const totalSize = active ? v.getTotalSize() : 0;
  const plan = useMemo(() => {
    const lines = planRows(virtualItems, totalSize, lineGap);
    if (!isGrid) return lines;
    // Expand each line into its tiles.
    const out = [];
    for (const p of lines) {
      if (p.spacer != null) { out.push(p); continue; }
      const from = p.index * cols, to = Math.min(count, from + cols);
      for (let i = from; i < to; i++) out.push({ index: i, line: p.index });
    }
    return out;
  }, [virtualItems, totalSize, lineGap, isGrid, cols, count]);

  // GRID: measure each rendered line from its tiles, and correct `columns` when
  // the browser wrapped differently than the width arithmetic said.
  //
  // A LINE IS RESIZED ONLY WHEN ITS HEIGHT REALLY CHANGED (>= 1px), and at most
  // GRID_MEASURES_PER_BURST passes run back to back. Every resize re-renders the list, which
  // runs this effect again; a height that wobbled by a fraction of a pixel (or a column count
  // that flipped) never settled, and on a Bookmarks board during a search jump the chain passed
  // React's nested-update limit and crashed the panel (React #185, 2026-10-18).
  const burstRef = useRef({ at: 0, n: 0, retry: false });
  const [, setRemeasure] = useState(0);
  useLayoutEffect(() => {
    if (!active || !isGrid || !listRef.current) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const burst = burstRef.current;
    if (!takeMeasurePass(burst, now)) {
      // Over the cap: measure again on a later frame instead of now, so the lines still settle.
      if (!burst.retry) {
        burst.retry = true;
        setTimeout(() => { burst.retry = false; setRemeasure((t) => t + 1); }, 60);
      }
      return;
    }
    const list = listRef.current;
    const esc = (v) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(String(v)) : String(v));
    // Tiles are found by their occurrence id among the list's DIRECT children.
    const tiles = [];
    for (const p of plan) {
      if (p.line == null) continue;
      const id = keyOfRef.current?.(p.index);
      const el = id && list.querySelector(`:scope > [data-occurrence-id="${esc(id)}"]`);
      if (el) tiles.push({ el, line: p.line, r: el.getBoundingClientRect() });
    }
    if (!tiles.length) return;
    // Did the browser put as many tiles on a line as we planned? Read it off
    // the first FULL line we rendered.
    const firstLine = tiles[0].line;
    const onFirst = tiles.filter((t) => t.line === firstLine);
    const top0 = onFirst[0].r.top;
    const sameRow = onFirst.filter((t) => Math.abs(t.r.top - top0) < 2).length;
    if (onFirst.length === cols && sameRow !== cols && sameRow > 0) { setColumns(sameRow); return; }
    const byLine = new Map();
    for (const { line, r } of tiles) {
      const cur = byLine.get(line) || { top: Infinity, bottom: -Infinity };
      byLine.set(line, { top: Math.min(cur.top, r.top), bottom: Math.max(cur.bottom, r.bottom) });
    }
    for (const [line, { top, bottom }] of byLine) {
      const h = bottom - top + lineGap;
      const known = v.measurementsCache?.[line]?.size;
      if (lineNeedsResize(known, h)) {
        v.resizeItem(line, h);
        avgRef.current.total += h; avgRef.current.n += 1;
      }
    }
  });

  // Measure a rendered row, and fold its height into the running estimate.
  const measureRef = useCallback((node) => {
    if (!node) return;
    v.measureElement(node);
    const h = node.getBoundingClientRect().height;
    if (h > 0) { avgRef.current.total += h; avgRef.current.n += 1; }
  }, [v]);

  return { active, plan, measureRef, isGrid };
}
