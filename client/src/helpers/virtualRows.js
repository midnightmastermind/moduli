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

/** The first tile on screen (in tile units), read from the rendered ELEMENTS — a stacked row's
 *  data-index, a grid tile's occurrence id through indexOf — so it is what the user sees, not the
 *  virtualizer's estimate. Falls back to the estimate when nothing rendered sits at the top. */
export function topTileFromDom(list, scrollEl, cols, indexOf, v) {
  if (list && scrollEl) {
    const top = scrollEl.getBoundingClientRect().top;
    for (const el of list.children) {
      const r = el.getBoundingClientRect();
      if (r.height < 1 || r.bottom <= top + 1) continue;
      // The first element reaching below the top must also START at or above it — otherwise the top
      // of the screen is spacer (rows not drawn yet) and this element is not what the user sees.
      if (r.top > top + 1) break;
      if (el.classList?.contains("virtual-row")) return Number(el.dataset.index) * Math.max(1, cols);
      const id = el.getAttribute?.("data-occurrence-id");
      if (id != null && typeof indexOf === "function") { const i = indexOf(id); if (i >= 0) return i; }
    }
  }
  return v === undefined ? null : topTileIndex(v, cols);
}

/** The first tile (in tile units, not lines) whose line is still on screen, or null. */
export function topTileIndex(v, cols) {
  if (!v || typeof v.getVirtualItems !== "function") return null;
  const offset = v.scrollOffset ?? 0;
  const line = v.getVirtualItems().find((i) => i.end > offset);
  return line ? line.index * cols : null;
}

/** An unmeasured row's estimate: a row ABOVE the rendered range keeps the first estimate it was given
 *  (`frozen`, mutated), so a moving average cannot slide the list under a still finger; a row at or
 *  below the range follows the average. */
export function estimateFor(i, avg, frozen, startIndex) {
  if (frozen.has(i)) return frozen.get(i);
  if (startIndex != null && i < startIndex) frozen.set(i, avg);
  return avg;
}

/** The rendered element for a virtual line: a stacked list's row wrapper (data-index), or a grid
 *  line's first tile — a direct child of the list carrying that tile's occurrence id. */
export function anchorElement(list, line, cols, keyOf) {
  if (cols <= 1) return list.querySelector(`:scope > .virtual-row[data-index="${line}"]`);
  const id = keyOf?.(line * cols);
  return id == null ? null : childrenById(list).get(String(id)) || null;
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
// A GRID's items are whole LINES of tiles, several hundred px tall each (Books: ~450px), so the row
// overscan above would keep ~4,500px of tiles built off screen on each side. Three lines is still
// more than a fast flick covers in one frame.
export const VIRTUAL_GRID_OVERSCAN = 3;
// How long a jump target stays pinned. It needs to outlast the jump's own
// look-until-mounted loop and the scroll that follows, and no more.
export const PIN_MS = 6000;
// How long the row at the top is held there after the list changes width (a phone turned sideways).
export const ANCHOR_HOLD_MS = 2500;

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

/** The size to guess for an unmeasured row: the mean of the sizes the virtualizer has measured
 *  (cached per cache version — it is asked once per unmeasured row on every recompute), else the
 *  mount-time running average, else VIRTUAL_ESTIMATE. */
export function measuredAverage(v, mountAvg, cache) {
  const m = v?.itemSizeCache;
  if (m && m.size > 0) {
    const version = v.itemSizeCacheVersion ?? m.size;
    if (!cache || cache.version !== version) {
      let t = 0; for (const x of m.values()) t += x;
      const avg = t / m.size;
      if (!cache) return avg;
      cache.version = version; cache.avg = avg;
    }
    return cache.avg;
  }
  return mountAvg && mountAvg.n > 0 ? mountAvg.total / mountAvg.n : VIRTUAL_ESTIMATE;
}

/**
 * A row's size, never read off the element. TanStack's default measureElement reads `offsetHeight` when it is called
 * synchronously (a row mounting), which forces a layout — once per mounting row, many times a frame on a fast scroll.
 * Profiled 2026-11-02 on a phone (People board, 4x CPU): 40% of the scroll. The virtualizer's own ResizeObserver
 * reports every row's size after layout at no cost; the synchronous call returns what is known (cached size, else the
 * estimate) and the observer corrects it in the same frame.
 */
export function observerOnlyMeasure(element, entry, instance) {
  const box = entry?.borderBoxSize?.[0];
  if (box) return Math.round(instance.options.horizontal ? box.inlineSize : box.blockSize);
  const index = instance.indexFromElement(element);
  const cached = instance.itemSizeCache.get(instance.options.getItemKey(index));
  return cached !== undefined ? cached : instance.options.estimateSize(index);
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

/**
 * The list's direct children by occurrence id, read in ONE pass. Each tile used to be found with
 * its own `:scope > [data-occurrence-id=…]` query — one scan of the list per tile, on every
 * commit and every measure (~220ms over one Books scroll, 2026-10-19).
 */
export function childrenById(list) {
  const map = new Map();
  if (!list) return map;
  for (const el of list.children) {
    const id = el.getAttribute?.("data-occurrence-id");
    if (id != null && !map.has(id)) map.set(id, el);
  }
  return map;
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
  const scrollElRef = useRef(scrollEl);
  scrollElRef.current = scrollEl;

  // Columns from the list's width; corrected below from the real layout.
  const tileW = grid?.tileW || 0;
  useEffect(() => {
    if (!active || !isGrid || !listRef.current || typeof ResizeObserver === "undefined") return undefined;
    const el = listRef.current;
    const update = () => {
      const cs = window.getComputedStyle(el);
      const w = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
      const next = gridColumns(w, tileW, lineGap);
      // A width change that changes how many tiles fit a line (a phone turned sideways) rebuilds every
      // line, and the list's height changes with it — the scroll position then points at a different
      // tile, or past the new end. Remember the tile at the top, in TILES, before the change.
      if (next !== colsRef.current && anchorRef.current == null) anchorRef.current = lastTopRef.current ?? topTileFromDom(el, scrollElRef.current, colsRef.current, indexOfRef.current, vRef.current);
      setColumns(next);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, isGrid, tileW, lineGap, listRef]);

  const vRef = useRef(null);
  const estCacheRef = useRef({ version: -1, avg: 0 });
  const frozenEstRef = useRef(new Map());
  const v = useVirtualizer({
    // NOT flushSync. The adapter's default re-renders the whole board SYNCHRONOUSLY inside each scroll
    // event while scrolling, which made every touch event of a swipe slow to handle (measured in Movies,
    // 2026-10-14: ~72ms of a ~200ms swipe), so Chrome saw a slow finger and flicks coasted little or not at
    // all. Overscan covers the one frame the rows now lag the scroll by.
    useFlushSync: false,
    count: active ? lines : 0,
    enabled: active,
    getScrollElement: () => scrollEl,
    // Unmeasured rows are guessed at the average of the rows MEASURED SO FAR, read from the
    // virtualizer's own size cache — which its ResizeObserver keeps current as pictures load.
    // A row's height at mount (avgRef) is taken before its image arrives: on poms' People Table
    // (a photo per row) that guessed ~40px against ~90 real, so the list grew from 45k to 107k px
    // as it was scrolled and "the end" kept moving away.
    estimateSize: (i) => {
      const avg = measuredAverage(vRef.current, avgRef.current, estCacheRef.current);
      // A row's estimate, once given, is KEPT until the row is measured: a moving average re-sizes
      // every undrawn row above the screen at once, which slides the list under a still finger.
      // Only rows ABOVE the screen: rows below may follow the average (it is what keeps the list's end
      // from moving away as it is scrolled), and nothing on screen moves when they change.
      return estimateFor(i, avg, frozenEstRef.current, vRef.current?.range?.startIndex);
    },
    overscan: isGrid ? VIRTUAL_GRID_OVERSCAN : VIRTUAL_OVERSCAN,
    measureElement: observerOnlyMeasure,
    getItemKey: (i) => (isGrid ? `line-${i}` : (keyOfRef.current?.(i) ?? i)),
    rangeExtractor: (range) => rangeWithPin(range, pinIndex),
    // The list's own position inside the scroller, read LIVE.
    observeElementOffset: (instance, cb) => {
      const el = instance.scrollElement;
      if (!el) return undefined;
      // The list's top inside the scroller's CONTENT. A scroll event used to measure both rects,
      // forcing a layout on every event while the page was mid-render; the offset is scrollTop minus
      // this, re-measured only when things can have moved (layout changes, and once the scroll
      // settles — content above the list can change height without a resize we observe).
      let listTop = 0;
      const measureTop = () => {
        const list = listRef.current;
        if (!list) return;
        listTop = list.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
      };
      const read = () => el.scrollTop - listTop;
      let timer = null;
      const onScroll = () => {
        cb(read(), true);
        clearTimeout(timer);
        timer = setTimeout(() => { measureTop(); cb(read(), false); }, 150);
      };
      measureTop();
      cb(read(), false);
      el.addEventListener("scroll", onScroll, { passive: true });
      // Content above the list changing height moves the list without a scroll.
      let ro = null;
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(() => { measureTop(); cb(read(), false); });
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
  vRef.current = v;
  // The virtualizer's own correction stays ON: when a row above the screen is measured at a height
  // different from its estimate, it moves the scroll by the difference. This was switched off on the
  // reasoning that browser scroll anchoring holds the view; measured on a phone board (People, 2026-11-02)
  // it did not — with the scroll position unchanged, the row at the top slid 561 -> 514 in two seconds.

  const colsRef = useRef(cols);
  colsRef.current = cols;
  // ...and put that tile back at the top once the lines are rebuilt for the new column count.
  const anchorRef = useRef(null);
  // A plain (stacked) list's rows change HEIGHT when the width changes — fields wrap differently — so
  // the same scroll offset lands on a different row. Any width change of the list anchors too.
  const [widthTick, setWidthTick] = useState(0);
  useEffect(() => {
    if (!active || !listRef.current || typeof ResizeObserver === "undefined") return undefined;
    const el = listRef.current;
    let lastW = el.clientWidth;
    ackWidthRef.current = lastW;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (Math.abs(w - lastW) < 2) return;
      lastW = w;
      if (anchorRef.current == null && !holdRef.current) anchorRef.current = lastTopRef.current ?? topTileFromDom(el, scrollElRef.current, colsRef.current, indexOfRef.current, vRef.current);
      ackWidthRef.current = w;
      setWidthTick((t) => t + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [active, listRef]);
  // The rows above the anchor are re-measured at the new width over the next frames, which moves the
  // content under a fixed scroll offset. So the anchor is HELD — re-applied each time the list's size
  // changes — for ANCHOR_HOLD_MS, and released the moment the user touches or scrolls the list.
  const holdRef = useRef(null);
  useLayoutEffect(() => {
    const tile = anchorRef.current;
    anchorRef.current = null;
    if (tile == null || !active) return;
    holdRef.current = { line: Math.floor(tile / cols), until: Date.now() + ANCHOR_HOLD_MS };
    v.scrollToIndex(holdRef.current.line, { align: "start" });
  }, [cols, widthTick]); // eslint-disable-line react-hooks/exhaustive-deps
  // The row at the top, kept current as the user scrolls. A width change is only noticed AFTER the
  // browser has reflowed the rows at the new width (measured: portrait row 543 read back as 514), so
  // the anchor has to come from the last position seen BEFORE it.
  const lastTopRef = useRef(null);
  const readTopRef = useRef(null);
  const ackWidthRef = useRef(null); // the list width the anchor watcher last saw
  useEffect(() => {
    if (!scrollEl) return undefined;
    let raf = 0;
    const read = () => {
      raf = 0;
      if (holdRef.current) return;
      const list = listRef.current;
      // A reading taken after the width changed but before the width watcher has used the old one
      // would describe the REFLOWED list — skip it.
      if (!list || (ackWidthRef.current != null && Math.abs(list.clientWidth - ackWidthRef.current) >= 2)) return;
      const t = topTileFromDom(list, scrollEl, colsRef.current, indexOfRef.current);
      if (t != null) lastTopRef.current = t; // a top that is still spacer keeps the last real reading
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(read); };
    readTopRef.current = onScroll;
    scrollEl.addEventListener("scroll", onScroll, { passive: true });
    read();
    return () => { readTopRef.current = null; scrollEl.removeEventListener("scroll", onScroll); cancelAnimationFrame(raf); };
  }, [scrollEl, listRef]);
  useEffect(() => {
    if (!scrollEl) return undefined;
    const release = () => { holdRef.current = null; };
    for (const ev of ["pointerdown", "touchstart", "wheel", "keydown"]) scrollEl.addEventListener(ev, release, { passive: true });
    return () => { for (const ev of ["pointerdown", "touchstart", "wheel", "keydown"]) scrollEl.removeEventListener(ev, release); };
  }, [scrollEl]);
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
  // Rows drawn after a scroll land in a later render than the scroll event; read the top again then.
  useEffect(() => { readTopRef.current?.(); });
  // Re-apply a held anchor as rows re-measure (see holdRef): every frame of the hold, line the
  // anchor's REAL element up with the top of the scroller. The virtualizer's own offset for it is an
  // estimate until the rows above it are measured at the new width; the element's rect is not.
  useLayoutEffect(() => {
    if (!holdRef.current || !active || !scrollEl) return undefined;
    let raf = 0;
    const tick = () => {
      const h = holdRef.current;
      if (!h || Date.now() > h.until) { holdRef.current = null; return; }
      const list = listRef.current;
      const el = list && anchorElement(list, h.line, isGrid ? colsRef.current : 1, keyOfRef.current);
      if (el) {
        const delta = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top;
        if (Math.abs(delta) > 1) scrollEl.scrollTop += delta;
      } else {
        v.scrollToIndex(h.line, { align: "start" });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cols, widthTick, scrollEl]); // eslint-disable-line react-hooks/exhaustive-deps
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
  //
  // MEASURED FROM A ResizeObserver, NOT IN A LAYOUT EFFECT. Reading a tile's rect during the commit
  // forced the browser to lay the page out right then; every resize re-rendered and forced another,
  // so each scrolled frame of a long grid paid several full layouts (profiled 2026-10-19 on Books:
  // 10.3s of getBoundingClientRect in a 2.5s scroll). A ResizeObserver callback runs after the
  // browser's own layout, so the same reads cost nothing extra, and a tile that did not change
  // size does not fire at all. The commit only tells the observer which tiles exist.
  const burstRef = useRef({ at: 0, n: 0, retry: false });
  const measureGridRef = useRef(null);
  measureGridRef.current = () => {
    if (!active || !isGrid || !listRef.current) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    const burst = burstRef.current;
    if (!takeMeasurePass(burst, now)) {
      // Over the cap: measure again on a later frame instead of now, so the lines still settle.
      if (!burst.retry) {
        burst.retry = true;
        setTimeout(() => { burst.retry = false; measureGridRef.current?.(); }, 60);
      }
      return;
    }
    const list = listRef.current;
    // Tiles are found by their occurrence id among the list's DIRECT children.
    const byId = childrenById(list);
    const tiles = [];
    for (const p of plan) {
      if (p.line == null) continue;
      const id = keyOfRef.current?.(p.index);
      const el = id && byId.get(String(id));
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
  };
  const gridRoRef = useRef(null);
  const observedRef = useRef(new Set());
  useEffect(() => {
    if (!active || !isGrid || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => measureGridRef.current?.());
    gridRoRef.current = ro;
    if (listRef.current) ro.observe(listRef.current);
    return () => { ro.disconnect(); gridRoRef.current = null; observedRef.current = new Set(); };
  }, [active, isGrid, listRef]);
  useLayoutEffect(() => {
    if (!active || !isGrid || !listRef.current) return;
    const ro = gridRoRef.current;
    // No ResizeObserver (old engines, jsdom): measure here as before.
    if (!ro) { measureGridRef.current?.(); return; }
    const byId = childrenById(listRef.current);
    const now = new Set();
    for (const p of plan) {
      if (p.line == null) continue;
      const id = keyOfRef.current?.(p.index);
      const el = id && byId.get(String(id));
      if (!el) continue;
      now.add(el);
      if (!observedRef.current.has(el)) ro.observe(el); // a new tile: its first callback measures its line
    }
    for (const el of observedRef.current) if (!now.has(el)) ro.unobserve(el);
    observedRef.current = now;
  }, [plan, active, isGrid, cols, listRef]);

  // Measure a rendered row, and fold its height into the running estimate.
  // Registering the row is all: its height comes from the virtualizer's ResizeObserver (observerOnlyMeasure), and
  // the running average is read from the size cache that observer fills (measuredAverage).
  const measureRef = useCallback((node) => {
    if (!node) return;
    v.measureElement(node);
  }, [v]);

  return { active, plan, measureRef, isGrid };
}
