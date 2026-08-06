// helpers/graphOption.js
// ============================================================
// PURE. `(spec, data) → an ECharts option object`. No React, no ECharts import
// — isolating this is what makes chart-type support testable without rendering.
//
// THE CONTRACT THAT MATTERS: every datum carries its `occurrenceId`. The spike
// (2026-08-06) proved an arbitrary key attached to a datum survives onto the
// click event, so a click resolves straight back to an occurrence and there is
// no index-to-occurrence lookup table to keep in sync. A hardcoded literal
// carries `occurrenceId: null`, which is how a click handler knows there is
// nothing to open.
//
// A BAD STORED SPEC MUST NOT BLANK THE PAGE. An unknown chart type falls back
// to a bar with a warning rather than throwing — `meta.graph` is user-editable
// data, and a typo in it should degrade, not break the surface it lives on.
//
// Colors come from the CALLER, not from here: the wrapper reads the app's CSS
// custom properties once and passes them in, so charts follow the theme instead
// of shipping their own palette.
//
// ZOOM IS TWO NUMBERS ON THE SERIES, and that is the whole reason it costs
// almost nothing: ECharts resolves a radial series' percent `radius` and
// `center` against the host box itself, so scaling the radius and moving the
// centre zooms and pans the chart WITHOUT this file (or the view state) ever
// knowing the container's size. See helpers/graphView for the arithmetic.
// ============================================================
import { clampView, DEFAULT_VIEW } from "./graphView";

export const CHART_TYPES = [
  { id: "sunburst", label: "Sunburst", nested: true, desc: "Multi-level rings — a wheel you can click into" },
  { id: "pie", label: "Pie", nested: false, desc: "One ring of proportions" },
  { id: "bar", label: "Bar", nested: false, desc: "Compare values across categories" },
  { id: "line", label: "Line", nested: false, desc: "A value over a sequence" },
];

const BY_ID = new Map(CHART_TYPES.map((t) => [t.id, t]));
const FALLBACK_TYPE = "bar";

// Deliberately neutral: the real palette arrives from the app's CSS custom
// properties via the wrapper. These only keep a test or a headless render
// legible.
const DEFAULT_THEME = {
  text: "#e6e8ea",
  faint: "#8a9199",
  palette: ["#5b9bd5", "#70ad47", "#e0a030", "#c0504d", "#8064a2", "#4bacc6", "#d99694", "#9bbb59"],
};

// Strip the internal node shape down to what ECharts wants, keeping the one
// key that makes a click actionable. Recursive so nesting survives.
//
// `highlight` is a Set of occurrence ids an OPERATION has marked. The graph
// renders it; it never decides it. That is what keeps "the picked feeling stays
// lit" from meaning the renderer knows what a feeling is — an op writes
// `meta.graph.highlight` through the ordinary UPDATE path, exactly as it would
// write any other field, and the chart just draws what it is told.
function toDatum(node, highlight) {
  const d = {
    name: node.name,
    // Our own passenger — see the header.
    occurrenceId: node.occurrenceId ?? null,
  };
  if (node.value !== undefined) d.value = node.value;
  if (highlight && node.occurrenceId && highlight.has(node.occurrenceId)) {
    d.selected = true;
    // Lift it out of the palette so a marked slice reads as marked at a glance,
    // and keep the label legible against the brighter fill.
    d.itemStyle = { borderWidth: 2, borderColor: "#fff", opacity: 1 };
    d.label = { fontWeight: 700 };
  }
  if (Array.isArray(node.children) && node.children.length) {
    d.children = node.children.map((c) => toDatum(c, highlight));
  }
  return d;
}

// An operation writes `meta.graph.highlight` as a list of occurrence ids (or a
// single id). Normalized here so callers never have to care which shape it is.
export function highlightSet(spec) {
  const h = spec?.highlight;
  if (!h) return null;
  const ids = Array.isArray(h) ? h : [h];
  const clean = ids.filter((x) => typeof x === "string" && x);
  return clean.length ? new Set(clean) : null;
}

// Flatten for chart types that have no concept of nesting, so a nested data set
// dropped into a pie still renders its leaves rather than nothing.
function flatten(nodes, out = []) {
  for (const n of nodes || []) {
    if (Array.isArray(n.children) && n.children.length) flatten(n.children, out);
    else out.push(n);
  }
  return out;
}

// One ECharts series per distinct `series` value; a single series when nothing
// carries one (the common case).
//
// ZERO ROWS STILL YIELD ONE EMPTY SERIES. Returning [] here would emit a chart
// with no series at all, so an empty graph would render axes attached to
// nothing — and any caller reading `series[0]` would get undefined. An empty
// graph is the NORMAL first state of a freshly created one, so it has to be a
// real shape rather than a degenerate case. (Caught by the tests, not by
// inspection.)
function splitSeries(nodes) {
  const keyed = new Map();
  for (const n of nodes) {
    const k = n.series ?? null;
    if (!keyed.has(k)) keyed.set(k, []);
    keyed.get(k).push(n);
  }
  if (keyed.size === 0) return [[null, []]];
  return [...keyed.entries()];
}

export function buildEChartsOption(spec, data, theme, view) {
  const warnings = [];
  const t = { ...DEFAULT_THEME, ...(theme || {}) };
  const nodes = Array.isArray(data) ? data : [];

  // A stored view is user data like everything else in `meta.graph`, so it is
  // CLAMPED rather than trusted — a bad zoom degrades to a legal one instead of
  // rendering a chart nobody can find.
  const v = view ? clampView(view) : DEFAULT_VIEW;
  const scaled = (pct) => `${pct * v.zoom}%`;
  const center = [`${v.cx}%`, `${v.cy}%`];

  const hi = highlightSet(spec);

  const wanted = spec?.type || FALLBACK_TYPE;
  let def = BY_ID.get(wanted);
  if (!def) {
    warnings.push(`unknown chart type "${wanted}" — falling back to ${FALLBACK_TYPE}`);
    def = BY_ID.get(FALLBACK_TYPE);
  }

  const base = {
    backgroundColor: "transparent", // the surface owns the background
    color: t.palette,
    textStyle: { color: t.text, fontSize: 11 },
    tooltip: { trigger: def.nested ? "item" : "axis", confine: true },
    animationDuration: 240,
  };

  if (def.nested) {
    return {
      option: {
        ...base,
        tooltip: { trigger: "item", confine: true },
        series: [{
          type: def.id,
          radius: [0, scaled(92)],
          center,
          data: nodes.map((n) => toDatum(n, hi)),
          // `minAngle` HIDES a label whose slice is narrower than N degrees, and
          // it defaults high enough to blank an entire ring. Measured on the
          // real 128-node emotions wheel (2026-08-06): 80 tertiary leaves are
          // 4.5° each, so at minAngle 8 the whole outer ring rendered with NO
          // TEXT — a wheel you cannot read is a wheel you cannot pick from, and
          // every metric (8 roots, 0 warnings, 540k painted px) still said it
          // was fine. Caught by a screenshot.
          //
          // 1 rather than 0: a genuinely degenerate sliver should still be
          // allowed to drop its label rather than scribble over its neighbours.
          label: { rotate: "radial", color: t.text, fontSize: 10, minAngle: 1, overflow: "truncate" },
          emphasis: { focus: "ancestor" },
          // A CLICK SELECTS. It must not NAVIGATE.
          //
          // ECharts' sunburst defaults to `nodeClick: "rootToNode"` — clicking a
          // node re-roots the chart to it. Measured in a browser harness
          // (2026-08-06): one click on "Astonished" replaced the entire wheel
          // with that single node and a grey back-button. For a feeling wheel
          // that is fatal — picking an emotion would zoom the chart instead of
          // recording a mood, and the wheel you picked from would be gone.
          //
          // No unit test could have caught this: it is the library's internal
          // default, invisible to jsdom and to every assertion about our own
          // option object. It took a screenshot.
          nodeClick: false,
        }],
      },
      warnings,
    };
  }

  const flat = flatten(nodes);

  if (def.id === "pie") {
    return {
      option: {
        ...base,
        tooltip: { trigger: "item", confine: true },
        series: [{
          type: "pie",
          // a donut reads better at panel sizes than a full disc
          radius: [scaled(38), scaled(72)],
          center,
          data: flat.map((n) => toDatum(n, hi)),
          label: { color: t.text, fontSize: 11 },
        }],
      },
      warnings,
    };
  }

  // bar / line — a shared category axis built from the node names.
  const groups = splitSeries(flat);
  const categories = [...new Set(flat.map((n) => n.name))];
  return {
    option: {
      ...base,
      grid: { left: 8, right: 12, top: 24, bottom: 8, containLabel: true },
      xAxis: {
        type: "category",
        data: categories,
        axisLabel: { color: t.faint, fontSize: 10, hideOverlap: true },
        axisLine: { lineStyle: { color: t.faint } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: t.faint, fontSize: 10 },
        splitLine: { lineStyle: { color: t.faint, opacity: 0.16 } },
      },
      legend: groups.length > 1 ? { textStyle: { color: t.faint, fontSize: 10 }, top: 0 } : undefined,
      series: groups.map(([seriesName, ns]) => ({
        type: def.id,
        name: seriesName ?? undefined,
        data: ns.map((n) => toDatum(n, hi)),
        ...(def.id === "line" ? { smooth: true, symbolSize: 6 } : { barMaxWidth: 42 }),
      })),
    },
    warnings,
  };
}
