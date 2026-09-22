// THE CHART SAYS WHAT IT COULD NOT DRAW.
//
// A chart has two layers that can each discard something:
//
//   buildGraphData      a ROW contributed nothing        {occurrenceId, why}
//   buildEChartsOption  the TYPE ignored an encoding,    "…" (a plain string)
//                       a level was flattened away, or
//                       two rows shared a name and only
//                       the first was drawn
//
// `GraphSection` (the editor) merged both, and said why in its own comment:
// "BOTH HALVES WARN, and the readout is worthless if it only hears one … those
// are precisely the failures that still LOOK like a chart."
//
// THE CHART ITSELF HEARD ONLY ONE. `ContainerGraph` destructured `option` from
// `buildEChartsOption` and dropped its `warnings`. Measured on prod 2026-09-22,
// a bar chart over 3 rows (2 "meal", 1 "ingredient") with Label = Board
// Category:
//
//   drawn            meal = 1, ingredient = 1     <- a whole row discarded
//   warning emitted  'two rows share the name "meal" — only the first is drawn'
//   chip on screen   .container-graph-warnings  count 0
//
// So the honest signal was computed, the editor could show it, and the surface
// the user looks at threw it away.
import { describe, it, expect } from "vitest";
import { mergeGraphWarnings, summariseGraphWarnings } from "../helpers/graphWarnings";

describe("mergeGraphWarnings", () => {
  it("hears BOTH halves, whatever shape they arrive in", () => {
    const merged = mergeGraphWarnings(
      [{ occurrenceId: "o1", why: "no value" }],
      ['two rows share the name "meal" — only the first is drawn'],
    );
    expect(merged).toHaveLength(2);
    expect(merged[1]).toEqual({ occurrenceId: null, why: 'two rows share the name "meal" — only the first is drawn' });
  });

  it("passes an already-shaped draw warning through untouched", () => {
    const w = { occurrenceId: "o9", why: "already an object" };
    expect(mergeGraphWarnings([], [w])[0]).toBe(w);
  });

  it("survives either side being absent", () => {
    expect(mergeGraphWarnings()).toEqual([]);
    expect(mergeGraphWarnings(null, null)).toEqual([]);
    expect(mergeGraphWarnings([{ occurrenceId: "o1", why: "x" }])).toHaveLength(1);
  });
});

describe("summariseGraphWarnings", () => {
  it("counts rows and chart issues SEPARATELY", () => {
    // Lumping them under "N rows" would be a lie the moment a non-row warning
    // appears — which is the whole class this merge exists to surface.
    const merged = mergeGraphWarnings(
      [{ occurrenceId: "o1", why: "no value" }, { occurrenceId: "o2", why: "no value" }],
      ["a label field is ignored by a pie chart"],
    );
    expect(summariseGraphWarnings(merged)).toBe("2 rows contributed nothing · 1 chart issue");
  });

  it("says only what applies", () => {
    expect(summariseGraphWarnings(mergeGraphWarnings([{ occurrenceId: "o1", why: "x" }], [])))
      .toBe("1 row contributed nothing");
    expect(summariseGraphWarnings(mergeGraphWarnings([], ["x", "y"])))
      .toBe("2 chart issues");
    expect(summariseGraphWarnings([])).toBe("");
  });
});

describe("the chart surface is wired to it", () => {
  const read = async (rel) => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = (await import("node:path")).default;
    const here = path.dirname(fileURLToPath(import.meta.url));
    return readFileSync(path.join(here, "..", ...rel.split("/")), "utf8");
  };

  it("ContainerGraph keeps the option-layer warnings instead of dropping them", async () => {
    const src = await read("modules/containers/ContainerGraph.jsx");
    // CONTROL — the chart still builds an option and still renders a chip, or
    // "it no longer drops warnings" would also pass against a deleted feature.
    expect(src).toContain("buildEChartsOption(");
    expect(src).toContain("container-graph-warnings");
    expect(src).toContain("mergeGraphWarnings(");
    expect(src, "the option's warnings are being discarded again")
      .not.toMatch(/const \{\s*option\s*\}\s*=\s*useMemo/);
  });

  it("the editor uses the SAME merge, so the two cannot drift apart", async () => {
    const src = await read("ui/GraphSection.jsx");
    expect(src).toContain("mergeGraphWarnings(");
    // The inline copy it used to carry.
    expect(src, "GraphSection is normalising the other layer's shape by hand again")
      .not.toContain('typeof w === "string" ? { occurrenceId: null, why: w }');
  });
});
