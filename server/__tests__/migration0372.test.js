// 0372 — the Schedule and the Day Page each build the other's missing day
// (user, 2026-09-30). Exercised on the LIVE pipelines, as fixtures.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildDayPipeline, rewireSchedule, rewirePage, columnFind, SCHED, PAGE } from "../migrations/0372-schedule-and-day-page-build-each-other.mjs";

const fx = (n) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", n), "utf8"));
const sched = fx("buildSchedule-2026-09-30b.json");
const page = fx("dayPageBuild-2026-09-30b.json");
const loopOf = (p) => { let hit; const w = (st) => { for (const s of st || []) { if (!hit && s?.type === "loop" && s.overExpr === "$activePeriodDates") hit = s; for (const k of ["then", "else", "body", "steps"]) w(s?.[k]); } }; w(p.steps); return hit; };
const runs = (steps) => steps.filter((s) => s?.config?.type === "RUN_OPERATION").map((s) => [s.config.operationName, s.config.vars]);

describe("the Build Day ops", () => {
  it("carry the builder's per-date body UNCHANGED, behind a $day guard, with its INIT_VARs", () => {
    for (const src of [sched, page]) {
      const day = buildDayPipeline(src);
      const guard = day.steps.at(-1);
      expect(guard.condition.rules[0]).toMatchObject({ left: "$day", comparator: "IS_NOT_EMPTY" });
      expect(guard.then).toEqual(loopOf(src).body);
      expect(day.steps.slice(0, -1).every((s) => s.config.type === "INIT_VAR")).toBe(true);
    }
  });

  // The variables each body reads from OUTSIDE the loop are defined by the
  // copied INIT_VARs — measured on the live pipelines: $schedPageId + $dayCont,
  // and $tplId + $schedPageId.
  it("define every variable the body needs from outside it", () => {
    const names = (p) => buildDayPipeline(p).steps.filter((s) => s.config?.type === "INIT_VAR").map((s) => s.config.name);
    expect(names(sched)).toEqual(expect.arrayContaining(["$schedPageId", "$dayCont"]));
    expect(names(page)).toEqual(expect.arrayContaining(["$tplId", "$schedPageId"]));
  });
});

describe("the rewired loops", () => {
  it("Build Schedule: its own day, then the day page's day only when that column is missing", () => {
    const { pipeline, changed } = rewireSchedule(sched, page);
    expect(changed).toBe(true);
    const body = loopOf(pipeline).body;
    expect(runs(body)).toEqual([[SCHED.day, { $day: "$day" }]]);
    expect(body[1].config).toMatchObject({ type: "FIND", itemIdVar: "$crossPageColId" });
    expect(body[2].condition.rules[0]).toMatchObject({ left: "$crossPageColId", comparator: "IS_EMPTY" });
    expect(runs(body[2].then)).toEqual([[PAGE.day, { $day: "$day" }]]);
  });

  it("Day Page: the schedule's day only when missing, then its own day", () => {
    const { pipeline } = rewirePage(page, sched);
    const body = loopOf(pipeline).body;
    expect(body[0].config).toMatchObject({ type: "FIND", itemIdVar: "$crossSchedColId" });
    expect(runs(body[1].then)).toEqual([[SCHED.day, { $day: "$day" }]]);
    expect(runs(body)).toEqual([[PAGE.day, { $day: "$day" }]]);
  });

  // "Is there a column for this date" is asked exactly as each build asks it.
  it("the cross FINDs are the bodies' own first FINDs", () => {
    const own = (p) => loopOf(p).body.find((s) => s.config?.type === "FIND").config.predicate;
    expect(columnFind(page, "$x").config.predicate).toEqual(own(page));
    expect(columnFind(sched, "$x").config.predicate).toEqual(own(sched));
  });

  // The controls: nothing outside the loops moves, and a second run changes nothing.
  it("leaves the gates, layout and tails alone", () => {
    const before = JSON.stringify(sched).replace(JSON.stringify(loopOf(sched).body), "");
    const after = JSON.stringify(rewireSchedule(sched, page).pipeline).replace(JSON.stringify(loopOf(rewireSchedule(sched, page).pipeline).body), "");
    expect(after).toBe(before);
  });
  it("is idempotent", () => {
    expect(rewireSchedule(rewireSchedule(sched, page).pipeline, page).changed).toBe(false);
    expect(rewirePage(rewirePage(page, sched).pipeline, sched).changed).toBe(false);
  });
});
