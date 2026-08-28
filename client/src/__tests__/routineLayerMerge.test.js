// __tests__/routineLayerMerge.test.js
//
// THE `Routine` LAYER, DRIVEN THROUGH THE REAL EXECUTOR — does `Fill Day` place it, and
// does it place it TWICE?
//
// `0185` moved the seven daily routines off the `Day` template onto a layer of their own,
// so they are now merged onto the column on every load rather than stamped once when the
// slot is first created. That buys self-healing — and it is exactly the shape that produced
// 23 duplicate Daily Question wrappers in a day (2026-07-31) when the identity check missed.
//
// TWO ARMS, AND NEITHER MEANS ANYTHING WITHOUT THE OTHER:
//   A  the column already holds them -> the sweep must create NOTHING
//   B  strip them off the column     -> the sweep must put back exactly SEVEN
//
// A alone is satisfied by an op that does nothing at all; B alone is satisfied by an op that
// duplicates on every load. The pair is the claim.
//
// MY FIRST VERSION FAILED ARM B AGAINST WORKING CODE, and the reason is worth keeping: I
// counted creates by reading `effect.name`, which a merge's `CREATE_ITEM` does not carry, so
// a correct run looked like an op that placed nothing. The op's own emit count said 7 the
// whole time. Check the probe before believing the failure.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations, applyEffectsToLiveOccs } from "../helpers/operationExecutor";

vi.setConfig({ testTimeout: 60000 });

// PINNED TO THE FIXTURE'S OWN DAY COLUMN.
//
// These assertions are about "today's column", and the ops resolve `$today` from
// the wall clock — so an unpinned suite is green the day the fixture is exported
// and red the next morning. All three files that read this fixture went red at
// midnight on 2026-08-23, which is the failure CLAUDE.md 2026-08-20 (2) records:
// *"a suite that fails by the calendar gets disabled rather than read."*
//
// The anchor is the DATE THE FIXTURE'S DAY COLUMN CARRIES, not `_exportedAt` and
// not a hardcoded day. `_exportedAt` makes the tests depend on which weekday
// somebody last ran the exporter (2026-08-21, when a Friday export left a column
// with no movements); the column's own date is a fact about the data in front of
// them, and it survives a re-export taken on any day.
function fixtureDayFrom(fx) {
  const SF = fx.fields.find((f) => f.name === "Schedule Format")?.id;
  const DATE = fx.fields.find((f) => f.name === "Date" && f.type === "date")?.id;
  const col = fx.occurrences.find((o) => o.fields?.[SF]?.value === "day-col" && o.fields?.[DATE]?.value);
  const d = col?.fields?.[DATE]?.value;
  if (!d) throw new Error("fixture carries no dated day column — cannot pin the clock to it");
  return String(d).slice(0, 10);
}

let fx;
beforeAll(() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString("utf8"));
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${fixtureDayFrom(fx)}T12:00:00`));
});

// Run the sweep, APPLY what it emitted, and run it again. The second pass is the real
// anti-duplication claim: "creates nothing" on a single pass is also true of an op that
// has simply not been given anything new to place, and it goes stale the moment a row is
// added to a layer — which `0187` did eight times an hour after this test was written.
function sweepTwice(mutate) {
  const first = sweep(mutate, true);
  return { first: first.placed, second: first.again };
}

function sweep(mutate, twice) {
  const operations = fx.operations.filter((o) => o.enabled !== false);
  const fieldsById = Object.fromEntries(fx.fields.map((f) => [f.id, f]));
  const modulesById = Object.fromEntries(fx.modules.map((m) => [m.id, m]));
  const occurrencesById = Object.fromEntries(fx.occurrences.map((o) => [o.id, structuredClone(o)]));
  const operationsById = Object.fromEntries(operations.map((o) => [o.id, o]));
  if (mutate) mutate({ occurrencesById, modulesById, fieldsById });
  const state = { grid: fx.grid, gridId: fx.grid?._id, fields: fx.fields, modules: Object.values(modulesById),
    occurrencesById, modulesById, fieldsById, operationsById, operations };
  const ctx = { state, fieldsById, operationsById, occurrencesById, modulesById };
  const count = () => {
    let n = 0;
    const updates = runMatchingOperations(operations, null, null, ctx,
      { onError: () => {}, onSuccess: (name, fxs) => {
          if (/Place Weekday|Fill Day/.test(name))
            n += (fxs || []).filter((e) => e._effect === "CREATE_ITEM").length;
        } }) || [];
    return { n, updates };
  };
  const a = count();
  if (!twice) return a.n;
  applyEffectsToLiveOccs(occurrencesById, a.updates);
  return { placed: a.n, again: count().n };
}

const SF = "vQ0ELZP_zxnx";

afterAll(() => { vi.useRealTimers(); });

describe("the Routine layer merges without duplicating", () => {
  it("A — a column that already holds its layers gets NOTHING new", () => {
    // The control is that the column really does hold them; "placed 0" is otherwise also
    // true of an op that cannot place at all.
    //
    // THIS ARM USED TO ASSERT `first > 0` AND IT WAS A TIMING BET. It relied on the fixture
    // being exported while some layer row had not yet reached the column — true the moment
    // `0187` added eight Drinks, false an hour later once prod restarted and a real load
    // placed them. A fixture is a snapshot of a grid that changes; any test whose premise is
    // "there is pending work" is a coin flip on export timing (2026-08-20 (6), third time).
    const occ = Object.fromEntries(fx.occurrences.map((o) => [o.id, o]));
    const col = Object.values(occ).find((o) => o.fields?.[SF]?.value === "day-col");
    const onColumn = (col.occurrences || [])
      .flatMap((sid) => occ[sid]?.occurrences || [])
      .filter((rid) => occ[rid]?.identitySignature?.startsWith("auto:"));
    expect(onColumn.length, "the column holds no merged routine rows — arm A proves nothing")
      .toBeGreaterThan(0);
    expect(sweep(null), "Fill Day re-created rows the column already had").toBe(0);
  });

  it("B — strip them off the column and the sweep puts back exactly seven", () => {
    let removed = 0;
    const { first: placed, second } = sweepTwice(({ occurrencesById }) => {
      const col = Object.values(occurrencesById).find((o) => o.fields?.[SF]?.value === "day-col");
      for (const sid of col.occurrences || []) {
        const slot = occurrencesById[sid];
        if (!slot) continue;
        const keep = [];
        for (const rid of slot.occurrences || []) {
          // `auto:<templateRowId>` is what 0185 stamped on exactly the seven routine rows
          if (occurrencesById[rid]?.identitySignature?.startsWith("auto:")) {
            delete occurrencesById[rid]; removed++;
          } else keep.push(rid);
        }
        slot.occurrences = keep;
      }
    });
    // THE CONTROL. A strip that matched nothing makes "the sweep put them back" a
    // claim about the fixture rather than about the sweep.
    //
    // IT USED TO REQUIRE EXACTLY SEVEN, and that broke on the 2026-08-28 refresh
    // (23). `auto:<id>` is `signatureOf`'s FALLBACK — stamped on ANY unsigned
    // node a merge clones in — so the count is "how many merged rows are on
    // today's column", which grows as layers are added and moves with the
    // calendar. Seven was one day's schedule, not an invariant.
    //
    // The invariant is the round trip: strip N and the sweep puts back at least
    // N, then converges. That is what the test is named for and it holds on any
    // day. A/B'd — a sweep that places nothing still fails it.
    expect(removed, "the strip matched no routine rows — arm B proves nothing").toBeGreaterThan(0);
    expect(placed, "the sweep did not replace what was stripped").toBeGreaterThanOrEqual(removed);
    expect(second, "the replacements were re-created on the next pass").toBe(0);
  });
});
