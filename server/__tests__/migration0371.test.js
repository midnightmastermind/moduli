// 0371 — a day with no Schedule column must not embed the previous day's Todo
// (user, 2026-09-30: a birthday card showed on today's AND tomorrow's day page).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { resetTodoPerDay } from "../migrations/0371-day-page-todo-per-day.mjs";

const live = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures/dayPageBuild-2026-09-30.json"), "utf8"));

// The loop body that FINDs the day's Schedule column, wherever it sits.
const bodyWith = (pipeline, pred) => {
  let hit = null;
  const walk = (steps) => { if (!Array.isArray(steps) || hit) return; if (steps.some(pred)) { hit = steps; return; } for (const s of steps) for (const k of ["body", "steps", "then", "else"]) walk(s?.[k]); };
  walk(pipeline.steps); return hit;
};
const isDayColFind = (s) => s?.config?.type === "FIND" && s.config.itemIdVar === "$dayColId";

describe("0371 on the live Day Page: Build pipeline", () => {
  it("resets $todoId right before the Schedule-column FIND, in the same loop body", () => {
    const { pipeline, changed } = resetTodoPerDay(live);
    expect(changed).toBe(true);
    const body = bodyWith(pipeline, isDayColFind);
    const at = body.findIndex(isDayColFind);
    expect(body[at - 1].config).toEqual({ type: "INIT_VAR", name: "$todoId", expr: "literal:" });
  });

  // The control that makes the reset mean something: the Todo embed really is
  // OUTSIDE the if that binds $todoId, so without a reset it reads a stale value.
  it("the live embed step is guarded only by $todoId, not by the day's Schedule column", () => {
    const body = bodyWith(live, isDayColFind);
    const embedIf = body.find((s) => s?.type === "if" && JSON.stringify(s.condition).includes("$todoId")
      && JSON.stringify(s.then).includes("moduleEmbed"));
    expect(embedIf).toBeTruthy();
  });

  it("is idempotent", () => {
    const once = resetTodoPerDay(live).pipeline;
    const twice = resetTodoPerDay(once);
    expect(twice.changed).toBe(false);
    expect(twice.reason).toBe("already resets $todoId per day");
  });

  it("does not touch the input", () => {
    const before = JSON.stringify(live);
    resetTodoPerDay(live);
    expect(JSON.stringify(live)).toBe(before);
  });
});
