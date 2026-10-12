// 0395: Fill Day stops naming the Schedule Template page and loops over every container instead
// (the eight weekday templates are the only containers holding a Weekday value).
import { describe, it, expect } from "vitest";
import { repointFillDay } from "../migrations/0395-a-page-per-schedule-template.mjs";

const steps = [
  { type: "action", config: { type: "INIT_VAR", name: "$stPage", expr: "$allItemsById.P" } },
  { type: "action", config: { type: "INIT_VAR", name: "$stPageId", expr: "$allItemsById.P.id" } },
  { type: "action", config: { type: "INIT_VAR", name: "$schedPage", expr: "$allItemsById.S" } },
  { type: "if", then: [{ type: "loop", overExpr: "$activePeriodDates", as: "$day", body: [
    { type: "loop", overExpr: "$stPage.occurrences", as: "$wdTplId", body: [
      { type: "action", config: { type: "SET_VAR", name: "$wdTpl", value: "$allItemsById.${$wdTplId}" } },
      { type: "action", config: { type: "SET_VAR", name: "$tplWd", value: "$wdTpl.fields.w.value" } },
    ] },
  ] }] },
];

describe("0395 repointFillDay", () => {
  const { steps: out, loops, sets } = repointFillDay(steps);
  it("drops the two page vars and keeps the rest", () => {
    expect(out.map((s) => s.config?.name).filter(Boolean)).toEqual(["$schedPage"]);
  });
  it("the template loop reads every container and binds the record itself", () => {
    const tplLoop = out[1].then[0].body[0];
    expect(tplLoop.overExpr).toBe("$allContainers");
    expect(tplLoop.body[0].config.value).toBe("$wdTplId");
    expect(tplLoop.body[1].config.value).toBe("$wdTpl.fields.w.value");
    expect([loops, sets]).toEqual([1, 1]);
  });
  it("is idempotent", () => {
    const again = repointFillDay(out);
    expect([again.loops, again.sets]).toEqual([0, 0]);
    expect(again.steps).toEqual(out);
  });
});
