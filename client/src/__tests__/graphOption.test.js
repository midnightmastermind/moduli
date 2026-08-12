// helpers/graphOption — spec + data → an ECharts `option` object.
//
// Isolating this is what makes chart-type support testable without rendering
// anything. The contract that matters most: EVERY DATUM CARRIES ITS
// occurrenceId, because the spike proved an arbitrary key attached to a datum
// survives onto the click event — that is what lets a click resolve back to an
// occurrence with no index-to-occurrence table to keep in sync.
import { describe, it, expect } from "vitest";
import { buildEChartsOption, CHART_TYPES, BLUR_ITEM_OPACITY, SUNBURST_LABEL_COLOR } from "../helpers/graphOption";

const NODES = [
  { id: "a", occurrenceId: "occ-a", name: "Angry", value: 8, series: null, children: [], depth: 0 },
  { id: "b", occurrenceId: "occ-b", name: "Sad", value: 3, series: null, children: [], depth: 0 },
];
const NESTED = [
  {
    id: "a", occurrenceId: "occ-a", name: "Angry", value: undefined, series: null, depth: 0,
    children: [
      { id: "b", occurrenceId: "occ-b", name: "Frustrated", value: undefined, series: null, depth: 1,
        children: [{ id: "c", occurrenceId: "occ-c", name: "Annoyed", value: 1, series: null, children: [], depth: 2 }] },
    ],
  },
];

const seriesOf = (opt) => (Array.isArray(opt.series) ? opt.series : [opt.series]);

describe("buildEChartsOption — chart types", () => {
  it("builds a SUNBURST that keeps the nesting", () => {
    const { option } = buildEChartsOption({ type: "sunburst" }, NESTED);
    const s = seriesOf(option)[0];
    expect(s.type).toBe("sunburst");
    expect(s.data[0].name).toBe("Angry");
    expect(s.data[0].children[0].children[0].name).toBe("Annoyed");
  });

  it("DISABLES ECharts' node navigation — a click selects, it must not re-root", () => {
    // Regression, found only by a browser harness (2026-08-06): the sunburst
    // default is nodeClick "rootToNode", so ONE click on a leaf replaced the
    // entire wheel with that node. For a feeling wheel that is fatal — picking
    // an emotion would zoom the chart away instead of recording a mood.
    // Verified in a real browser after the fix: the wheel stays intact
    // (180,919 → 180,900 painted px) and our own onSelect still fires with the
    // full ancestor path, because the click EVENT is a separate channel.
    const { option } = buildEChartsOption({ type: "sunburst" }, NESTED);
    expect(seriesOf(option)[0].nodeClick).toBe(false);
  });

  it("labels the OUTER RING of a real wheel — minAngle must not blank it", () => {
    // Regression, and the second defect a screenshot caught that no metric
    // could (2026-08-06). `label.minAngle` HIDES the label of any slice
    // narrower than N degrees. It was 8; the real 128-node emotions wheel has
    // 80 tertiary leaves at 360/80 = 4.5° each, so all 80 were blanked and the
    // whole outer ring rendered with no text — while roots, warnings and
    // painted pixels all still read fine. The bound below is that arc.
    const OUTER_LEAVES = 80;
    const { option } = buildEChartsOption({ type: "sunburst" }, NESTED);
    expect(seriesOf(option)[0].label.minAngle).toBeLessThan(360 / OUTER_LEAVES);
  });

  it("focuses the ancestor branch on hover/select, so a pick reads as a pick", () => {
    const { option } = buildEChartsOption({ type: "sunburst" }, NESTED);
    expect(seriesOf(option)[0].emphasis).toMatchObject({ focus: "ancestor" });
  });

  it("applies the VIEW to a sunburst — radius scales, centre moves", () => {
    // The graph fills its container and is zoomed rather than shrunk to fit a
    // phone (user, 2026-08-06). ECharts resolves percent radius/centre against
    // the host box itself, so the whole zoom model is two numbers on the series
    // and this file never learns the container's size.
    const { option } = buildEChartsOption({ type: "sunburst" }, NESTED, null, { zoom: 2, cx: 30, cy: 70 });
    const s = seriesOf(option)[0];
    expect(s.radius).toEqual([0, "184%"]);      // 92 × 2
    expect(s.center).toEqual(["30%", "70%"]);
  });

  it("leaves an unzoomed chart exactly where it was", () => {
    // No view (the common case) must be byte-identical to the default view, or
    // every chart with no stored zoom would render subtly differently.
    const plain = seriesOf(buildEChartsOption({ type: "sunburst" }, NESTED).option)[0];
    const unit = seriesOf(buildEChartsOption({ type: "sunburst" }, NESTED, null, { zoom: 1, cx: 50, cy: 50 }).option)[0];
    expect(plain.radius).toEqual(unit.radius);
    expect(plain.center).toEqual(unit.center);
  });

  it("clamps a stored view that is out of range instead of trusting it", () => {
    // `meta.graph` is user-editable data; a bad zoom must degrade, not blank
    // the surface — the same posture as the unknown-chart-type fallback.
    const { option } = buildEChartsOption({ type: "sunburst" }, NESTED, null, { zoom: 9999, cx: -500, cy: 0 });
    const s = seriesOf(option)[0];
    expect(s.radius[1]).toBe(`${92 * 12}%`);
    expect(s.center[0]).toBe("-456%");          // 50 - 46*(12-1)
  });

  it("zooms a PIE too — it is the same radial surface", () => {
    const { option } = buildEChartsOption({ type: "pie" }, NODES, null, { zoom: 2, cx: 50, cy: 50 });
    expect(seriesOf(option)[0].radius).toEqual(["76%", "144%"]);
  });

  it("builds a PIE", () => {
    const { option } = buildEChartsOption({ type: "pie" }, NODES);
    const s = seriesOf(option)[0];
    expect(s.type).toBe("pie");
    expect(s.data.map(d => d.name)).toEqual(["Angry", "Sad"]);
    expect(s.data.map(d => d.value)).toEqual([8, 3]);
  });

  it("builds a BAR with a category axis from the node names", () => {
    const { option } = buildEChartsOption({ type: "bar" }, NODES);
    expect(option.xAxis.type).toBe("category");
    expect(option.xAxis.data).toEqual(["Angry", "Sad"]);
    expect(option.yAxis.type).toBe("value");
    expect(seriesOf(option)[0].type).toBe("bar");
  });

  it("builds a LINE on the same axes as bar", () => {
    const { option } = buildEChartsOption({ type: "line" }, NODES);
    expect(seriesOf(option)[0].type).toBe("line");
    expect(option.xAxis.data).toEqual(["Angry", "Sad"]);
  });

  it("exposes the supported types so the editor never guesses", () => {
    expect(CHART_TYPES.map(t => t.id)).toEqual(expect.arrayContaining(["sunburst", "pie", "bar", "line"]));
    for (const t of CHART_TYPES) expect(typeof t.label).toBe("string");
  });
});

describe("buildEChartsOption — every datum resolves back to an occurrence", () => {
  it("carries occurrenceId on FLAT data", () => {
    const { option } = buildEChartsOption({ type: "pie" }, NODES);
    expect(seriesOf(option)[0].data.map(d => d.occurrenceId)).toEqual(["occ-a", "occ-b"]);
  });

  it("carries occurrenceId at EVERY LEVEL of nested data", () => {
    const { option } = buildEChartsOption({ type: "sunburst" }, NESTED);
    const root = seriesOf(option)[0].data[0];
    expect(root.occurrenceId).toBe("occ-a");
    expect(root.children[0].occurrenceId).toBe("occ-b");
    expect(root.children[0].children[0].occurrenceId).toBe("occ-c");
  });

  it("carries a NULL occurrenceId for a hardcoded literal, so a click knows there is nothing to open", () => {
    const withLiteral = [...NODES, { id: "literal-0", occurrenceId: null, name: "Target", value: 10, series: null, children: [], depth: 0 }];
    const { option } = buildEChartsOption({ type: "bar" }, withLiteral);
    const last = seriesOf(option)[0].data.at(-1);
    expect(last.occurrenceId).toBe(null);
    expect(last.value).toBe(10);
  });
});

describe("buildEChartsOption — the OPERATION controls the highlight", () => {
  // User 2026-08-06: "we should be able to highlight that portion of the graph
  // with the operation too … cause the system shouldnt know its a feelings
  // wheel … we control what it does through the operation".
  //
  // So highlight is DATA an op writes to `meta.graph.highlight` through the
  // ordinary UPDATE path. The graph renders it and never decides it — which is
  // what keeps "the picked feeling stays lit" from meaning the renderer knows
  // what a feeling is.
  it("marks the occurrences an op named, and only those", () => {
    const { option } = buildEChartsOption({ type: "pie", highlight: ["occ-a"] }, NODES);
    const [a, b] = seriesOf(option)[0].data;
    expect(a.selected).toBe(true);
    expect(b.selected).toBeUndefined();
  });

  it("marks at ANY DEPTH of a nested chart — a tertiary emotion is markable", () => {
    const { option } = buildEChartsOption({ type: "sunburst", highlight: ["occ-c"] }, NESTED);
    const root = seriesOf(option)[0].data[0];
    expect(root.selected).toBeUndefined();
    expect(root.children[0].children[0].selected).toBe(true);
  });

  it("accepts several ids — a multiselect mood can light more than one", () => {
    const { option } = buildEChartsOption({ type: "pie", highlight: ["occ-a", "occ-b"] }, NODES);
    expect(seriesOf(option)[0].data.every(d => d.selected === true)).toBe(true);
  });

  it("accepts a BARE id, not just a list", () => {
    const { option } = buildEChartsOption({ type: "pie", highlight: "occ-b" }, NODES);
    expect(seriesOf(option)[0].data[1].selected).toBe(true);
  });

  it("marks nothing when no op has written a highlight", () => {
    const { option } = buildEChartsOption({ type: "pie" }, NODES);
    expect(seriesOf(option)[0].data.some(d => d.selected)).toBe(false);
  });

  it("ignores a highlight naming something not on the chart, without throwing", () => {
    const { option } = buildEChartsOption({ type: "pie", highlight: ["nope", null, 7] }, NODES);
    expect(seriesOf(option)[0].data.some(d => d.selected)).toBe(false);
  });

  it("works on BAR too — highlight is not a sunburst feature", () => {
    const { option } = buildEChartsOption({ type: "bar", highlight: ["occ-b"] }, NODES);
    const data = seriesOf(option)[0].data;
    expect(data.find(d => d.occurrenceId === "occ-b").selected).toBe(true);
  });
});

describe("buildEChartsOption — series splitting", () => {
  it("splits into one ECharts series per series value", () => {
    const nodes = [
      { id: "a", occurrenceId: "occ-a", name: "Mon", value: 1, series: "wk1", children: [], depth: 0 },
      { id: "b", occurrenceId: "occ-b", name: "Tue", value: 2, series: "wk2", children: [], depth: 0 },
      { id: "c", occurrenceId: "occ-c", name: "Wed", value: 3, series: "wk1", children: [], depth: 0 },
    ];
    const { option } = buildEChartsOption({ type: "bar" }, nodes);
    const s = seriesOf(option);
    expect(s).toHaveLength(2);
    expect(s.map(x => x.name)).toEqual(["wk1", "wk2"]);
  });

  // THE DISCRIMINATING ONE. An ECharts category axis places data BY INDEX — a
  // datum's `name` is decoration. Before 2026-08-10 each series carried only its
  // own rows, so wk1's Wed(3) sat at index 1 and was drawn under TUESDAY, and
  // wk2's single Tue(2) was drawn under MONDAY. Fully populated, silently wrong.
  // Asserting per CATEGORY is what makes this fail against the unpadded version.
  it("aligns every series to the SHARED category axis, padding gaps with null", () => {
    const nodes = [
      { id: "a", occurrenceId: "occ-a", name: "Mon", value: 1, series: "wk1", children: [], depth: 0 },
      { id: "b", occurrenceId: "occ-b", name: "Tue", value: 2, series: "wk2", children: [], depth: 0 },
      { id: "c", occurrenceId: "occ-c", name: "Wed", value: 3, series: "wk1", children: [], depth: 0 },
    ];
    const { option } = buildEChartsOption({ type: "bar" }, nodes);
    const categories = option.xAxis.data;
    const at = (series, cat) => series.data[categories.indexOf(cat)];
    const [wk1, wk2] = seriesOf(option);

    expect(wk1.data).toHaveLength(categories.length);
    expect(wk2.data).toHaveLength(categories.length);
    expect(at(wk1, "Mon").value).toBe(1);
    expect(at(wk1, "Wed").value).toBe(3);
    expect(at(wk1, "Tue")).toBeNull();          // wk1 has no Tuesday row
    expect(at(wk2, "Tue").value).toBe(2);
    expect(at(wk2, "Mon")).toBeNull();
  });

  it("stays a SINGLE series when nothing carries a series value", () => {
    const { option } = buildEChartsOption({ type: "bar" }, NODES);
    expect(seriesOf(option)).toHaveLength(1);
  });

  it("keeps the first of two rows sharing a name, and SAYS it dropped one", () => {
    // A category axis has one slot per name. Summing would be inventing an
    // aggregate this file does not do; going silent would lose a row.
    const nodes = [
      { id: "a", occurrenceId: "occ-a", name: "Mon", value: 1, children: [], depth: 0 },
      { id: "b", occurrenceId: "occ-b", name: "Mon", value: 9, children: [], depth: 0 },
    ];
    const { option, warnings } = buildEChartsOption({ type: "bar" }, nodes);
    expect(seriesOf(option)[0].data.map((d) => d && d.value)).toEqual([1]);
    expect(warnings.join(" ")).toMatch(/two rows share the name "Mon"/);
  });
});

describe("buildEChartsOption — a flat chart picks a LEVEL of a hierarchy", () => {
  const tree = [{
    id: "r", occurrenceId: "occ-r", name: "Mad", value: 1, depth: 0,
    children: [{ id: "k", occurrenceId: "occ-k", name: "Hurt", value: 2, children: [], depth: 1 }],
  }];

  it("defaults to the deepest level — and warns that a grouping row was dropped", () => {
    // Unchanged behaviour, now stated. Switching the emotions wheel to a pie
    // discards its primary and secondary rings; that must not be silent.
    const { option, warnings } = buildEChartsOption({ type: "pie" }, tree);
    expect(option.series[0].data.map((d) => d.name)).toEqual(["Hurt"]);
    expect(warnings.join(" ")).toMatch(/1 grouping row not drawn/);
  });

  it("draws the TOP level only when asked, and warns about nothing", () => {
    const spec = { type: "pie", encoding: { flatten: "roots" } };
    const { option, warnings } = buildEChartsOption(spec, tree);
    expect(option.series[0].data.map((d) => d.name)).toEqual(["Mad"]);
    expect(warnings).toEqual([]);
  });

  it("draws EVERY level when asked", () => {
    const spec = { type: "pie", encoding: { flatten: "all" } };
    const { option } = buildEChartsOption(spec, tree);
    expect(option.series[0].data.map((d) => d.name)).toEqual(["Mad", "Hurt"]);
  });

  it("an unrecognised mode degrades to the default rather than drawing nothing", () => {
    const spec = { type: "pie", encoding: { flatten: "sideways" } };
    const { option } = buildEChartsOption(spec, tree);
    expect(option.series[0].data.map((d) => d.name)).toEqual(["Hurt"]);
  });
});

describe("buildEChartsOption — an encoding the type ignores is REPORTED", () => {
  it("warns that a pie ignores Split by — the dead control this table exists for", () => {
    const spec = { type: "pie", encoding: { series: "f-week" } };
    const { warnings } = buildEChartsOption(spec, NODES);
    expect(warnings.join(" ")).toMatch(/"series" is ignored by a pie chart/);
  });

  it("warns that a bar ignores a parent field, and does NOT warn about one it reads", () => {
    // The discriminating half: a blanket warning would be noise on every chart.
    const spec = { type: "bar", encoding: { parent: "f-parent", series: "f-week" } };
    const { warnings } = buildEChartsOption(spec, NODES);
    expect(warnings.join(" ")).toMatch(/"parent" is ignored/);
    expect(warnings.join(" ")).not.toMatch(/"series" is ignored/);
  });

  it("says nothing when every configured encoding is read", () => {
    const spec = { type: "sunburst", encoding: { parent: "f-parent", category: "f-name" } };
    expect(buildEChartsOption(spec, NODES).warnings).toEqual([]);
  });
});

describe("buildEChartsOption — a bad stored spec must not blank the page", () => {
  it("falls back with a WARNING on an unknown chart type, never throws", () => {
    const { option, warnings } = buildEChartsOption({ type: "hexaflexagon" }, NODES);
    expect(seriesOf(option)[0].type).toBe("bar");
    expect(warnings.some(w => /hexaflexagon/.test(w))).toBe(true);
  });

  it("handles an EMPTY data set without throwing", () => {
    for (const type of ["sunburst", "pie", "bar", "line"]) {
      const { option } = buildEChartsOption({ type }, []);
      expect(seriesOf(option)[0].data).toEqual([]);
    }
  });

  it("handles a null spec and null data", () => {
    expect(() => buildEChartsOption(null, null)).not.toThrow();
    const { option } = buildEChartsOption(null, null);
    expect(seriesOf(option)[0].data).toEqual([]);
  });
});

describe("buildEChartsOption — theming", () => {
  it("takes its palette from the caller, so charts follow the app's theme", () => {
    const theme = { text: "#abcdef", palette: ["#111111", "#222222"] };
    const { option } = buildEChartsOption({ type: "pie" }, NODES, theme);
    expect(option.color).toEqual(["#111111", "#222222"]);
    expect(JSON.stringify(option)).toContain("#abcdef");
  });

  it("never paints its own background — the surface owns that", () => {
    const { option } = buildEChartsOption({ type: "pie" }, NODES);
    expect(option.backgroundColor).toBe("transparent");
  });
});

// ── the types added 2026-08-10 ──────────────────────────────────────────────
// User: "make sure we can do other kinds of graphs as well". These assert the
// two things a new type can silently get wrong: the ECharts series TYPE it emits
// (an id like "bar-h" is ours, not the library's), and whether it still honours
// the contracts every other type keeps — a datum carrying its occurrenceId, and
// series aligned to the shared category axis.
describe("buildEChartsOption — the added chart types", () => {
  const SPLIT = [
    { id: "a", occurrenceId: "occ-a", name: "Mon", value: 1, series: "wk1", children: [], depth: 0 },
    { id: "b", occurrenceId: "occ-b", name: "Tue", value: 2, series: "wk2", children: [], depth: 0 },
  ];

  it("every declared type builds an option and names a real ECharts series type", () => {
    // The guard against adding a type to the table and forgetting the branch:
    // an id we invented ("bar-h") must never reach ECharts as a series type.
    const REAL = new Set(["sunburst", "treemap", "pie", "bar", "line", "radar"]);
    for (const t of CHART_TYPES) {
      const { option } = buildEChartsOption({ type: t.id }, NODES);
      for (const s of seriesOf(option)) {
        expect(REAL.has(s.type), `${t.id} emitted series type "${s.type}"`).toBe(true);
      }
    }
  });

  it("horizontal bar puts the CATEGORIES on the y axis — the whole reason it exists", () => {
    const { option } = buildEChartsOption({ type: "bar-h" }, NODES);
    expect(option.yAxis.type).toBe("category");
    expect(option.yAxis.data).toEqual(["Angry", "Sad"]);
    expect(option.xAxis.type).toBe("value");
    expect(seriesOf(option)[0].type).toBe("bar");
  });

  it("plain bar keeps the categories on the x axis — the horizontal variant is not a silent swap", () => {
    const { option } = buildEChartsOption({ type: "bar" }, NODES);
    expect(option.xAxis.type).toBe("category");
    expect(option.yAxis.type).toBe("value");
  });

  it("stacked bar stacks its series together, and plain bar does NOT", () => {
    const stacked = buildEChartsOption({ type: "bar-stacked" }, SPLIT).option;
    expect(seriesOf(stacked).map((s) => s.stack)).toEqual(["total", "total"]);
    const grouped = buildEChartsOption({ type: "bar" }, SPLIT).option;
    expect(seriesOf(grouped).every((s) => s.stack === undefined)).toBe(true);
  });

  it("area is a line WITH a fill, and line is the same line WITHOUT one", () => {
    const area = seriesOf(buildEChartsOption({ type: "area" }, NODES).option)[0];
    expect(area.type).toBe("line");
    expect(area.areaStyle).toBeTruthy();
    expect(seriesOf(buildEChartsOption({ type: "line" }, NODES).option)[0].areaStyle).toBeUndefined();
  });

  it("the added axis types still align every series to the shared categories", () => {
    // The 2026-08-10 misalignment must not come back through a new type.
    for (const type of ["bar-h", "bar-stacked", "area"]) {
      const { option } = buildEChartsOption({ type }, SPLIT);
      const cats = (option.xAxis.type === "category" ? option.xAxis : option.yAxis).data;
      for (const s of seriesOf(option)) expect(s.data).toHaveLength(cats.length);
    }
  });

  it("treemap draws the hierarchy and REFUSES to drill on click", () => {
    // Same family of library default that made a sunburst click re-root the
    // wheel instead of recording a mood. A click selects; it must not navigate.
    const { option } = buildEChartsOption({ type: "treemap" }, NESTED);
    const s = seriesOf(option)[0];
    expect(s.type).toBe("treemap");
    expect(s.nodeClick).toBe(false);
    expect(s.data[0].name).toBe("Angry");
    expect(s.data[0].children[0].name).toBe("Frustrated");
  });

  it("treemap keeps the occurrenceId on every level — a click resolves to a row", () => {
    const s = seriesOf(buildEChartsOption({ type: "treemap" }, NESTED).option)[0];
    expect(s.data[0].occurrenceId).toBe("occ-a");
    expect(s.data[0].children[0].children[0].occurrenceId).toBe("occ-c");
  });

  it("treemap reads a hierarchy encoding rather than warning about it", () => {
    // It is the sunburst's data read the other way, so switching between the two
    // must not report the parent field as ignored.
    const spec = { type: "treemap", encoding: { parent: "f-parent" } };
    expect(buildEChartsOption(spec, NESTED).warnings).toEqual([]);
  });

  it("radar builds one spoke per category and one polygon per series", () => {
    const { option } = buildEChartsOption({ type: "radar" }, SPLIT);
    expect(option.radar.indicator.map((i) => i.name)).toEqual(["Mon", "Tue"]);
    const data = seriesOf(option)[0].data;
    expect(data.map((d) => d.name)).toEqual(["wk1", "wk2"]);
    // Aligned to the spokes, and a series with no row for a spoke reads 0 rather
    // than shifting its polygon — the radar form of the alignment fix.
    expect(data[0].value).toEqual([1, 0]);
    expect(data[1].value).toEqual([0, 2]);
  });

  it("radar gives every spoke the SAME REAL max, so the shape means something", () => {
    // Asserting only "they are all equal" is VACUOUS — all-undefined is also a
    // set of one, and an A/B against `max = undefined` passed against it. The
    // number has to be pinned: per-spoke maxes would normalise every measure to
    // the same radius and make the polygon a lie.
    const { option } = buildEChartsOption({ type: "radar" }, SPLIT);   // values 1 and 2
    expect(option.radar.indicator.map((i) => i.max)).toEqual([2, 2]);
  });

  it("radar floors its max at 1, so an all-zero set still draws axes", () => {
    const zeros = SPLIT.map((n) => ({ ...n, value: 0 }));
    const { option } = buildEChartsOption({ type: "radar" }, zeros);
    expect(option.radar.indicator.every((i) => i.max === 1)).toBe(true);
  });

  // ── The wheel must not get HARDER to read when you point at it ────────────
  // `focus: "ancestor"` blurs every non-ancestor slice. Twice now that has cost
  // readability: first the LABEL faded with it, then the slice itself faded so
  // far that black lettering on a washed-out slice was unreadable anyway
  // (user, 2026-08-12: "the hover of the wheel makes all the ones thats not lit
  // up, too dim to read"). Both halves are pinned here.
  describe("sunburst hover states stay readable", () => {
    const NESTED = [
      { name: "Angry", occurrenceId: "a", children: [
        { name: "Envious", occurrenceId: "b", value: 1 },
      ] },
    ];
    const sun = () => buildEChartsOption({ type: "sunburst" }, NESTED).option.series[0];

    it("does not fade a non-focused slice below readability", () => {
      // 0.45 shipped and was the reported defect. The floor is what this test
      // is really about — the exact value above it is a taste call.
      expect(sun().blur.itemStyle.opacity).toBeGreaterThanOrEqual(0.8);
      expect(BLUR_ITEM_OPACITY).toBeGreaterThanOrEqual(0.8);
    });

    it("pins the label opaque and black in EVERY interaction state", () => {
      const s = sun();
      for (const state of ["emphasis", "blur", "select"]) {
        expect(s[state].label.opacity).toBe(1);
        expect(s[state].label.color).toBe(SUNBURST_LABEL_COLOR);
      }
    });

    it("still emphasises the ancestor path — the hint is not removed, only softened", () => {
      expect(sun().emphasis.focus).toBe("ancestor");
    });
  });
});
