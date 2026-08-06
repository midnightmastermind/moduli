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
// ============================================================
import React, { useCallback, useEffect, useRef, useState } from "react";

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

export default function EChart({ option, onSelect, className = "", style = null }) {
  const hostRef = useRef(null);
  const chartRef = useRef(null);
  const [failed, setFailed] = useState(null);

  // Live refs so a changing handler never forces the chart to be torn down and
  // rebuilt (the same reason dragSystem keeps its payloads in refs).
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // The option is ALSO held in a ref, and that is load-bearing rather than
  // tidiness: the option effect below runs on mount, which is BEFORE the
  // dynamic import resolves, so it finds no chart and skips. Without applying
  // the latest option at init time, every chart's FIRST render would be blank
  // until the option happened to change. (Caught by the test, not by reading.)
  const optionRef = useRef(option);
  optionRef.current = option;

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
