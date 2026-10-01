import { describe, it, expect } from "vitest";
import { guardCrossBuild } from "../migrations/0374-cross-build-only-short-ranges.mjs";
import { rewireSchedule, rewirePage } from "../migrations/0372-schedule-and-day-page-build-each-other.mjs";
import fs from "node:fs";
import path from "node:path";

const fx = (n) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", n), "utf8"));
const sched = rewireSchedule(fx("buildSchedule-2026-09-30b.json"), fx("dayPageBuild-2026-09-30b.json")).pipeline;
const page = rewirePage(fx("dayPageBuild-2026-09-30b.json"), fx("buildSchedule-2026-09-30b.json")).pipeline;
const find = (p, id) => { let hit; const w = (st) => { for (const s of st || []) { if (!hit && s?.id === id) hit = s; for (const k of ["then", "else", "body", "steps"]) w(s?.[k]); } }; w(p.steps); return hit; };

describe("0374 — cross-building only for 7 days or fewer", () => {
  it("wraps each builder's cross-build step, and only that step", () => {
    for (const [p, cross] of [[sched, "x-page-missing"], [page, "x-sched-missing"]]) {
      const { pipeline, changed } = guardCrossBuild(p);
      expect(changed).toBe(1);
      const guard = find(pipeline, "x-short-range");
      expect(guard.condition.rules[0]).toMatchObject({ left: "$activePeriodCount", comparator: "LESS_OR_EQUAL", right: 7 });
      expect(guard.then.map((s) => s.id)).toEqual([cross]);
    }
  });
  // The control: each side still builds its OWN day unguarded.
  it("leaves the builder's own day call alone", () => {
    const { pipeline } = guardCrossBuild(page);
    expect(find(pipeline, "x-page-day")).toBeTruthy();
    expect(JSON.stringify(find(pipeline, "x-short-range"))).not.toContain("x-page-day");
  });
  it("is idempotent", () => {
    const once = guardCrossBuild(sched).pipeline;
    expect(guardCrossBuild(once)).toMatchObject({ changed: 0, already: 1 });
  });
});
