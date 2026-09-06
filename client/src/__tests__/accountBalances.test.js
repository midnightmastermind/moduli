// __tests__/accountBalances.test.js
//
// THE ACCOUNT BALANCES, DRIVEN THROUGH THE REAL EXECUTOR OVER THE LIVE GRID.
//
// User, 2026-09-05: *"alot of them arent updating and the tests should be
// catching them ... savings balance"*, then, on where untagged money goes:
// **"it should be logged balance but that should still be affected by tagged
// transactions, thats how checking should be too"** — and untagged defaults to
// Checking.
//
// WHY A ZERO HERE PROVES NOTHING ON ITS OWN, which is the whole design of this
// file. Every balance on this grid computes 0, and that is CORRECT: all 22 rows
// carrying an Amount are catalog rows — the Spend / Buy / Donate actions, the
// bill options (Netflix, Electric, Rent), the savings goals (Japan Trip). Not
// one is a logged transaction; they have no parent, no Completed, no place on a
// schedule. So "the balance is 0" and "the pipeline is dead" look identical
// from the outside, and a suite that asserted the zeros would have passed
// against a balance op that had been silently broken for weeks. That is the
// 2026-08-01 (16) trap, and it is exactly what happened here — `Savings
// Balance` had no operation at all and nothing noticed.
//
// So the test INJECTS the transaction the grid does not have: one completed,
// dated, Schedule-placed $50 spend, and asserts where it lands. Twice — once
// untagged, once tagged — because "untagged goes to Checking" is also satisfied
// by "everything goes to Checking", and only the tagged twin separates them.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations } from "../helpers/operationExecutor";

vi.setConfig({ testTimeout: 60000 });

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "pomsGrid.json.br");
const TODAY = new Date().toISOString().slice(0, 10);

let base;
beforeAll(() => {
  base = JSON.parse(brotliDecompressSync(readFileSync(FIXTURE)).toString());
});

// A fresh world per run — the sweep mutates its overlay, so arms must not share.
function world() {
  const fx = JSON.parse(JSON.stringify(base));
  const by = (a) => Object.fromEntries(a.map((x) => [x.id, x]));
  return {
    fx,
    fieldsById: by(fx.fields),
    modulesById: by(fx.modules),
    occurrencesById: by(fx.occurrences),
    opsById: by(fx.operations),
  };
}

function sweep(w) {
  const ops = w.fx.operations.filter((o) => o.enabled !== false);
  const grid = w.fx.grid;
  const updates = runMatchingOperations(ops, null, null, {
    state: {
      grid, gridId: grid?._id, fields: w.fx.fields, modules: w.fx.modules,
      occurrencesById: w.occurrencesById, modulesById: w.modulesById,
      fieldsById: w.fieldsById, operationsById: w.opsById, operations: ops,
    },
    fieldsById: w.fieldsById, operationsById: w.opsById,
    occurrencesById: w.occurrencesById, modulesById: w.modulesById,
  }, { onError: () => {}, onSuccess: () => {} }) || [];

  const idOf = (n) => w.fx.fields.find((f) => f.name === n)?.id;
  const want = ["Checking Balance", "Savings Balance", "Net Worth"];
  const ids = Object.fromEntries(want.map((n) => [n, idOf(n)]));
  const out = {};
  for (const e of updates) {
    const fid = e.fieldId || e.payload?.fieldId;
    const hit = want.find((n) => ids[n] && ids[n] === fid);
    if (hit) out[hit] = e.value ?? e.payload?.value;
  }
  return out;
}

// Clone the catalog Pay Bill (its module binds Amount + Completed + Account)
// onto today's schedule column: completed, dated today, $50 out.
function logSpend(w, { account } = {}) {
  const fid = (n) => w.fx.fields.find((f) => f.name === n)?.id;
  const amtF = fid("Amount"), dateF = fid("Date"), doneF = fid("Completed"), acctF = fid("Account");
  const labelOf = (o) => o.label || w.modulesById[o.moduleId]?.label;

  const src = w.fx.occurrences.find((o) => o.fields?.[amtF]?.value != null && labelOf(o) === "Pay Bill");
  const col = w.fx.occurrences
    .filter((o) => o.fields?.[dateF]?.value === TODAY && (o.occurrences || []).length > 3)
    .sort((a, b) => (b.occurrences || []).length - (a.occurrences || []).length)[0];
  expect(src, "no Pay Bill row to clone — the fixture changed shape").toBeTruthy();
  expect(col, "no schedule column for today — re-export the fixture").toBeTruthy();

  const clone = JSON.parse(JSON.stringify(src));
  clone.id = "balance-control-row";
  clone.parentId = col.id;
  clone.fields[dateF] = { value: TODAY, flow: "in" };
  clone.fields[doneF] = { value: true, flow: "in" };
  clone.fields[amtF] = { value: 50, flow: "out" };
  if (account) {
    const tile = w.fx.occurrences.find((o) => labelOf(o) === account);
    expect(tile, `no "${account}" tile to tag`).toBeTruthy();
    clone.fields[acctF] = { value: tile.id, flow: "in" };
  } else delete clone.fields[acctF];

  w.fx.occurrences.push(clone);
  w.occurrencesById[clone.id] = clone;
  col.occurrences = [...(col.occurrences || []), clone.id];
  return clone;
}

// A transfer is ONE row that moves money out of one account and into another.
// The out-leg needs no new machinery — the outflow loop already subtracts an
// Amount from the account it is tagged to — so what `0299` added is the
// arrival: a loop keyed on `To Account`. These assert the pair moves in
// opposite directions and that Net Worth, being the sum of the accounts, does
// not move at all.
function logTransfer(w, { from, to, amount = 100 }) {
  const fid = (n) => w.fx.fields.find((f) => f.name === n)?.id;
  const row = logSpend(w, { account: from });
  row.fields[fid("Amount")] = { value: amount, flow: "out" };
  const toTile = w.fx.occurrences.find(
    (o) => (o.label || w.modulesById[o.moduleId]?.label) === to);
  expect(toTile, `no "${to}" tile`).toBeTruthy();
  row.fields[fid("To Account")] = { value: toTile.id, flow: "in" };
  return row;
}

describe("transfers between accounts", () => {
  it("moves money out of one account and into the other", () => {
    const w = world();
    const before = sweep(w);
    logTransfer(w, { from: "Checking Account", to: "Savings Account", amount: 100 });
    const got = sweep(w);
    expect(got["Checking Balance"] - before["Checking Balance"], "the transfer did not leave Checking").toBeCloseTo(-100, 2);
    expect(got["Savings Balance"] - before["Savings Balance"], "the transfer did not arrive in Savings").toBeCloseTo(100, 2);
  });

  it("leaves Net Worth alone — it is the sum of the accounts", () => {
    const w = world();
    const before = sweep(w);
    logTransfer(w, { from: "Checking Account", to: "Savings Account", amount: 100 });
    // Nothing special-cases a transfer: -100 and +100 net to zero because Net
    // Worth adds the balances up (0288). If this fails, it stopped being a sum.
    expect(sweep(w)["Net Worth"] - before["Net Worth"]).toBeCloseTo(0, 2);
  });

  it("a spend is NOT a transfer — no destination, no arrival", () => {
    const w = world();
    // The CONTROL. Without it, "the arrival works" would also be satisfied by
    // an in-leg that admits every untagged row: the gate on `To Account` is
    // strict precisely so an ordinary spend cannot read as money arriving.
    const before = sweep(w);
    logSpend(w, { account: "Checking Account" });
    const got = sweep(w);
    expect(got["Checking Balance"] - before["Checking Balance"]).toBeCloseTo(-50, 2);
    expect(got["Savings Balance"] - before["Savings Balance"], "an ordinary spend arrived somewhere").toBeCloseTo(0, 2);
  });
});

describe("purchase history", () => {
  // `Purchase History` was never broken — it fires cleanly and writes. What it
  // wrote was `label: "$inst.label"`, so every row read **"Spend"** and
  // `Last Purchase` was the word "Spend" forever. `0301` names the row by what
  // was bought, the way Workout History has always named its movement.
  const buy = (w, amount = 35) => {
    const fid = (n) => w.fx.fields.find((f) => f.name === n)?.id;
    const lbl = (o) => o.label || w.modulesById[o.moduleId]?.label;
    const bc = fid("Board Category");
    const item = w.fx.occurrences.find((o) => {
      const v = o.fields?.[bc]?.value;
      const arr = Array.isArray(v) ? v : (v ? [v] : []);
      return lbl(o) && arr.some((t) => ["grocery", "wishlist", "ingredient"].includes(t));
    });
    expect(item, "no option in the Purchase Item pool to buy").toBeTruthy();
    const row = logSpend(w, { account: "Checking Account" });
    row.fields[fid("Amount")] = { value: amount, flow: "out" };
    row.fields[fid("Purchase Item")] = { value: [item.id], flow: "in" };
    return lbl(item);
  };

  const purchases = (w) => {
    const ids = Object.fromEntries(w.fx.fields
      .filter((f) => ["Purchases", "Last Purchase"].includes(f.name)).map((f) => [f.id, f.name]));
    const ops = w.fx.operations.filter((o) => o.enabled !== false);
    const grid = w.fx.grid;
    const updates = runMatchingOperations(ops, null, null, {
      state: { grid, gridId: grid?._id, fields: w.fx.fields, modules: w.fx.modules,
               occurrencesById: w.occurrencesById, modulesById: w.modulesById,
               fieldsById: w.fieldsById, operationsById: w.opsById, operations: ops },
      fieldsById: w.fieldsById, operationsById: w.opsById,
      occurrencesById: w.occurrencesById, modulesById: w.modulesById,
    }, { onError: () => {}, onSuccess: () => {} }) || [];
    const out = {};
    for (const e of updates) {
      const n = ids[e.fieldId || e.payload?.fieldId];
      if (n) out[n] = e.value ?? e.payload?.value;
    }
    return out;
  };

  it("records nothing when nothing was bought", () => {
    // CONTROL: an empty list is the honest baseline here, and it is only
    // meaningful beside the test below that fills it.
    expect(purchases(world())["Purchases"]).toEqual([]);
  });

  it("names the row by what was bought, not by the routine", () => {
    const w = world();
    const bought = buy(w);
    const got = purchases(w);
    expect(got["Purchases"], "no purchase was recorded").toHaveLength(1);
    expect(got["Purchases"][0].label, 'the row is still labelled by the routine ("Spend")').toBe(bought);
    expect(got["Purchases"][0].amount).toBe(35);
    expect(got["Last Purchase"]).toBe(bought);
  });
});

describe("account balances", () => {
  it("every balance op still writes a number", () => {
    const got = sweep(world());
    for (const n of ["Checking Balance", "Savings Balance", "Net Worth"]) {
      expect(got[n], `"${n}" was never written by the sweep`).toBeTypeOf("number");
    }
  });

  it("measures DELTAS, because the baseline is real money and moves", () => {
    // THIS TEST USED TO ASSERT THE BASELINE WAS ZERO. It was, the morning it
    // was written — every money-bearing row on the grid was catalog (the Spend
    // action, the bill options, the savings goals) and none was completed. The
    // user then logged real transactions and every absolute assertion here
    // went red at once: -50 became -45.84 against a Checking balance of 4.16.
    //
    // That is 2026-08-20 (6) verbatim: *any test whose premise is "this starts
    // empty" is a coin flip on timing.* So the suite measures what an injected
    // row CHANGES, which is true whatever the balance happens to be today.
    const w = world();
    const before = sweep(w);
    for (const n of ["Checking Balance", "Savings Balance", "Net Worth"]) {
      expect(before[n], `"${n}" was never written by the sweep`).toBeTypeOf("number");
    }
  });

  it("an UNTAGGED spend lands in Checking — the default the user chose", () => {
    const w = world();
    const before = sweep(w);
    logSpend(w);
    const after = sweep(w);
    expect(after["Checking Balance"] - before["Checking Balance"], "untagged money did not reach Checking").toBeCloseTo(-50, 2);
    expect(after["Savings Balance"] - before["Savings Balance"], "untagged money leaked into Savings").toBeCloseTo(0, 2);
  });

  it("a TAGGED spend lands in its own account and nowhere else", () => {
    const w = world();
    const before = sweep(w);
    logSpend(w, { account: "Savings Account" });
    const got = sweep(w);
    // This is the arm that makes the previous test mean something: without it,
    // "untagged → Checking" is also satisfied by "everything → Checking".
    expect(got["Savings Balance"] - before["Savings Balance"], "a tagged spend did not reach its account").toBeCloseTo(-50, 2);
    expect(got["Checking Balance"] - before["Checking Balance"], "a tagged spend also hit Checking — the gate is not exclusive").toBeCloseTo(0, 2);
  });
});
