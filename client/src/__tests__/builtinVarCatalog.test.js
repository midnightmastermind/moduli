// Every date var the executor provides must be pickable.
//
// Measured 2026-09-28: the executor's date block yields $activeDate, $filterDate,
// $activePeriod, $activePeriodDates, $activePeriodCount, $activeDateLabel,
// $activeDayOfWeek, $activeMonthLabel, $activeDateRelativeLabel and
// $activeDatePossessive; the Built-ins picker offered three. $activePeriodDates
// is what `Schedule: Build Schedule` and `Day Page: Build` LOOP over (7 live
// ops) — so the loop that mints one day column per visible day could not be
// built by clicking. Same drift class as the comparator catalog: the walker
// reads the executor's own source, so the next var added there fails here.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CATEGORIES, COLLECTION_PICKER_CONFIG } from "../ui/categoryRegistry";

const src = fs.readFileSync(path.resolve(__dirname, "../helpers/operationExecutor.js"), "utf8");
const start = src.indexOf("$activeDate: dayKey");
const block = src.slice(start, src.indexOf("};", start));
const executorDateVars = [...new Set([...block.matchAll(/(\$[A-Za-z]+):/g)].map((m) => m[1]))];
const builtins = CATEGORIES.find((c) => c.id === "builtins").resolveItems({}).map((i) => i.value);

describe("built-in var catalog", () => {
  it("CONTROL: the walker finds the executor's date block", () => {
    expect(executorDateVars).toEqual(expect.arrayContaining(["$activeDate", "$activePeriodDates", "$activeDatePossessive"]));
    expect(executorDateVars.length).toBeGreaterThanOrEqual(10);
  });
  it("every date var the executor provides is in Built-ins", () => {
    expect(executorDateVars.filter((v) => !builtins.includes(v))).toEqual([]);
  });
  it("$activePeriodDates can be picked as a LOOP collection", () => {
    const items = COLLECTION_PICKER_CONFIG.categories[0].resolveItems({}).map((i) => i.value);
    expect(items).toContain("$activePeriodDates");
  });
});
