// What a balance IS: zero, unless something set it.
//
// User, 2026-09-08: *"make sure thats accounting for flow. if i have a set the
// value, that should be the new baseline. so start with 0 unless we have a
// replace flow"*
//
// So the rule, stated as arithmetic:
//
//     balance = (the LATEST `replace` amount, or 0 if there is none)
//               + every `in`/`out` amount recorded AFTER it
//
// Every one of those clauses is a place this can go wrong quietly, and each has
// its own case below. The whole file exists because a balance is a number the
// user reads and acts on: a wrong one is not a visibly broken feature, it is a
// plausible number. `Savings Balance` had NO OPERATION AT ALL for weeks and
// nothing noticed (2026-09-05), because "0" is what a dead op and an empty
// account both look like.
//
// NOTHING HERE READS THE GRID'S OWN NUMBERS. Every case builds the transactions
// it measures, so the assertions do not depend on what happened to be logged
// when the fixture was exported — and they survive the day rollover, which has
// broken these suites twice.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations } from "../helpers/operationExecutor";
import { TODAY, labelOf, fieldId, ensureTodaysColumn } from "./helpers/scheduleWorld";

vi.setConfig({ testTimeout: 180000 });
const here = path.dirname(fileURLToPath(import.meta.url));
let base;
beforeAll(() => {
  base = JSON.parse(brotliDecompressSync(
    readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString());
});

function world() {
  const fx = JSON.parse(JSON.stringify(base));
  const by = (a) => Object.fromEntries(a.map((x) => [x.id, x]));
  return { fx, fieldsById: by(fx.fields), modulesById: by(fx.modules),
           occurrencesById: by(fx.occurrences), opsById: by(fx.operations) };
}

function sweep(w) {
  const ops = w.fx.operations.filter((o) => o.enabled !== false);
  const updates = runMatchingOperations(ops, null, null, {
    state: { grid: w.fx.grid, gridId: w.fx.grid?._id, fields: w.fx.fields, modules: w.fx.modules,
      occurrencesById: w.occurrencesById, modulesById: w.modulesById,
      fieldsById: w.fieldsById, operationsById: w.opsById, operations: ops },
    fieldsById: w.fieldsById, operationsById: w.opsById,
    occurrencesById: w.occurrencesById, modulesById: w.modulesById,
  }, { onError: () => {}, onSuccess: () => {} }) || [];
  const out = {};
  for (const e of updates) {
    const oid = e.itemId || e.occurrenceId || e.payload?.itemId || e.payload?.occurrenceId;
    const fid = e.fieldId || e.payload?.fieldId;
    if (!oid || !fid) continue;
    out[`${labelOf(w, w.occurrencesById[oid])}.${w.fieldsById[fid]?.name}`] = e.value ?? e.payload?.value;
  }
  return out;
}

let seq = 0;
/** One completed, dated money row on today's column, tagged to an account. */
function record(w, { action, amount, flow, day, account, field = "Amount" }) {
  const col = ensureTodaysColumn(w);
  const src = w.fx.occurrences.find(
    (o) => labelOf(w, o) === action && w.modulesById[o.moduleId]?.role === "instance");
  expect(src, `no "${action}" row to clone`).toBeTruthy();
  const tile = w.fx.occurrences.find(
    (o) => labelOf(w, o) === account && w.modulesById[o.moduleId]?.role === "instance");
  expect(tile, `no "${account}" row to tag`).toBeTruthy();

  const c = JSON.parse(JSON.stringify(src));
  c.id = `flow-${++seq}`;
  c.parentId = col.id;
  c.fields = { ...(c.fields || {}) };
  c.fields[fieldId(w, "Date")] = { value: day, flow: "in" };
  c.fields[fieldId(w, "Completed")] = { value: true, flow: "in" };
  c.fields[fieldId(w, field)] = { value: amount, flow };
  c.fields[fieldId(w, "Account")] = { value: tile.id, flow: "in" };
  // A destination would make it a TRANSFER, which is a different shape.
  delete c.fields[fieldId(w, "To Account")];
  w.fx.occurrences.push(c);
  w.occurrencesById[c.id] = c;
  col.occurrences = [...(col.occurrences || []), c.id];
  return c;
}

// The four accounts and the field each balance lands in. Their operations are
// NOT identical — Checking also absorbs untagged money, and Cash/Mom's carry an
// extra date gate — so the semantics are asserted per account rather than once.
const ACCOUNTS = [
  { row: "Checking Account", shows: "Accounts.Checking Balance" },
  { row: "Savings Account",  shows: "Accounts.Savings Balance" },
  { row: "Cash",             shows: "Accounts.Cash" },
  { row: "Mom's Account",    shows: "Accounts.Mom's Account" },
];

describe("a balance is 0 until something sets it", () => {
  for (const acct of ACCOUNTS) {
    it(`${acct.row}: a replace amount BECOMES the balance`, () => {
      const w = world();
      record(w, { action: "Track", amount: 140, flow: "replace", day: TODAY, account: acct.row });
      expect(sweep(w)[acct.shows]).toBeCloseTo(140, 2);
    });

    it(`${acct.row}: the LATEST replace wins, earlier ones are superseded`, () => {
      const w = world();
      record(w, { action: "Track", amount: 50,  flow: "replace", day: "2026-08-01", account: acct.row });
      record(w, { action: "Track", amount: 200, flow: "replace", day: "2026-09-01", account: acct.row });
      // Not 250 — a "set the value" is a new baseline, not another deposit.
      expect(sweep(w)[acct.shows]).toBeCloseTo(200, 2);
    });

    it(`${acct.row}: spending AFTER the baseline comes off it`, () => {
      const w = world();
      record(w, { action: "Track", amount: 100, flow: "replace", day: "2026-09-01", account: acct.row });
      record(w, { action: "Spend", amount: 10,  flow: "out",     day: TODAY,        account: acct.row });
      expect(sweep(w)[acct.shows]).toBeCloseTo(90, 2);
    });

    it(`${acct.row}: spending BEFORE the baseline does NOT come off it`, () => {
      const w = world();
      record(w, { action: "Spend", amount: 10,  flow: "out",     day: "2026-08-01", account: acct.row });
      record(w, { action: "Track", amount: 100, flow: "replace", day: "2026-09-01", account: acct.row });
      // The whole point of setting a balance: it supersedes what came before it.
      // Without this, correcting a balance would double-count the history it was
      // correcting FOR.
      expect(sweep(w)[acct.shows]).toBeCloseTo(100, 2);
    });
  }

  it("with NO replace anywhere, the balance starts at 0 and just moves", () => {
    const w = world();
    const before = sweep(w)["Accounts.Checking Balance"] ?? 0;
    record(w, { action: "Spend", amount: 10, flow: "out", day: TODAY, account: "Checking Account" });
    expect(sweep(w)["Accounts.Checking Balance"] - before).toBeCloseTo(-10, 2);
  });

  it("money in raises it, money out lowers it", () => {
    const w = world();
    record(w, { action: "Track", amount: 100, flow: "replace", day: "2026-09-01", account: "Checking Account" });
    record(w, { action: "Earn",  amount: 50,  flow: "in", day: TODAY, account: "Checking Account", field: "Income" });
    // The CONTROL for the two directions: if `out` were also added, the
    // "spending comes off it" case above would still pass on its own.
    expect(sweep(w)["Accounts.Checking Balance"]).toBeCloseTo(150, 2);
  });

  it("an empty grid reads 0, not undefined", () => {
    const w = world();
    // A tile showing nothing and a tile showing zero are different bugs, and
    // only one of them is correct here.
    for (const a of ACCOUNTS) expect(typeof sweep(w)[a.shows]).toBe("number");
  });

  it("Net Worth follows the baselines", () => {
    const w = world();
    record(w, { action: "Track", amount: 100, flow: "replace", day: "2026-09-01", account: "Checking Account" });
    record(w, { action: "Track", amount: 20,  flow: "replace", day: "2026-09-01", account: "Cash" });
    record(w, { action: "Track", amount: 500, flow: "replace", day: "2026-09-01", account: "Mom's Account" });
    const got = sweep(w);
    // Mom's is excluded on purpose — it is somebody else's money (0288).
    expect(got["Net Worth.Net Worth"]).toBeCloseTo(120, 2);
    expect(got["Accounts.Mom's Account"], "Mom's balance still tracks").toBeCloseTo(500, 2);
  });
});

describe("Aggregation decides the arithmetic; the date filter decides the cut-off", () => {
  // User, 2026-09-08: *"the current vs total thing is more for the nondate but
  // since we would have it set either way, it would determine if its a current
  // up through that day we set or total for that day."*
  //
  //                 no date filter            date filter = D
  //     current     balance now               balance AS OF THE END OF D
  //     total       all movement, from 0      movement in D, from 0
  //
  // The two axes were tangled: whether a balance used its baseline depended on
  // whether the tile happened to carry its own date filter, so filtering a
  // balance to a day silently turned it into that day's CHANGE (90 -> -10) with
  // nothing on screen saying so. `Aggregation` (0323) makes the arithmetic
  // explicit, and a filter then only narrows WHICH ROWS COUNT.
  const filterTo = (w, label, value) => {
    const t = w.fx.occurrences.find(
      (o) => labelOf(w, o) === label && w.modulesById[o.moduleId]?.role === "instance");
    expect(t, `no "${label}" tile`).toBeTruthy();
    t.filterOverride = { ...(t.filterOverride || {}), [fieldId(w, "Date")]: value };
  };
  // Balance set to 100 on Sep 1; 10 spent today. Nothing in between.
  const ledger = (w) => {
    record(w, { action: "Track", amount: 100, flow: "replace", day: "2026-09-01", account: "Checking Account" });
    record(w, { action: "Spend", amount: 10,  flow: "out",     day: TODAY,        account: "Checking Account" });
  };
  const checking = (w) => sweep(w)["Accounts.Checking Balance"];

  it("current, no filter: the balance now", () => {
    const w = world(); ledger(w);
    expect(checking(w)).toBeCloseTo(90, 2);
  });

  it("current, filtered to TODAY: still the balance, not the day's change", () => {
    const w = world(); ledger(w); filterTo(w, "Accounts", TODAY);
    // The point of `current`: a date narrows how far forward to count, it does
    // not throw the baseline away. -10 would be the day's movement.
    expect(checking(w)).toBeCloseTo(90, 2);
  });

  it("current, filtered to a quiet day AFTER the baseline: the balance as of then", () => {
    const w = world(); ledger(w); filterTo(w, "Accounts", "2026-09-05");
    // Nothing happened on the 5th, but you still HAD 100 that day.
    expect(checking(w)).toBeCloseTo(100, 2);
  });

  it("current, filtered to the day it was SET: that balance", () => {
    const w = world(); ledger(w); filterTo(w, "Accounts", "2026-09-01");
    expect(checking(w)).toBeCloseTo(100, 2);
  });

  it("current, filtered BEFORE the baseline was ever set: 0", () => {
    const w = world(); ledger(w); filterTo(w, "Accounts", "2026-08-01");
    // THE CONTROL for the cut-off: a balance you had not set yet is 0, not 100.
    // Without this, "as of that day" is also satisfied by ignoring the filter.
    expect(checking(w)).toBeCloseTo(0, 2);
  });
});
