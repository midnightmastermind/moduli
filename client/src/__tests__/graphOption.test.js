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
