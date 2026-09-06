// Where a tracker tile's period label lives, driven through the real sweep.
//
// User, 2026-09-06: *"Tracker date for monthly bills says Invalid Date - 0d
// overdue. should be no overdue. should just say the month. also put all the
// accounts (cash, moms account, checking and savings on one tracker tile"* ->
// *"1 occurance, those fields and a tracker date."*
//
// TWO FIELDS, AND THE TYPE IS THE WHOLE POINT.
//
//   Tracker Date   type DATE   holds "2026-09-06"       — a day
//   Tracker Scope  type TEXT   holds "September 2026"   — a period, in words
//
// My own 0291 wrote the month name into the DATE field. It parses differently
// per engine — Firefox refuses it ("Invalid Date"), V8 reads it as Sept 1 — so
// the tile made a different wrong claim depending on the browser. 0309 moved it
// to the text field, where a month name is just a string.
//
// 0310 then put the four account balances on ONE tile, which takes the opposite
// route: it stops being cumulative so the DAILY loop claims it and stamps a
// real date.
//
// Driving the sweep is what makes this a test rather than an assertion about
// stored data: the label op has two loops that both write a period label, and
// which one claims a tile is decided by `meta.period` / `meta.cumulative`. Only
// running it says whether a tile is claimed by the right one.
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations } from "../helpers/operationExecutor";

vi.setConfig({ testTimeout: 60000 });

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(here, "fixtures", "pomsGrid.json.br");

let base;
beforeAll(() => { base = JSON.parse(brotliDecompressSync(readFileSync(FIXTURE)).toString()); });

function world() {
  const fx = JSON.parse(JSON.stringify(base));
  const by = (a) => Object.fromEntries(a.map((x) => [x.id, x]));
  return {
    fx,
    fieldsById: by(fx.fields), modulesById: by(fx.modules),
    occurrencesById: by(fx.occurrences), opsById: by(fx.operations),
  };
}

/** Every field write the sweep emits, keyed `occurrenceId::fieldId`. */
function sweepWrites(w) {
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

  const out = {};
  for (const e of updates) {
    const occ = e.itemId || e.occurrenceId || e.payload?.itemId || e.payload?.occurrenceId;
    const fid = e.fieldId || e.payload?.fieldId;
    if (occ && fid) out[`${occ}::${fid}`] = e.value ?? e.payload?.value;
  }
  return out;
}

const fieldId = (w, name) => w.fx.fields.find((f) => f.name === name)?.id;
const labelOf = (w, o) => o.label || w.modulesById[o.moduleId]?.label;
const tile = (w, label) => w.fx.occurrences.find((o) => labelOf(w, o) === label);

describe("a tracker tile's period label", () => {
  it("puts a real DATE on the accounts tile, in the date field", () => {
    const w = world();
    const t = tile(w, "Accounts");
    expect(t, "no Accounts tile — 0310 did not apply").toBeTruthy();

    const writes = sweepWrites(w);
    const dateV = writes[`${t.id}::${fieldId(w, "Tracker Date")}`];

    // A DATE field must receive something a date field can hold. This is the
    // exact shape the bug produced ("September 2026" in a date field), so the
    // assertion is on the FORMAT, not merely on presence.
    expect(dateV, "the accounts tile was never dated by the sweep").toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(new Date(dateV).getTime())).toBe(false);
  });

  it("puts the MONTH on the monthly tile, in the text field", () => {
    const w = world();
    const t = tile(w, "Monthly Bills");
    const writes = sweepWrites(w);

    const scopeV = writes[`${t.id}::${fieldId(w, "Tracker Scope")}`];
    expect(scopeV, "the monthly tile never got its month").toBeTruthy();
    expect(scopeV).toMatch(/^[A-Z][a-z]+ \d{4}$/);        // "September 2026"

    // And it must NOT be written into the date field — that is the reported bug.
    expect(writes[`${t.id}::${fieldId(w, "Tracker Date")}`]).toBeUndefined();
  });

  it("shows every account balance on that one tile", () => {
    const w = world();
    const t = tile(w, "Accounts");
    const mod = w.modulesById[t.moduleId];
    const shown = (mod.fieldBindings || [])
      .filter((b) => !b.hidden)
      .map((b) => w.fieldsById[b.fieldId]?.name);

    for (const n of ["Checking Balance", "Savings Balance", "Mom's Account", "Cash"]) {
      expect(shown, `"${n}" is not on the Accounts tile`).toContain(n);
    }
    expect(shown).toContain("Tracker Date");
  });

  it("keeps every account row addressable — the transactions point at them", () => {
    // The reason the four rows survived at all. A stored Account pick naming a
    // row that no longer exists is a silently broken transaction.
    const w = world();
    const acctF = fieldId(w, "Account");
    const picks = w.fx.occurrences.flatMap((o) => {
      const v = o.fields?.[acctF]?.value;
      return v == null ? [] : (Array.isArray(v) ? v : [v]);
    });
    expect(picks.length, "no Account picks in the fixture — it changed shape").toBeGreaterThan(0);
    for (const id of picks) expect(w.occurrencesById[id], `Account pick ${id} resolves to nothing`).toBeTruthy();
  });

  it("writes each balance exactly once — one home per number", () => {
    // The 0305 class: a number displayed in two places can only be written to
    // one of them, so the other is stale forever.
    const w = world();
    for (const n of ["Checking Balance", "Savings Balance", "Mom's Account", "Cash", "Spent", "Earned"]) {
      const fid = fieldId(w, n);
      const homes = w.fx.modules.filter((m) =>
        (m.fieldBindings || []).some((b) => b.fieldId === fid && !b.hidden));
      expect(homes.length, `"${n}" has ${homes.length} homes: ${homes.map((m) => m.label).join(", ")}`).toBe(1);
    }
  });
});
