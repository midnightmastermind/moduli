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

// EVERY TYPE DECLARES WHICH ENCODINGS IT CONSUMES, and that is not
// documentation — the editor renders only these rows, and `buildEChartsOption`
// warns about anything configured that the selected type ignores.
//
// It exists because the alternative shipped and was wrong: the editor offered
// all six encodings for every type while `splitSeries` was called ONLY in the
// bar/line branch, so **"Split by" on a pie or a sunburst did nothing at all**
// — no legend, no grouping, no warning (audited 2026-08-10). That is the
// dead-control class, and it is the one that gets worse with every type added,
// which is why this table is a PREREQUISITE for more chart types rather than a
// tidy-up after them.
export const CHART_TYPES = [
  {
    id: "sunburst", label: "Sunburst", nested: true,
    desc: "Multi-level rings — a wheel you can click into",
    encodings: ["category", "value", "children", "parent", "level"],
  },
  {
    id: "pie", label: "Pie", nested: false,
    // Drawn as a DONUT at panel sizes, where a full disc reads worse. Named
    // honestly here so nobody adds a "Donut" type that is this one again.
    desc: "One ring of proportions (drawn as a donut)",
    encodings: ["category", "value", "flatten"],
  },
  {
    id: "bar", label: "Bar", nested: false,
    desc: "Compare values across categories",
    encodings: ["category", "value", "series", "flatten"],
  },
  {
    id: "bar-h", label: "Bar (horizontal)", nested: false, echarts: "bar", axis: "y",
    // Not a style choice — a category axis along the BOTTOM has one label's
    // width per row, so board labels ("Peer Support Group - Froedtert") overlap
    // or get dropped. Down the side, each label has a whole row to itself.
    desc: "Compare values — room for long labels",
    encodings: ["category", "value", "series", "flatten"],
  },
  {
    id: "bar-stacked", label: "Bar (stacked)", nested: false, echarts: "bar", stack: true,
    // The one type where "Split by" is the POINT: each category is a whole made
    // of its series, rather than groups standing side by side.
    desc: "Split each bar into its series — parts of a whole",
    encodings: ["category", "value", "series", "flatten"],
  },
  {
    id: "line", label: "Line", nested: false,
    desc: "A value over a sequence",
    encodings: ["category", "value", "series", "flatten"],
  },
  {
    id: "area", label: "Area", nested: false, echarts: "line", area: true,
    desc: "A line with the space beneath it filled — volume over a sequence",
    encodings: ["category", "value", "series", "flatten"],
  },
  {
    id: "treemap", label: "Treemap", nested: true,
    // The sunburst's data, read the other way: a wheel compares ANGLES, a
    // treemap compares AREAS, and area is far easier to judge. Same encodings,
    // so switching between them costs nothing and discards no configuration.
    desc: "Nested rectangles — which parts are biggest",
    encodings: ["category", "value", "children", "parent", "level"],
  },
  {
    id: "radar", label: "Radar", nested: false,
    // For comparing the SAME set of measures across a few subjects — the nine
    // wellness dimensions, this week against last. See the note on its branch:
    // a radar point is not clickable back to one row.
    desc: "One spoke per category — compare a few series across all of them",
    encodings: ["category", "value", "series", "flatten"],
  },
];

const BY_ID = new Map(CHART_TYPES.map((t) => [t.id, t]));
const FALLBACK_TYPE = "bar";

/** Which encodings this chart type actually reads. Unknown type → the fallback's. */
export function encodingsForType(typeId) {
  return (BY_ID.get(typeId) || BY_ID.get(FALLBACK_TYPE)).encodings;
}

/**
 * Encoding keys the spec CONFIGURES that its chart type will ignore.
 *
 * Switching type is the common way to get here — a wheel configured with a
 * parent field, switched to a pie, still carries the parent field. The config
 * is deliberately KEPT (switching back must not have destroyed it); this is
 * what makes the fact that it is currently inert visible.
 */
export function unusedEncodingKeys(spec) {
  const enc = spec?.encoding;
  if (!enc || typeof enc !== "object") return [];
  const used = new Set(encodingsForType(spec?.type));
  return Object.keys(enc).filter((k) => enc[k] != null && !used.has(k));
}

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
    // IT HAS TO READ AS PICKED FROM ACROSS THE WHEEL, and the first version did
    // not: a 2px white border on a 4.5° tertiary slice is a hairline. The user
    // reported the selection "turned off" when they clicked away — what they had
    // actually seen was ECharts' own click EMPHASIS fading, leaving a highlight
    // too faint to notice. The data was correct the whole time.
    //
    // So: a thick BLACK ring and shadow that read at any slice width, with the
    // label pulled to black and bold (user, 2026-08-12: "make the lettering
    // black too and the outlines"). Black is deliberately not a palette colour
    // — a marked slice must not look like just another category.
    d.itemStyle = {
      borderWidth: 4, borderColor: "#000000", opacity: 1,
      shadowBlur: 12, shadowColor: "rgba(0,0,0,0.9)",
    };
    d.label = { fontWeight: 700, color: "#000000" };
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

// A FLAT CHART HAS TO PICK A LEVEL, and until 2026-08-10 it picked one in
// silence: leaves only, so switching the 128-emotion wheel to a pie dropped its
// primary and secondary rings with nothing said. Leaves-only is still the
// default (it is the right answer for most hierarchies), but it is now a choice
// and a discarded branch is reported.
//
//   leaves  every node with no children — the deepest ring
//   roots   the top level only — the summary
//   all     every node at every depth
export const FLATTEN_MODES = [
  { id: "leaves", label: "deepest level only" },
  { id: "roots", label: "top level only" },
  { id: "all", label: "every level" },
];

function flatten(nodes, mode = "leaves", out = [], dropped = { n: 0 }) {
  for (const n of nodes || []) {
    const kids = Array.isArray(n.children) ? n.children : [];
    const isBranch = kids.length > 0;
    if (mode === "all" || !isBranch || mode === "roots") out.push(n);
    else dropped.n += 1;
    // "roots" never descends — the top level IS the answer.
    if (isBranch && mode !== "roots") flatten(kids, mode, out, dropped);
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

// The sunburst's outer radius, as a percent of the host box. ONE source, so the
// drawn radius and the label-threshold maths can never disagree.
export const NESTED_RADIUS_PCT = 92;

// Radial sunburst labels: the font size, and how much ARC one needs to be
// readable. A `rotate: "radial"` label runs ALONG the radius, so what has to fit
// inside the slice's arc is its THICKNESS — the font size — plus room to
// breathe. Expressed as a multiple of the font size so the two cannot drift.
// A sunburst's labels sit ON its slices, so they take their contrast from the
// PALETTE, not from the page theme. Black reads on every fill in the palette;
// the theme's light `text` colour did not, which is what made the wheel hard to
// read. Same colour is used for the slice separators so a ring reads as
// segmented rather than as one blended band.
export const SUNBURST_LABEL_COLOR = "#000000";
export const LABEL_FONT_PX = 10;
export const LABEL_MIN_ARC_PX = LABEL_FONT_PX * 1.8;

// `minAngle` applies to the WHOLE series, so an unclamped threshold on a tiny
// box would blank the 8 primary slices (45° each) as well — which is the
// 2026-08-06 failure exactly ("a wheel you cannot read is a wheel you cannot
// pick from"). 30 keeps the primary ring labelled at every size.
const MAX_MIN_ANGLE_DEG = 30;

/**
 * The `minAngle` below which a radial label would collide with its neighbours.
 *
 *   arc = 2·π·r · (deg/360)   →   deg = minArcPx · 360 / (2·π·r)
 *
 * `r` is in PIXELS, which is why the host box has to be threaded in at all: the
 * series radius is a PERCENT and ECharts resolves it against min(w, h) / 2.
 * Deriving from pixels rather than a fixed number is what makes this
 * viewport-aware AND makes ZOOM REVEAL LABELS — on a phone that is the only way
 * the 4.5° outer ring is ever readable.
 *
 * @returns {number|null} degrees, or null when the box is unknown — the caller
 *   then keeps its fixed default rather than guessing.
 */
export function radialLabelMinAngle({ boxPx, radiusPct, zoom = 1, minArcPx = LABEL_MIN_ARC_PX } = {}) {
  const box = Math.min(Number(boxPx?.width) || 0, Number(boxPx?.height) || 0);
  const pct = Number(radiusPct) || 0;
  if (!(box > 0) || !(pct > 0)) return null;
  const r = (pct / 100) * (Number(zoom) || 1) * (box / 2);
  if (!(r > 0)) return null;
  return Math.min((minArcPx * 360) / (2 * Math.PI * r), MAX_MIN_ANGLE_DEG);
}

export function buildEChartsOption(spec, data, theme, view, boxPx) {
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

  // An encoding this type does not read is INERT, and inert is exactly what
  // nobody can see: the chart renders, it is simply not doing the thing that was
  // configured. Reported rather than dropped — switching type back must not have
  // destroyed the setting. It lives here, not in graphData, because whether an
  // encoding is read is a fact about the CHART TYPE: graphData honestly builds a
  // tree from `parent` no matter what is eventually drawn from it.
  for (const key of unusedEncodingKeys({ ...spec, type: def.id })) {
    warnings.push(`"${key}" is ignored by a ${def.label.toLowerCase()} chart`);
  }

  const base = {
    backgroundColor: "transparent", // the surface owns the background
    color: t.palette,
    textStyle: { color: t.text, fontSize: 11 },
    tooltip: { trigger: def.nested ? "item" : "axis", confine: true },
    animationDuration: 240,
  };

  if (def.id === "sunburst") {
    return {
      option: {
        ...base,
        tooltip: { trigger: "item", confine: true },
        series: [{
          type: def.id,
          radius: [0, scaled(NESTED_RADIUS_PCT)],
          center,
          data: nodes.map((n) => toDatum(n, hi)),
          // Every slice carries a thin black separator so the rings read as
          // segments. A highlighted slice overrides this with a thicker one.
          itemStyle: { borderColor: SUNBURST_LABEL_COLOR, borderWidth: 1 },
          // `minAngle` HIDES a label whose slice is narrower than N degrees, and
          // it defaults high enough to blank an entire ring. Measured on the
          // real 128-node emotions wheel (2026-08-06): 80 tertiary leaves are
          // 4.5° each, so at minAngle 8 the whole outer ring rendered with NO
          // TEXT — a wheel you cannot read is a wheel you cannot pick from, and
          // every metric (8 roots, 0 warnings, 540k painted px) still said it
          // was fine. Caught by a screenshot.
          //
          // A FIXED NUMBER CANNOT BE RIGHT, which is what both 8 and 1 were.
          // The same 4.5° slice is ~14px of arc on a 390px phone, ~40px on a
          // desktop and ~170px at 4x zoom — so the threshold is derived from a
          // readable ARC LENGTH IN PIXELS (2026-08-08). Viewport-aware by
          // construction, and it makes ZOOMING REVEAL LABELS, which on a phone
          // is the only way the outer ring is ever readable.
          //
          // Falls back to the old fixed 1 when the host box is unknown, so a
          // caller that passes no box gets exactly the previous chart.
          label: {
            rotate: "radial", color: SUNBURST_LABEL_COLOR, fontSize: LABEL_FONT_PX, overflow: "truncate",
            minAngle: radialLabelMinAngle({ boxPx, radiusPct: NESTED_RADIUS_PCT, zoom: v.zoom }) ?? 1,
          },
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

  if (def.id === "treemap") {
    return {
      option: {
        ...base,
        tooltip: { trigger: "item", confine: true },
        series: [{
          type: "treemap",
          data: nodes.map((n) => toDatum(n, hi)),
          // THE SUNBURST'S LESSON, APPLIED BEFORE IT COSTS A SCREENSHOT.
          // ECharts' treemap defaults to `nodeClick: "zoomToNode"` — the same
          // family of default that made a click on the feeling wheel re-root the
          // chart instead of recording a mood (2026-08-06). A click here SELECTS;
          // the breadcrumb that comes with drill-down goes with it.
          nodeClick: false,
          breadcrumb: { show: false },
          roam: false,
          label: { color: "#fff", fontSize: 11, overflow: "truncate" },
          // Without this every level is drawn in the same flat block; the border
          // is what makes a parent readable as a parent.
          levels: [
            { itemStyle: { borderColor: "transparent", borderWidth: 4, gapWidth: 2 } },
            { itemStyle: { borderColorSaturation: 0.5, borderWidth: 2, gapWidth: 1 } },
          ],
        }],
      },
      warnings,
    };
  }

  // FLATTENING IS FOR THE FLAT TYPES ONLY — both nested types return above it,
  // so a treemap never reports discarding a level it in fact drew.
  const flattenMode = FLATTEN_MODES.some((m) => m.id === spec?.encoding?.flatten)
    ? spec.encoding.flatten
    : "leaves";
  const droppedBranches = { n: 0 };
  const flat = flatten(nodes, flattenMode, [], droppedBranches);
  if (droppedBranches.n > 0) {
    warnings.push(
      `${droppedBranches.n} grouping row${droppedBranches.n === 1 ? "" : "s"} not drawn — a ${def.label.toLowerCase()} shows one level ("${FLATTEN_MODES.find((m) => m.id === flattenMode).label}")`,
    );
  }

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
  //
  // EVERY SERIES IS PADDED TO THE FULL CATEGORY LIST, and that is a correctness
  // fix rather than tidiness. An ECharts CATEGORY AXIS maps a series' data to
  // categories BY INDEX — a datum's `name` is used for the label and the
  // tooltip, never for placement. So a series that carries a datum for only
  // some categories used to be drawn SHIFTED LEFT: measured 2026-08-10, a "Bob"
  // series holding one Tuesday value rendered it on Monday. Fully populated,
  // no error, and quietly wrong — the worst shape a chart bug can take.
  //
  // `null` for a category this series has no row for is ECharts' own "no data
  // here": a gap in a line, no bar in a group.
  const groups = splitSeries(flat);
  const categories = [...new Set(flat.map((n) => n.name))];

  // One row per (series, category). Shared by every category-axis type — bar,
  // its horizontal and stacked variants, line, area and radar — so the padding
  // rule above cannot hold for some of them and not others.
  const alignedData = (seriesName, ns) => {
    // First row wins a category. Two rows sharing a name inside ONE series is a
    // request to aggregate, and this file does not invent aggregates — it says
    // so instead, so the author can add a value field or split the series rather
    // than wonder where a row went.
    const byName = new Map();
    for (const n of ns) {
      if (byName.has(n.name)) {
        warnings.push(
          `two rows share the name "${n.name}"${seriesName ? ` in series "${seriesName}"` : ""} — only the first is drawn`,
        );
        continue;
      }
      byName.set(n.name, toDatum(n, hi));
    }
    return categories.map((c) => byName.get(c) ?? null);
  };

  const legend = groups.length > 1
    ? { textStyle: { color: t.faint, fontSize: 10 }, top: 0 }
    : undefined;

  if (def.id === "radar") {
    // A RADAR POINT IS NOT CLICKABLE BACK TO ONE ROW, and that is worth saying
    // out loud rather than shipping a dead affordance: an ECharts radar datum is
    // a whole series (one polygon, N values), so a click identifies the SERIES,
    // not the spoke. Every other type here carries `occurrenceId` per datum and
    // selects a row. This one is for reading, not picking.
    //
    // Every spoke shares ONE max so the polygon means something — per-spoke maxes
    // would normalise every measure to the same radius and make the shape a lie.
    const max = Math.max(1, ...flat.map((n) => Number(n.value) || 0));
    return {
      option: {
        ...base,
        tooltip: { trigger: "item", confine: true },
        legend,
        radar: {
          indicator: categories.map((c) => ({ name: c, max })),
          center,
          radius: scaled(62),
          axisName: { color: t.faint, fontSize: 10 },
          splitLine: { lineStyle: { color: t.faint, opacity: 0.2 } },
          axisLine: { lineStyle: { color: t.faint, opacity: 0.2 } },
          splitArea: { show: false },
        },
        series: [{
          type: "radar",
          data: groups.map(([seriesName, ns]) => ({
            name: seriesName ?? undefined,
            value: alignedData(seriesName, ns).map((d) => (d ? d.value ?? 0 : 0)),
            areaStyle: { opacity: 0.15 },
          })),
        }],
      },
      warnings,
    };
  }

  // bar / bar-h / bar-stacked / line / area — one shared category axis.
  // `axis: "y"` puts the categories down the SIDE, which is the whole point of
  // the horizontal variant, so the two axis definitions are built once and
  // swapped rather than duplicated.
  const categoryAxis = {
    type: "category",
    data: categories,
    axisLabel: { color: t.faint, fontSize: 10, hideOverlap: true },
    axisLine: { lineStyle: { color: t.faint } },
  };
  const valueAxis = {
    type: "value",
    axisLabel: { color: t.faint, fontSize: 10 },
    splitLine: { lineStyle: { color: t.faint, opacity: 0.16 } },
  };
  const horizontal = def.axis === "y";
  const seriesType = def.echarts || def.id;

  return {
    option: {
      ...base,
      grid: { left: 8, right: 12, top: 24, bottom: 8, containLabel: true },
      xAxis: horizontal ? valueAxis : categoryAxis,
      yAxis: horizontal ? categoryAxis : valueAxis,
      legend,
      series: groups.map(([seriesName, ns]) => ({
        type: seriesType,
        name: seriesName ?? undefined,
        data: alignedData(seriesName, ns),
        // A stack needs a shared name to stack ONTO; one constant means every
        // series of this chart stacks together, which is what "parts of a whole"
        // means. Absent, ECharts groups them side by side.
        ...(def.stack ? { stack: "total" } : {}),
        ...(seriesType === "line"
          ? { smooth: true, symbolSize: 6, ...(def.area ? { areaStyle: { opacity: 0.22 } } : {}) }
          : { barMaxWidth: 42 }),
      })),
    },
    warnings,
  };
}
