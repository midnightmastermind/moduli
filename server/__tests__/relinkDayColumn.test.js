// server/__tests__/relinkDayColumn.test.js
import { describe, it, expect } from "vitest";
import {
  slotMinutes, orderDayColumnChildren, patchRelinkIntoPipeline,
} from "../migrations/0036-relink-day-column-slots.mjs";

describe("slotMinutes", () => {
  it("parses 12-hour slot labels", () => {
    expect(slotMinutes("12:00am")).toBe(0);
    expect(slotMinutes("6:30am")).toBe(390);
    expect(slotMinutes("12:00pm")).toBe(720);
    expect(slotMinutes("11:30pm")).toBe(1410);
  });

  it("returns null for anything that is not a slot label", () => {
    expect(slotMinutes("Due")).toBeNull();
    expect(slotMinutes("Todo")).toBeNull();
    expect(slotMinutes("")).toBeNull();
    expect(slotMinutes(null)).toBeNull();
  });
});

describe("orderDayColumnChildren", () => {
  it("puts the heads first, then slots in CLOCK order", () => {
    // The bug rendered a day starting at 7:00am; ordering has to put the
    // early-morning slots back at the top, not append them where they were found.
    const ordered = orderDayColumnChildren([
      { id: "s7", label: "7:00am" },
      { id: "todo", label: "Todo" },
      { id: "s12", label: "12:00am" },
      { id: "due", label: "Due" },
      { id: "s23", label: "11:30pm" },
      { id: "s6", label: "6:30am" },
    ]);
    expect(ordered).toEqual(["due", "todo", "s12", "s6", "s7", "s23"]);
  });

  it("sorts 12am/12pm correctly rather than lexically", () => {
    const ordered = orderDayColumnChildren([
      { id: "noon", label: "12:00pm" },
      { id: "mid", label: "12:00am" },
      { id: "one", label: "1:00am" },
    ]);
    expect(ordered).toEqual(["mid", "one", "noon"]);
  });

  it("keeps unknown children (user content) rather than dropping them", () => {
    const ordered = orderDayColumnChildren([
      { id: "x", label: "Some dropped task" },
      { id: "s1", label: "1:00am" },
    ]);
    expect(ordered).toEqual(["s1", "x"]);
  });
});

describe("patchRelinkIntoPipeline", () => {
  const pipelineWithSlotCheck = () => ({
    steps: [{
      type: "loop", body: [{
        type: "if",
        condition: { rules: [{ left: "$slotCopyId", comparator: "IS_EMPTY", right: "" }] },
        then: [{ type: "action", config: { type: "COPY_LINK" } }],
        else: [],
      }],
    }],
  });

  it("adds ADD_CHILD to the slot-exists branch", () => {
    const p = pipelineWithSlotCheck();
    expect(patchRelinkIntoPipeline(p, () => "id1")).toBe(1);
    const els = p.steps[0].body[0].else;
    expect(els).toHaveLength(1);
    expect(els[0].config).toMatchObject({
      type: "ADD_CHILD", parentId: "$dayColId", childId: "$slotCopyId",
    });
  });

  it("is idempotent — a second run patches nothing", () => {
    const p = pipelineWithSlotCheck();
    patchRelinkIntoPipeline(p, () => "id1");
    expect(patchRelinkIntoPipeline(p, () => "id2")).toBe(0);
    expect(p.steps[0].body[0].else).toHaveLength(1);
  });

  it("leaves unrelated IF branches alone", () => {
    const p = { steps: [{
      type: "if",
      condition: { rules: [{ left: "$dayColId", comparator: "IS_EMPTY", right: "" }] },
      then: [], else: [],
    }] };
    expect(patchRelinkIntoPipeline(p, () => "id1")).toBe(0);
    expect(p.steps[0].else).toEqual([]);
  });

  it("preserves an existing else branch instead of replacing it", () => {
    const p = pipelineWithSlotCheck();
    p.steps[0].body[0].else = [{ type: "action", config: { type: "SET_VAR", name: "$x" } }];
    patchRelinkIntoPipeline(p, () => "id1");
    const els = p.steps[0].body[0].else;
    expect(els).toHaveLength(2);
    expect(els[0].config.type).toBe("SET_VAR");
    expect(els[1].config.type).toBe("ADD_CHILD");
  });

  it("no-ops on an empty pipeline", () => {
    expect(patchRelinkIntoPipeline({}, () => "id1")).toBe(0);
    expect(patchRelinkIntoPipeline({ steps: [] }, () => "id1")).toBe(0);
  });
});
