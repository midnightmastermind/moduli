// The Emotions Wheel's restored spec, measured through the renderer's own
// functions — the behavioural half of migration 0338.
//
// User, 2026-09-18: *"the emotions arent being shown on the third level and the
// graph isnt selecting the emotions. it should be highlighted if selected."*
//
// BOTH HALVES ARE A/B'd AGAINST THE SPEC THAT IS LIVE TODAY — the bare three
// keys `0046` mints — so each assertion is checked to reproduce the user's
// report before it is checked to fix it. Without that control "the slice is
// lit" is also satisfied by a chart that lights everything.
//
// The numbers are not invented here. The outer ring is 80 slices of a FIXED
// 4.5deg (8 core / 40 secondary / 80 tertiary, measured on the live board), and
// the day column renders the wheel at ~330px. A threshold above 4.5 blanks
// every one of those labels, which is precisely what the screenshot shows.
import { describe, it, expect } from "vitest";
import { buildEChartsOption } from "../helpers/graphOption";
import { selectedIdsForDay, derivesSelection } from "../helpers/graphSelection";
import { DEFAULT_VIEW } from "../helpers/graphView";
import { planGraphSpec } from "../../../server/migrations/0338-the-rebuilt-wheel-lost-its-spec.mjs";

const PARENT = "fld-parent", LEVEL = "fld-level", MOOD = "fld-mood", DATE = "fld-date";
const DAY = "2026-09-18";
const LONELY = "occ-lonely";

// EXACTLY what is on the live wheel today, read out of Mongo. It is WRITTEN OUT
// here rather than taken from `0046.buildGraphSpec` on purpose: that builder has
// since been repaired to mint the full spec, so calling it would make the
// control drift into the fix and every A/B below would compare a thing to
// itself. The control has to stay the shape that actually shipped.
const bare = () => ({
  type: "sunburst",
  encoding: { category: null, value: null, parent: PARENT, level: LEVEL },
  literals: [],
});
const restored = () => planGraphSpec(bare(), { dayFieldId: DATE, valueFieldId: MOOD }).next;

// The day column's box, measured off the screenshot. `radialLabelMinAngle`
// takes `min(width, height)`.
const COLUMN_PX = { width: 330, height: 330 };

// One core -> secondary -> tertiary branch is enough: `minAngle` is a property
// of the SERIES, so it either labels the outer ring or it does not.
const nodes = () => [{
  id: "sad", occurrenceId: "occ-sad", name: "Sad", children: [
    { id: "lonely-parent", occurrenceId: "occ-lonely-parent", name: "Lonely", children: [
      { id: LONELY, occurrenceId: LONELY, name: "Isolated", value: 1, children: [] },
    ] },
  ],
}];

const sunburst = (spec, { boxPx = COLUMN_PX, dayKey = null, ids = null } = {}) =>
  buildEChartsOption(spec, nodes(), null, DEFAULT_VIEW, boxPx, dayKey, ids).option.series[0];

// The 80 tertiary slices are 4.5deg each; a threshold at or above that hides
// every label in the ring.
const TERTIARY_DEG = 360 / 80;

describe("the third ring gets its labels back", () => {
  it("the LIVE spec blanks the outer ring at the box a day column gives it", () => {
    // The control — this is the user's screenshot, reproduced as a number.
    expect(sunburst(bare()).label.minAngle).toBeGreaterThan(TERTIARY_DEG);
  });

  it("the restored spec labels it, with margin", () => {
    const minAngle = sunburst(restored()).label.minAngle;
    expect(minAngle).toBeLessThan(TERTIARY_DEG);
    // 0138 chose 6 for ~25% of headroom so a slightly narrower box does not
    // re-blank the ring. Asserted, because "under 4.5" was also true of the
    // value that sat on the cliff.
    expect(minAngle).toBeLessThan(TERTIARY_DEG * 0.8);
  });

  it("shrinks the lettering too — the fit test ECharts applies is the FONT", () => {
    expect(sunburst(restored()).label.fontSize).toBeLessThan(sunburst(bare()).label.fontSize);
  });

  it("still labels the 8 core slices on a phone-sized box", () => {
    // The threshold is clamped so a tiny box cannot blank the 45deg ring — the
    // 2026-08-06 failure this whole mechanism exists to avoid.
    expect(sunburst(restored(), { boxPx: { width: 200, height: 200 } }).label.minAngle).toBeLessThan(45);
  });
});

describe("the picked emotion lights up", () => {
  const rows = [
    // A Check In the op minted: the day on one field, the picked emotion on the
    // other. This is the record the wheel reads — no cache, no second copy.
    { id: "occ-checkin", fields: { [DATE]: { value: DAY }, [MOOD]: { value: [LONELY] } } },
    { id: "occ-other-day", fields: { [DATE]: { value: "2026-09-17" }, [MOOD]: { value: ["occ-hurt"] } } },
  ];

  it("the LIVE spec cannot derive a selection at all", () => {
    // The control: `ContainerGraph` gates the whole highlight on this, which is
    // why clicking recorded a check-in while the wheel stayed dark.
    expect(derivesSelection(bare())).toBe(false);
  });

  it("the restored spec derives today's picks from the day's own rows", () => {
    const spec = restored();
    expect(derivesSelection(spec)).toBe(true);
    const ids = selectedIdsForDay(rows, {
      valueFieldId: spec.valueFieldId, dayFieldId: spec.dayFieldId, day: DAY,
    });
    expect([...ids]).toEqual([LONELY]);
  });

  it("marks that slice selected, and leaves its siblings alone", () => {
    const series = sunburst(restored(), { dayKey: DAY, ids: new Set([LONELY]) });
    const leaf = series.data[0].children[0].children[0];
    expect(leaf.selected).toBe(true);
    expect(leaf.itemStyle.borderWidth).toBeGreaterThan(1);
    expect(series.data[0].selected).toBeUndefined();
  });

  it("lights NOTHING on a day with no picks — per day, not per wheel", () => {
    const spec = restored();
    const ids = selectedIdsForDay(rows, {
      valueFieldId: spec.valueFieldId, dayFieldId: spec.dayFieldId, day: "2026-09-16",
    });
    expect([...ids]).toEqual([]);
    expect(sunburst(spec, { dayKey: "2026-09-16", ids }).data[0].children[0].children[0].selected)
      .toBeUndefined();
  });
});
