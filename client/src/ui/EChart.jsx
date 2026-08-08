// ui/EChart.jsx
// ============================================================
// The ONE place ECharts is touched. Everything else in the app deals in plain
// option objects (helpers/graphOption) so swapping the library later is a
// one-file change.
//
// NOT `echarts-for-react`. The published wrappers are small but they own the
// three things that actually need controlling here — dispose on unmount,
// setOption merge semantics, and resize observation — and this codebase has
// been bitten before by a wrapper hiding the thing being debugged.
//
// LAZY BY CONSTRUCTION. ECharts is ~158 kB gzipped (measured, 2026-08-06), so
// it is dynamically imported on first render and lands in its own chunk. A grid
// with no graph on screen never downloads it. Only the series actually used are
// imported — each extra chart type is ~13 kB, which is why supporting several
// is affordable.
//
// THE FOOTGUN THIS FILE EXISTS TO CONTAIN: a leaked ECharts instance keeps a
// canvas AND a resize listener alive. Every early return and every re-run of
// the effect must dispose.
//
// The outward contract is one callback: `onSelect({ occurrenceId, path, value,
// seriesName })`. `occurrenceId` rides on the datum itself — the spike proved
// an arbitrary key attached to a datum survives onto the click event — so a
// click resolves back to an occurrence with no lookup table.
//
// GESTURES LIVE HERE, THE ARITHMETIC DOES NOT. This file owns the host element,
// so it is where wheel / drag / pinch are read; every one of them turns into a
// call into the pure `helpers/graphView` and a `onViewChange` upward. Nothing
// about zoom is computed in this file.
//
// A DRAG MUST NOT COUNT AS A CLICK. ECharts fires its own `click` on mouseup
// regardless of how far the pointer travelled, so a pan across the wheel would
// otherwise ALSO record whatever slice you released over — picking an emotion
// you never chose. A pan past the threshold arms `suppressClickRef`, and the
// click handler spends it instead of selecting.
// ============================================================
import React, { useCallback, useEffect, useRef, useState } from "react";
import { zoomAt, panBy, wheelFactor, pinchFactor, distanceBetween, DEFAULT_VIEW } from "../helpers/graphView";

// Resolved once per mount and handed to buildEChartsOption, so charts follow
// the app's theme instead of shipping a palette of their own.
export function readChartTheme(el) {
  if (typeof window === "undefined" || !el) return undefined;
  const cs = getComputedStyle(el);
  const v = (name, fallback) => (cs.getPropertyValue(name) || "").trim() || fallback;
  return {
    text: v("--text-primary", "#e6e8ea"),
    faint: v("--text-faint", "#8a9199"),
  };
}

// One module-level promise: several graphs on one page must not each pull the
// chunk. Resolves to the configured echarts core.
let _echartsPromise = null;
function loadECharts() {
  if (_echartsPromise) return _echartsPromise;
  _echartsPromise = (async () => {
    const [core, charts, components, renderers] = await Promise.all([
      import("echarts/core"),
      import("echarts/charts"),
      import("echarts/components"),
      import("echarts/renderers"),
    ]);
    core.use([
      charts.SunburstChart, charts.PieChart, charts.BarChart, charts.LineChart,
      components.TooltipComponent, components.LegendComponent, components.GridComponent,
      renderers.CanvasRenderer,
    ]);
    return core;
  })();
  return _echartsPromise;
}

// Normalize an ECharts click into the app's own shape. `treePathInfo` is the
// sunburst's ancestor chain (verified in the spike) — for a feeling wheel that
// is `Angry › Frustrated › Annoyed`, and it is what makes a nested selection
// mean something. Flat charts have no path, hence the empty array.
export function normalizeSelect(params) {
  if (!params) return null;
  const path = Array.isArray(params.treePathInfo)
    ? params.treePathInfo.map((n) => n?.name).filter((n) => n != null && n !== "")
    : [];
  return {
    occurrenceId: params.data?.occurrenceId ?? null,
    name: params.name ?? null,
    value: params.value ?? null,
    seriesName: params.seriesName ?? null,
    path,
  };
}

// Past this much pointer travel the gesture is a PAN, not a click. Small enough
// that a deliberate tap never trips it, large enough to survive the wobble of a
// finger or a trackpad press.
const PAN_SLOP_PX = 5;

export default function EChart({
  option, onSelect, className = "", style = null,
  view = null, onViewChange = null, onBox = null,
}) {
  const hostRef = useRef(null);
  const chartRef = useRef(null);
  const [failed, setFailed] = useState(null);

  // Live refs so a changing handler never forces the chart to be torn down and
  // rebuilt (the same reason dragSystem keeps its payloads in refs).
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;
  // The gesture handlers compose each move onto the CURRENT view, so they read
  // it from a ref — a captured prop would make every pointermove build on the
  // view as it was when the listener was attached.
  const viewRef = useRef(view || DEFAULT_VIEW);
  viewRef.current = view || DEFAULT_VIEW;
  const suppressClickRef = useRef(false);
  // The option is ALSO held in a ref, and that is load-bearing rather than
  // tidiness: the option effect below runs on mount, which is BEFORE the
  // dynamic import resolves, so it finds no chart and skips. Without applying
  // the latest option at init time, every chart's FIRST render would be blank
  // until the option happened to change. (Caught by the test, not by reading.)
  const optionRef = useRef(option);
  optionRef.current = option;

  const onBoxRef = useRef(onBox);
  onBoxRef.current = onBox;

  // Report the host's MEASURED box so the caller can compute option values that
  // are only expressible in pixels — the sunburst's label threshold, which has
  // to know how long a slice's arc actually is (helpers/graphOption).
  //
  // Deliberately a SEPARATE observer from the ECharts one above, for two
  // reasons: that one only exists after the dynamic import resolves, and the
  // FIRST option is built while the chunk is still in flight; and this must
  // report a size even if ECharts never loads at all.
  //
  // THE 1px DEDUPE IS LOAD-BEARING, not a micro-optimisation: the box feeds an
  // option, which re-renders, which re-measures. Without it that is a loop.
  useEffect(() => {
    const el = hostRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    let last = null;
    const read = () => {
      const r = el.getBoundingClientRect();
      if (last && Math.abs(last.width - r.width) < 1 && Math.abs(last.height - r.height) < 1) return;
      last = { width: r.width, height: r.height };
      onBoxRef.current?.(last);
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let disposed = false;
    let chart = null;
    let ro = null;

    loadECharts()
      .then((echarts) => {
        // The component can unmount while the chunk is in flight; without this
        // the instance would be created with nothing to dispose it.
        if (disposed || !hostRef.current) return;
        chart = echarts.init(hostRef.current);
        chartRef.current = chart;
        // Apply whatever the option is NOW — see optionRef above.
        if (optionRef.current) chart.setOption(optionRef.current, { notMerge: true });
        chart.on("click", (params) => {
          // A pan that ended over a slice is not a pick of that slice.
          if (suppressClickRef.current) { suppressClickRef.current = false; return; }
          const sel = normalizeSelect(params);
          if (sel) onSelectRef.current?.(sel);
        });
        if (typeof ResizeObserver !== "undefined") {
          // Panels in this app resize constantly; without this the chart keeps
          // whatever size it had at first paint.
          ro = new ResizeObserver(() => chart && chart.resize());
          ro.observe(hostRef.current);
        }
      })
      .catch((e) => { if (!disposed) setFailed(String(e?.message || e)); });

    return () => {
      disposed = true;
      ro?.disconnect();
      chart?.dispose();
      chartRef.current = null;
    };
  }, []);

  // `notMerge: true` — a stored spec is authoritative. Merging would leave the
  // remains of a previous chart type behind when the user switches, which is
  // exactly the "changing the type half-works" bug.
  useEffect(() => {
    if (chartRef.current && option) chartRef.current.setOption(option, { notMerge: true });
  }, [option]);

  // ── Gestures ──────────────────────────────────────────────────────────────
  // Registered directly rather than through React props because the wheel
  // listener has to be NON-PASSIVE to preventDefault (React attaches wheel
  // passively, so an onWheel prop cannot stop the page from scrolling), and
  // because pointer capture wants the element itself.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !onViewChange) return undefined;

    // Pointer position as a percent of the host box — the coordinate space the
    // whole view model works in, so no size ever leaves this function.
    const pctOf = (e) => {
      const r = host.getBoundingClientRect();
      if (!r.width || !r.height) return { fx: 50, fy: 50 };
      return {
        fx: ((e.clientX - r.left) / r.width) * 100,
        fy: ((e.clientY - r.top) / r.height) * 100,
      };
    };
    const emit = (next) => { viewRef.current = next; onViewChangeRef.current?.(next); };

    const onWheel = (e) => {
      e.preventDefault();
      const { fx, fy } = pctOf(e);
      emit(zoomAt(viewRef.current, wheelFactor(e.deltaY), fx, fy));
    };

    // Keyed by pointerId so a second finger is tracked rather than replacing
    // the first — that distinction IS the difference between pan and pinch.
    const active = new Map();
    let pinchDist = 0;
    let travel = 0;

    const centroid = () => {
      const pts = [...active.values()];
      const n = pts.length || 1;
      return {
        x: pts.reduce((s, p) => s + p.x, 0) / n,
        y: pts.reduce((s, p) => s + p.y, 0) / n,
      };
    };

    const onPointerDown = (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (active.size === 1) { travel = 0; suppressClickRef.current = false; }
      if (active.size === 2) {
        const [a, b] = [...active.values()];
        pinchDist = distanceBetween(a, b);
      }
      // NOTE: pointer capture is deliberately NOT taken here — see onPointerMove.
    };

    const onPointerMove = (e) => {
      const prev = active.get(e.pointerId);
      if (!prev) return;
      const before = centroid();
      active.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const after = centroid();

      const r = host.getBoundingClientRect();
      if (!r.width || !r.height) return;

      travel += Math.hypot(after.x - before.x, after.y - before.y);
      if (travel > PAN_SLOP_PX && !suppressClickRef.current) {
        suppressClickRef.current = true;
        // CAPTURE ONLY ONCE A DRAG IS REAL, never on pointerdown.
        //
        // Capturing a pointer ALSO retargets the compatibility mouse events it
        // generates — so capturing at pointerdown sends the following mouseup
        // and click to this host instead of to the CANVAS underneath, and
        // ECharts never sees the click. Measured in a browser (2026-08-06): a
        // stationary click on the wheel selected NOTHING at every width, while
        // every unit test passed. That is the third defect on this surface that
        // only a real browser could show.
        //
        // Deferring the capture keeps a click a click, and still gives a drag
        // the thing capture is actually for: pointer events that keep arriving
        // after the finger leaves the element.
        try { host.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
      }

      let next = viewRef.current;

      if (active.size >= 2) {
        const [a, b] = [...active.values()];
        const dist = distanceBetween(a, b);
        if (pinchDist > 0 && dist > 0) {
          const fx = ((after.x - r.left) / r.width) * 100;
          const fy = ((after.y - r.top) / r.height) * 100;
          next = zoomAt(next, pinchFactor(pinchDist, dist), fx, fy);
        }
        pinchDist = dist;
      }

      // The centroid moves for a one-finger drag AND a two-finger drag, so pan
      // is the same code either way.
      next = panBy(
        next,
        ((after.x - before.x) / r.width) * 100,
        ((after.y - before.y) / r.height) * 100,
      );
      // Compared by VALUE: panBy/zoomAt always return a fresh object, so an
      // identity check would emit on every pointermove even when the view is
      // pinned at a clamp — a write per frame that changes nothing.
      const cur = viewRef.current;
      if (next.zoom !== cur.zoom || next.cx !== cur.cx || next.cy !== cur.cy) emit(next);
      e.preventDefault();
    };

    const endPointer = (e) => {
      active.delete(e.pointerId);
      if (active.size < 2) pinchDist = 0;
      try { host.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    };

    // Double-click is the escape hatch: whatever state the zoom is in, this
    // gets the whole chart back on screen without hunting for a control.
    const onDoubleClick = () => { suppressClickRef.current = true; emit(DEFAULT_VIEW); };

    host.addEventListener("wheel", onWheel, { passive: false });
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", endPointer);
    host.addEventListener("pointercancel", endPointer);
    host.addEventListener("dblclick", onDoubleClick);
    return () => {
      host.removeEventListener("wheel", onWheel);
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", endPointer);
      host.removeEventListener("pointercancel", endPointer);
      host.removeEventListener("dblclick", onDoubleClick);
    };
  }, [onViewChange]);

  const retry = useCallback(() => { _echartsPromise = null; setFailed(null); }, []);

  if (failed) {
    return (
      <div className={`echart-failed ${className}`} style={style}>
        <span>Chart library failed to load.</span>
        <button type="button" onClick={retry}>Retry</button>
      </div>
    );
  }

  return <div ref={hostRef} className={`echart ${className}`} style={style} />;
}
