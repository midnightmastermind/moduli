import { describe, it, expect } from "vitest";
import { timeRangeLabel, shortClock } from "../helpers/slotSpan";
import { executePipeline } from "../helpers/operationExecutor";

describe("TIME_RANGE (2026-11-17: a shift's Hours, \"9am-3pm\")", () => {
  it("start + minutes → a short range", () => {
    expect(timeRangeLabel("9:00am", 360)).toBe("9am-3pm");
    expect(timeRangeLabel("9:30am", 90)).toBe("9:30am-11am");
    expect(timeRangeLabel("10:00pm", 240)).toBe("10pm-2am");
    expect(timeRangeLabel("14:00", 30)).toBe("2pm-2:30pm");
    expect(timeRangeLabel("12:00pm", 0)).toBe("12pm");
    expect(timeRangeLabel("", 60)).toBe("");
    expect(shortClock(0)).toBe("12am");
  });
  it("runs as a step", () => {
    const op = { id: "o", enabled: true, pipeline: { sources: [], steps: [
      { id: "a", type: "action", config: { type: "TIME_RANGE", start: "literal:9:00am", minutes: 360, to: "$hrs" } },
      { id: "b", type: "action", config: { type: "SHOW_VALUE", sourceExpr: "$hrs" } },
    ] } };
    const out = executePipeline(op, { state: {}, occurrencesById: {}, modulesById: {}, fieldsById: {} }, { type: "ButtonOp" }, {});
    expect(JSON.stringify(out)).toContain("9am-3pm");
  });
});
