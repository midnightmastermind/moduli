// The cumulative trackers say what they are about, and Monthly Bills is a goal.
//
// USER, 2026-08-20: *"for Tracker Date it should say total ... so for like the
// account trackers"*, and *"get rid of the total subscriptions and monthly bills
// should be a monthly goal totalling the amount of bills vs what i paid so far."*
import { describe, it, expect, vi } from "vitest";
vi.setConfig({ testTimeout: 60000 });
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString());
const AMOUNT = fx.fields.find(f => f.name === "Amount" && !f.displayEnabled).id;
const COMPLETED = fx.fields.find(f => f.name === "Completed" && !f.displayEnabled).id;
const BILLS = "X5Of8jcGO4II";

function sweep(mutate) {
  const operations = fx.operations.filter(o => o.enabled !== false);
  const occurrencesById = Object.fromEntries(fx.occurrences.map(o => [o.id, structuredClone(o)]));
  const modulesById = Object.fromEntries(fx.modules.map(m => [m.id, m]));
  const fieldsById = Object.fromEntries(fx.fields.map(f => [f.id, f]));
  mutate?.(occurrencesById);
  const operationsById = Object.fromEntries(operations.map(o => [o.id, o]));
  const state = { grid: fx.grid, gridId: fx.grid._id, fields: Object.values(fieldsById),
    modules: Object.values(modulesById), occurrencesById, modulesById, fieldsById, operationsById, operations };
  const ups = runMatchingOperations(operations, null, null,
    { state, fieldsById, operationsById, occurrencesById, modulesById }, {});
  applyEffectsToLiveOccs(occurrencesById, ups);
  const tile = (label) => {
    const m = Object.values(modulesById).find(x => x.label === label);
    const o = Object.values(occurrencesById).find(x => x.moduleId === m?.id);
    const out = {};
    for (const b of m?.fieldBindings || []) out[fieldsById[b.fieldId]?.name] = o?.fields?.[b.fieldId]?.value;
    return out;
  };
  return { tile, modulesById, fieldsById, occurrencesById };
}
const under = (occ, root) => {
  const out = []; const walk = (id) => {
    for (const c of occ[id]?.occurrences || []) { out.push(occ[c]); walk(c); } };
  walk(root); return out.filter(Boolean);
};

describe("cumulative trackers state their scope", () => {
  it("the account trackers say Total where a date used to be", () => {
    const { tile } = sweep();
    for (const t of ["Checking Account", "Savings Account", "Mom's Account", "Cash", "Net Worth"]) {
      expect(tile(t)["Tracker Scope"], t).toBe("Total");
      // and must NOT still be claiming a day
      expect(tile(t)["Tracker Date"], `${t} date`).toBeUndefined();
    }
  });

  // The control: a DAILY tracker must be untouched, or the loop is not scoped,
  // it is just writing everywhere.
  it("leaves a daily tracker alone", () => {
    const { tile } = sweep();
    const steps = tile("Steps");
    expect(steps["Tracker Scope"]).toBeUndefined();
    expect(steps["Tracker Date"]).toBeTruthy();
  });
});

describe("Monthly Bills is a goal", () => {
  it("Total Subscriptions is gone, and its rows still count toward Bills", () => {
    const { modulesById, tile } = sweep();
    expect(Object.values(modulesById).some(m => m.label === "Total Subscriptions")).toBe(false);
    // Netflix + Spotify + iCloud+ = 30.97, still inside the month's total.
    expect(Number(tile("Monthly Bills")["Amount"])).toBeGreaterThan(30.97);
  });

  it("Bills Paid rises as bills are ticked, against the month's total", () => {
    const before = sweep().tile("Monthly Bills");
    expect(before["Bills Paid"]).toBe(0);
    const after = sweep((occ) => {
      const rows = under(occ, BILLS).filter(o => Number(o.fields?.[AMOUNT]?.value) > 0);
      for (const r of rows) r.fields[COMPLETED] = { value: true, flow: "in" };
    }).tile("Monthly Bills");
    expect(after["Bills Paid"]).toBeGreaterThan(0);
  });

  it("the target matches what the tile says is due — same question, same answer", () => {
    // The first version summed EVERY bill and got 2220.97 while the op showed
    // 2040.97, because the op requires `Cadence IS "monthly"` and one premium is
    // `every-n-days`. A goal measured against a number its own tile disagrees
    // with is worse than no goal.
    const { tile, fieldsById } = sweep();
    const paid = Object.values(fieldsById).find(f => f.name === "Bills Paid" && f.displayEnabled);
    expect(Number(paid.displayConfig.targetValue)).toBe(Number(tile("Monthly Bills")["Amount"]));
  });
});
