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

describe("account balances", () => {
  it("every balance op still writes a number", () => {
    const got = sweep(world());
    for (const n of ["Checking Balance", "Savings Balance", "Net Worth"]) {
      expect(got[n], `"${n}" was never written by the sweep`).toBeTypeOf("number");
    }
  });

  it("the grid's own money rows are catalog, not transactions — so a zero baseline is expected", () => {
    const w = world();
    const amtF = w.fx.fields.filter((f) => f.name === "Amount").map((f) => f.id);
    const money = w.fx.occurrences.filter((o) => amtF.some((a) => o.fields?.[a]?.value != null));
    // CONTROL: there ARE money-bearing rows, so the next assertion is about
    // their shape rather than about an empty set.
    expect(money.length, "no rows carry an Amount at all — the probe is wrong").toBeGreaterThan(5);
    // The discriminator is COMPLETION, not parentage — the catalog rows are
    // parented under Routines and the bill boards, so "has a parent" says
    // nothing. What no catalog row has is a tick: a balance counts a
    // transaction only once it is completed on the schedule.
    const doneF = w.fx.fields.find((f) => f.name === "Completed")?.id;
    const logged = money.filter((o) => o.fields?.[doneF]?.value === true);
    expect(logged.length, "money is now logged — the baseline zeros are stale").toBe(0);
    expect(sweep(w)["Checking Balance"]).toBe(0);
  });

  it("an UNTAGGED spend lands in Checking — the default the user chose", () => {
    const w = world();
    logSpend(w);
    const got = sweep(w);
    expect(got["Checking Balance"], "untagged money did not reach Checking").toBe(-50);
    expect(got["Savings Balance"], "untagged money leaked into Savings").toBe(0);
    expect(got["Net Worth"]).toBe(-50);
  });

  it("a TAGGED spend lands in its own account and nowhere else", () => {
    const w = world();
    logSpend(w, { account: "Savings Account" });
    const got = sweep(w);
    // This is the arm that makes the previous test mean something: without it,
    // "untagged → Checking" is also satisfied by "everything → Checking".
    expect(got["Savings Balance"], "a tagged spend did not reach its account").toBe(-50);
    expect(got["Checking Balance"], "a tagged spend also hit Checking — the gate is not exclusive").toBe(0);
    expect(got["Net Worth"]).toBe(-50);
  });
});
