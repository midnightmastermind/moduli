// helpers/graphOption — spec + data → an ECharts `option` object.
//
// Isolating this is what makes chart-type support testable without rendering
// anything. The contract that matters most: EVERY DATUM CARRIES ITS
// occurrenceId, because the spike proved an arbitrary key attached to a datum
// survives onto the click event — that is what lets a click resolve back to an
// occurrence with no index-to-occurrence table to keep in sync.
import { describe, it, expect } from "vitest";
import { buildEChartsOption, CHART_TYPES } from "../helpers/graphOption";

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
    expect(s[0].data.map(d => d.value)).toEqual([1, 3]);
  });

  it("stays a SINGLE series when nothing carries a series value", () => {
    const { option } = buildEChartsOption({ type: "bar" }, NODES);
    expect(seriesOf(option)).toHaveLength(1);
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
