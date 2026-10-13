// Combine Schedule (migration 0397) through the REAL executor over the poms fixture. With the Schedule
// page's Combine Schedule on and two days picked, the op makes ONE "combined" column of copy-linked
// template slots, gives each slot a feed (its Time Slot under the Schedule page) and hides the day
// columns; a second run with the column present creates nothing; off, the column is deleted.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { executePipeline } from "../helpers/operationExecutor";
import { combineDaysPipeline, layoutContainerOf, withCombineFilter, COMBINED_FORMAT, COMBINED_LABEL, BUILD_OP }
  from "../../../server/migrations/0397-combine-schedule.mjs";

vi.setConfig({ testTimeout: 60000 });
const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString("utf8"));
const ids = fx.grid.meta.scheduleFieldIds;
const COMBINE = "fCombine";
const layoutContId = layoutContainerOf(fx.operations.find((o) => o.name === BUILD_OP));
const lastCol = fx.occurrences.filter((o) => o.fields?.[ids.scheduleFormatFieldId]?.value === "day-col")
  .map((o) => o.fields?.[ids.dateFieldId]?.value).sort().pop();
const nextDay = (d) => { const t = new Date(`${d}T12:00:00`); t.setDate(t.getDate() + 1); return t.toISOString().slice(0, 10); };
const days = [lastCol, nextDay(lastCol)];
const dateF = Object.keys(fx.grid.activeFilterValues || {})[0];
const op = { id: "op-combine", name: "Schedule: Combine Days", targetOccurrenceId: ids.pageOccurrenceId,
  pipeline: combineDaysPipeline({ pageOccurrenceId: ids.pageOccurrenceId, layoutContId, combineFieldId: COMBINE,
    dateFieldId: ids.dateFieldId, timeslotFieldId: ids.timeslotFieldId, scheduleFormatFieldId: ids.scheduleFormatFieldId }) };

function run({ combine, picked = days, existing = false }) {
  const occ = Object.fromEntries(fx.occurrences.map((o) => [o.id, structuredClone(o)]));
  const mods = Object.fromEntries(fx.modules.map((m) => [m.id, m]));
  const page = occ[ids.pageOccurrenceId];
  const period = picked.length > 1 ? { kind: "multi", unit: "day", value: picked[0], dates: picked } : picked[0];
  page.filterOverride = { ...(page.filterOverride || {}), [dateF]: period, [COMBINE]: combine };
  if (existing) {
    mods["m-comb"] = { id: "m-comb", role: "container", kind: "board", label: COMBINED_LABEL };
    occ["o-comb"] = { id: "o-comb", moduleId: "m-comb", parentId: page.id, occurrences: [],
      fields: { [ids.scheduleFormatFieldId]: { value: COMBINED_FORMAT } } };
    page.occurrences = [...(page.occurrences || []), "o-comb"];
  }
  const grid = { ...fx.grid, activeFilterValues: { [dateF]: period } };
  const fields = [...fx.fields, { id: COMBINE, name: "Combine Schedule", type: "boolean" }];
  const state = { grid, gridId: grid._id, fields, modules: Object.values(mods), occurrencesById: occ, modulesById: mods };
  const ctx = { state, fieldsById: Object.fromEntries(fields.map((f) => [f.id, f])), occurrencesById: occ, modulesById: mods, operationsById: {} };
  return { occ, effects: executePipeline(op, ctx, null, {}) };
}

describe("Combine Schedule", () => {
  it("fixture has a template container and a day to start from", () => {
    expect(layoutContId).toBeTruthy();
    expect(days).toHaveLength(2);
  });

  it("on, two days: one combined column, one copy-linked slot per template slot, each fed by its Time Slot", () => {
    const { occ, effects } = run({ combine: true });
    const creates = effects.filter((e) => e._effect === "CREATE_ITEM");
    const col = creates.find((e) => e.instance?.fields?.[ids.scheduleFormatFieldId]?.value === COMBINED_FORMAT);
    expect(col).toBeTruthy();
    const slots = creates.filter((e) => e.instance?.parentId === col.instance.id);
    expect(slots).toHaveLength((occ[layoutContId].occurrences || []).length);
    expect(slots.every((s) => s.instance.meta?.copyLinkSource)).toBe(true);
    const feeds = effects.filter((e) => e._effect === "UPDATE_ITEM_FEED");
    expect(feeds.length).toBeGreaterThan(0);
    const f = feeds[0].value;
    expect(f).toMatchObject({ enabled: true, roles: ["instance"], scope: ids.pageOccurrenceId });
    const tpl = occ[slots.find((s) => s.instance.id === feeds[0].itemId).instance.meta.copyLinkSource];
    expect(f.conditions[0]).toMatchObject({ fieldId: ids.timeslotFieldId, comparator: "IS",
      value: tpl.fields[ids.timeslotFieldId].value });
    const hide = effects.find((e) => e._effect === "UPDATE_ITEM_META" && e.metaPath.join(".") === "layoutCascadeOverride.hideChildIds");
    const dayCols = Object.values(occ).filter((o) => o.parentId === ids.pageOccurrenceId
      && o.fields?.[ids.scheduleFormatFieldId]?.value === "day-col").map((o) => o.id);
    expect(dayCols.length).toBeGreaterThan(0);
    expect([...hide.value].sort()).toEqual(dayCols.sort());
    const fv = effects.find((e) => e._effect === "UPDATE_ITEM_FIELD_VISIBILITY" && e.itemId === col.instance.id);
    const pageFv = occ[ids.pageOccurrenceId].fieldVisibility;
    expect(fv.value.reveal).toEqual([ids.dateFieldId]);
    expect(fv.value.mode).toBe(pageFv?.mode || "off");
    expect(fv.value.fieldIds || []).toEqual(pageFv?.fieldIds || []);
  });

  it("on, column already there: creates no second column", () => {
    const { effects } = run({ combine: true, existing: true });
    expect(effects.some((e) => e._effect === "CREATE_ITEM" && e.instance?.fields?.[ids.scheduleFormatFieldId]?.value === COMBINED_FORMAT)).toBe(false);
  });

  it("off: deletes the combined column and adds nothing", () => {
    const { effects } = run({ combine: false, existing: true });
    expect(effects.filter((e) => e._effect === "CREATE_ITEM")).toHaveLength(0);
    expect(effects.some((e) => e._effect === "DELETE_ITEM" && e.itemId === "o-comb")).toBe(true);
  });

  it("on but one day: nothing combined (the column goes)", () => {
    const { effects } = run({ combine: true, picked: days.slice(0, 1), existing: true });
    expect(effects.filter((e) => e._effect === "CREATE_ITEM")).toHaveLength(0);
    expect(effects.some((e) => e._effect === "DELETE_ITEM" && e.itemId === "o-comb")).toBe(true);
  });

  it("the page filter is added once", () => {
    const once = withCombineFilter([], COMBINE);
    expect(once).toHaveLength(1);
    expect(once[0]).toMatchObject({ fieldId: COMBINE, active: true, showNav: true });
    expect(withCombineFilter(once, COMBINE)).toBeNull();
  });
});
