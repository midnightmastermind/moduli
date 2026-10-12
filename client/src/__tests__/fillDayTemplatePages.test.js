// 0395 (2026-10-12): each schedule template is its own page in Templates/Schedule, and Fill Day
// finds the weekday templates by their Weekday value (looping every container) instead of looping
// the Schedule Template page. Drives the migration's own repoint through the REAL executor over the
// poms fixture: the repointed pipeline must apply exactly the template items the old one applied,
// and still does so once the containers no longer sit under the Schedule Template page.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { executePipeline } from "../helpers/operationExecutor";
import { repointFillDay } from "../../../server/migrations/0395-a-page-per-schedule-template.mjs";

vi.setConfig({ testTimeout: 60000 });
const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString("utf8"));
const fieldId = (name) => fx.fields.find((f) => f.name === name)?.id;
const WD = fieldId("Weekday"), SF = fieldId("Schedule Format"), DATE = fieldId("Date");
const oldOp = fx.operations.find((o) => o.name === "Schedule: Fill Day");
const newOp = { ...oldOp, pipeline: { ...oldOp.pipeline, steps: repointFillDay(oldOp.pipeline.steps).steps } };
const DAY = fx.occurrences.filter((o) => o.fields?.[SF]?.value === "day-col").map((o) => o.fields?.[DATE]?.value).sort().pop();

// splitPages: move each Schedule Template child into a page of its own (what 0395 does in Mongo)
function run(op, { splitPages = false } = {}) {
  const all = fx.occurrences.map((o) => structuredClone(o));
  const mods = Object.fromEntries(fx.modules.map((m) => [m.id, m]));
  if (splitPages) {
    const page = all.find((o) => mods[o.moduleId]?.role === "page" && mods[o.moduleId]?.label === "Schedule Template");
    for (const cid of page.occurrences || []) {
      const c = all.find((o) => o.id === cid); if (!c) continue;
      const pid = `tplpage-${cid}`; mods[`m-${pid}`] = { id: `m-${pid}`, role: "page", kind: "board", label: c.label || "T" };
      all.push({ id: pid, moduleId: `m-${pid}`, parentId: page.parentId, occurrences: [cid], fields: {} });
      c.parentId = pid;
    }
    all.splice(all.indexOf(page), 1);
  }
  // the run log keeps 50 iterations per loop; put the weekday templates first so they are logged
  const occ = Object.fromEntries([...all.filter((o) => o.fields?.[WD]?.value), ...all.filter((o) => !o.fields?.[WD]?.value)].map((o) => [o.id, o]));
  const dateF = Object.keys(fx.grid.activeFilterValues || {})[0];
  const sched = Object.values(occ).find((o) => mods[o.moduleId]?.role === "page" && mods[o.moduleId]?.label === "Schedule");
  sched.filterOverride = { ...(sched.filterOverride || {}), [dateF]: DAY };
  const grid = { ...fx.grid, activeFilterValues: { [dateF]: DAY } };
  const modules = Object.values(mods);
  const state = { grid, gridId: grid._id, fields: fx.fields, modules, occurrencesById: occ, modulesById: mods };
  const ctx = { state, fieldsById: Object.fromEntries(fx.fields.map((f) => [f.id, f])), occurrencesById: occ, modulesById: mods,
    operationsById: Object.fromEntries(fx.operations.map((o) => [o.id, o])) };
  const lg = { entries: [], _mute: 0, add(k, d) { if (this._mute > 0) return; this.entries.push({ k, ...d }); } };
  executePipeline(op, ctx, null, {}, lg);
  return lg.entries.filter((e) => e.actionType === "APPLY_TEMPLATE").map((e) => e.resolvedConfig?.templateRef).sort();
}

describe("Fill Day over the per-template pages", () => {
  it("the repointed pipeline no longer names the Schedule Template page (control)", () => {
    expect(JSON.stringify(oldOp.pipeline)).toContain("$stPage");
    expect(JSON.stringify(newOp.pipeline)).not.toContain("$stPage");
    expect(JSON.stringify(newOp.pipeline)).toContain("$allContainers");
  });

  it("applies exactly the template items the old pipeline applied, with each template on its own page", () => {
    const before = run(oldOp);
    expect(before.length).toBeGreaterThan(0);
    expect(run(newOp, { splitPages: true })).toEqual(before);
  });
});
