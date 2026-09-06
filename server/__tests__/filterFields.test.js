// The grid states what it filters on; this file only reads it.
import { describe, it, expect } from "vitest";
import { filterFieldIdsOf, placementStampFieldIdsOf, withoutPerPlacementFields } from "../utils/filterFields.js";

describe("filterFieldIdsOf", () => {
  it("reads activeFilterValues AND every namedFilter condition", () => {
    const ids = filterFieldIdsOf({
      activeFilterValues: { dateF: "2026-08-29" },
      namedFilters: [
        { conditions: [{ fieldId: "tagsF" }, { fieldId: "dateF" }] },
        { conditions: [{ fieldId: "statusF" }] },
      ],
    });
    expect([...ids].sort()).toEqual(["dateF", "statusF", "tagsF"]);
  });

  it("survives a grid with no filters at all", () => {
    for (const g of [null, undefined, {}, { namedFilters: [{}] }, { namedFilters: [{ conditions: [{}] }] }]) {
      expect(filterFieldIdsOf(g).size).toBe(0);
    }
  });
});

describe("withoutPerPlacementFields", () => {
  const fields = { dateF: { value: "2026-08-29" }, doneF: { value: true } };

  it("drops the filter field and keeps the rest", () => {
    const out = withoutPerPlacementFields(fields, new Set(["dateF"]));
    expect(Object.keys(out)).toEqual(["doneF"]);
  });

  it("returns the ORIGINAL object when nothing was dropped", () => {
    // The common write touches no filter field; it should allocate nothing.
    expect(withoutPerPlacementFields(fields, new Set(["otherF"]))).toBe(fields);
  });

  it("fails OPEN on an unknown or empty set", () => {
    expect(withoutPerPlacementFields(fields, undefined)).toBe(fields);
    expect(withoutPerPlacementFields(fields, new Set())).toBe(fields);
  });

  it("does not mutate the input", () => {
    const copy = JSON.parse(JSON.stringify(fields));
    withoutPerPlacementFields(fields, new Set(["dateF"]));
    expect(fields).toEqual(copy);
  });

  it("returns an empty object when every field was a filter field", () => {
    // The caller uses this to skip the patch entirely rather than writing {}.
    expect(withoutPerPlacementFields({ dateF: { value: 1 } }, new Set(["dateF"]))).toEqual({});
  });
});

// ── Fields an operation stamps FROM the destination container ───────────────
//
// A filter field decides which COLUMN a placement is in. `Time Slot` decides
// which SLOT, and it was still fanning out: on 2026-09-06 all eight members of
// the Todo group were nulled within five seconds at the day rollover — twice in
// one day — because one member's write reached the rest, master included, whose
// value is its IDENTITY (`Schedule: Build Schedule` FINDs the Todo container BY
// it). Derived from the stored pipelines, so nothing here learns what a slot is.
describe("placementStampFieldIdsOf", () => {
  const stampOp = (fid, expr = "$trigger.containerLabel") => ({
    pipeline: { steps: [
      { id: "s1", type: "action", config: { type: "UPDATE", path: `$item.fields.${fid}.value`, value: expr } },
    ]},
  });

  it("finds a field stamped from the destination container", () => {
    expect([...placementStampFieldIdsOf([stampOp("f-slot")])]).toEqual(["f-slot"]);
  });

  it("finds one nested inside branches and loops", () => {
    // The real op buries the stamp two ifs deep; a top-level-only scan would
    // find nothing and the guard would be silently inert.
    const op = { pipeline: { steps: [
      { type: "if", condition: {}, then: [
        { type: "loop", body: [
          { type: "action", config: { type: "UPDATE", path: "$item.fields.f-slot.value", value: "$trigger.containerLabel" } },
        ]},
      ], else: [] },
    ]}};
    expect([...placementStampFieldIdsOf([op])]).toEqual(["f-slot"]);
  });

  it("ignores a write whose value does NOT come from the destination", () => {
    // THE CONTROL. Without it the rule would be "any field an op writes",
    // which is most of the grid — and the fan-out would stop sharing
    // `Completed`, the thing copy-links exist for.
    const op = { pipeline: { steps: [
      { type: "action", config: { type: "UPDATE", path: "$item.fields.f-done.value", value: true } },
      { type: "action", config: { type: "UPDATE", path: "$item.fields.f-date.value", value: "$today" } },
    ]}};
    expect(placementStampFieldIdsOf([op]).size).toBe(0);
  });

  it("returns an empty set for no operations, and for a pipeline-less op", () => {
    expect(placementStampFieldIdsOf([]).size).toBe(0);
    expect(placementStampFieldIdsOf([{ name: "x" }]).size).toBe(0);
  });
});

describe("withoutPerPlacementFields — several sources", () => {
  it("drops a key present in ANY set", () => {
    const out = withoutPerPlacementFields(
      { "f-date": 1, "f-slot": 2, "f-done": 3 },
      new Set(["f-date"]), new Set(["f-slot"]));
    expect(Object.keys(out)).toEqual(["f-done"]);
  });

  it("fails OPEN when every set is empty", () => {
    // Same call as the original: an unknown set must not stop the sync this
    // feature exists for. A group that stops sharing `Completed` is a worse
    // failure than one that shares a slot.
    const fields = { "f-done": 3 };
    expect(withoutPerPlacementFields(fields, new Set(), undefined)).toBe(fields);
  });
});
