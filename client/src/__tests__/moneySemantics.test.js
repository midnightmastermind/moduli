// __tests__/moneySemantics.test.js
//
// User, 2026-09-06: *"networth isnt including cash, income isnt going up when i
// add to accounts and setting the account numbers is adding those transactions
// to purchases. it should only be purchases if its negative"*.
//
// All three were about a gate that did not say what the number means.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations } from "../helpers/operationExecutor";

vi.setConfig({ testTimeout: 60000 });
const here = path.dirname(fileURLToPath(import.meta.url));
const TODAY = new Date().toISOString().slice(0, 10);

let base;
beforeAll(() => {
  base = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString());
});

function world() {
  const fx = JSON.parse(JSON.stringify(base));
  const by = (a) => Object.fromEntries(a.map((x) => [x.id, x]));
  return { fx, fieldsById: by(fx.fields), modulesById: by(fx.modules),
           occurrencesById: by(fx.occurrences), opsById: by(fx.operations) };
}
const fid = (w, n) => w.fx.fields.find((f) => f.name === n)?.id;
const lbl = (w, o) => (o ? (o.label || w.modulesById[o.moduleId]?.label) : "?");

// A/B: undo one fix in the fixture and confirm exactly its own tests fail.
function undo(w, which) {
  const ops = w.fx.operations;
  if (which === "cash") {
    const nw = ops.find((o) => o.name === "Net Worth");
    const cash = fid(w, "Cash");
    const walk = (n) => { if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (Array.isArray(n.rules) && n.rules.some(r => String(r?.left||"").includes(cash)))
        for (const r of n.rules) if (String(r?.left||"") === "$item.templateId") r.right = "HoTfgN19hapH";
      Object.values(n).forEach(walk); };
    walk(nw.pipeline);
  }
  if (which === "flow") {
    const ph = ops.find((o) => o.name === "Purchase History");
    const amt = fid(w, "Amount");
    const walk = (n) => { if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      if (Array.isArray(n.rules)) n.rules = n.rules.filter(r => String(r?.left||"") !== `$inst.fields.${amt}.flow`);
      Object.values(n).forEach(walk); };
    walk(ph.pipeline);
  }
  if (which === "income") {
    const ea = ops.find((o) => o.name === "Earned");
    const amt = fid(w, "Amount");
    const walk = (n) => { if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { for (let i=n.length-1;i>=0;i--){ const el=n[i];
        if (el && (el.type==="loop"||el.config?.type==="loop") && JSON.stringify(el).includes(`fields.${amt}.flow`)) n.splice(i,1); else walk(el); } return; }
      Object.values(n).forEach(walk); };
    walk(ea.pipeline);
  }
}

function sweep(w, want) {
  if (process.env.AB_UNDO) undo(w, process.env.AB_UNDO);
  const ops = w.fx.operations.filter((o) => o.enabled !== false);
  const grid = w.fx.grid;
  const ups = runMatchingOperations(ops, null, null, {
    state: { grid, gridId: grid?._id, fields: w.fx.fields, modules: w.fx.modules,
             occurrencesById: w.occurrencesById, modulesById: w.modulesById,
             fieldsById: w.fieldsById, operationsById: w.opsById, operations: ops },
    fieldsById: w.fieldsById, operationsById: w.opsById,
    occurrencesById: w.occurrencesById, modulesById: w.modulesById,
  }, { onError: () => {}, onSuccess: () => {} }) || [];
  const ids = Object.fromEntries(want.map((n) => [fid(w, n), n]));
  const out = {};
  for (const e of ups) { const n = ids[e.fieldId || e.payload?.fieldId]; if (n) out[n] = e.value ?? e.payload?.value; }
  return out;
}

// A completed, dated, Schedule-placed money row with a chosen flow.
function logMoney(w, { flow, amount = 50, toAccount = null, field = "Amount" }) {
  const done = fid(w, "Completed"), date = fid(w, "Date"), sfmt = fid(w, "Schedule Format");
  const col = w.fx.occurrences.find((o) => o.fields?.[sfmt]?.value === "day-col");
  const src = w.fx.occurrences.find((o) => lbl(w, o) === "Pay Bill" && o.fields?.[fid(w, "Amount")]?.value != null);
  expect(col && src, "fixture shape changed").toBeTruthy();
  const c = JSON.parse(JSON.stringify(src));
  c.id = `money-${flow}-${field}`;
  c.parentId = col.id;
  c.fields[done] = { value: true, flow: "in" };
  c.fields[date] = { value: TODAY, flow: "in" };
  delete c.fields[fid(w, "Account")];
  c.fields[fid(w, field)] = { value: amount, flow };
  if (toAccount) {
    const tile = w.fx.occurrences.find((o) => lbl(w, o) === toAccount);
    c.fields[fid(w, "To Account")] = { value: tile.id, flow: "in" };
  }
  w.fx.occurrences.push(c);
  w.occurrencesById[c.id] = c;
  col.occurrences = [...(col.occurrences || []), c.id];
  return c;
}

describe("Net Worth includes Cash", () => {
  it("is the sum of Checking, Savings and Cash", () => {
    const w = world();
    const val = (n) => {
      const f = fid(w, n);
      const o = w.fx.occurrences.find((x) => x.fields?.[f]?.value != null);
      return o ? Number(o.fields[f].value) : 0;
    };
    const expected = val("Checking Balance") + val("Savings Balance") + val("Cash");
    // CONTROL: Cash must be non-zero, or "includes Cash" is vacuously true.
    expect(val("Cash"), "the Cash tile holds nothing — this test proves nothing").toBeGreaterThan(0);
    expect(sweep(w, ["Net Worth"])["Net Worth"]).toBeCloseTo(expected, 2);
  });

  it("does NOT include Mom's Account", () => {
    // The user's explicit call (0288). It is also what the broken version was
    // accidentally pointing at.
    const w = world();
    const f = fid(w, "Mom's Account");
    const o = w.fx.occurrences.find((x) => x.fields?.[f]?.value != null);
    if (!o || !Number(o.fields[f].value)) return;         // nothing to exclude today
    const nw = sweep(w, ["Net Worth"])["Net Worth"];
    const val = (n) => { const ff = fid(w, n); const x = w.fx.occurrences.find((y) => y.fields?.[ff]?.value != null); return x ? Number(x.fields[ff].value) : 0; };
    expect(nw).toBeCloseTo(val("Checking Balance") + val("Savings Balance") + val("Cash"), 2);
  });
});

describe("a purchase is money going out", () => {
  const count = (w) => (sweep(w, ["Purchases"])["Purchases"] || []).length;

  it("an outflow is recorded", () => {
    const w = world();
    const before = count(w);
    logMoney(w, { flow: "out" });
    expect(count(w), "an outflow was not recorded as a purchase").toBeGreaterThan(before);
  });

  it("setting a balance (replace) is NOT a purchase", () => {
    const w = world();
    const before = count(w);
    logMoney(w, { flow: "replace" });
    expect(count(w), "setting an account balance still counts as a purchase").toBe(before);
  });

  it("money coming IN is not a purchase", () => {
    const w = world();
    const before = count(w);
    logMoney(w, { flow: "in" });
    expect(count(w), "an inflow still counts as a purchase").toBe(before);
  });
});

describe("money arriving in an account is income", () => {
  const earned = (w) => Number(sweep(w, ["Earned"])["Earned"] ?? 0);

  it("an Amount inflow raises Earned", () => {
    const w = world();
    const before = earned(w);
    logMoney(w, { flow: "in", amount: 50 });
    expect(earned(w) - before, "adding to an account did not raise income").toBeCloseTo(50, 2);
  });

  it("a TRANSFER arrival is not income", () => {
    // THE CONTROL, and the one that must not be got wrong: moving money
    // between your own accounts is not earning it.
    const w = world();
    const before = earned(w);
    logMoney(w, { flow: "in", amount: 50, toAccount: "Savings Account" });
    expect(earned(w), "a transfer between accounts was counted as income").toBeCloseTo(before, 2);
  });

  it("an outflow does not raise Earned", () => {
    const w = world();
    const before = earned(w);
    logMoney(w, { flow: "out", amount: 50 });
    expect(earned(w)).toBeCloseTo(before, 2);
  });
});
