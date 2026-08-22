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
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runMatchingOperations } from "../helpers/operationExecutor";

vi.setConfig({ testTimeout: 60000 });

let fx;
beforeAll(() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString("utf8"));
});

function sweep(mutate) {
  const operations = fx.operations.filter((o) => o.enabled !== false);
  const fieldsById = Object.fromEntries(fx.fields.map((f) => [f.id, f]));
  const modulesById = Object.fromEntries(fx.modules.map((m) => [m.id, m]));
  const occurrencesById = Object.fromEntries(fx.occurrences.map((o) => [o.id, structuredClone(o)]));
  const operationsById = Object.fromEntries(operations.map((o) => [o.id, o]));
  if (mutate) mutate({ occurrencesById, modulesById, fieldsById });
  const state = { grid: fx.grid, gridId: fx.grid?._id, fields: fx.fields, modules: Object.values(modulesById),
    occurrencesById, modulesById, fieldsById, operationsById, operations };
  let placed = 0;
  runMatchingOperations(operations, null, null,
    { state, fieldsById, operationsById, occurrencesById, modulesById },
    { onError: () => {}, onSuccess: (name, fxs) => {
        if (/Place Weekday|Fill Day/.test(name))
          placed += (fxs || []).filter((e) => e._effect === "CREATE_ITEM").length;
      } });
  return placed;
}

const SF = "vQ0ELZP_zxnx";

describe("the Routine layer merges without duplicating", () => {
  it("A — the column already holds its routines, so the sweep creates NOTHING", () => {
    expect(sweep(null)).toBe(0);
  });

  it("B — strip them off the column and the sweep puts back exactly seven", () => {
    let removed = 0;
    const placed = sweep(({ occurrencesById }) => {
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
    // THE CONTROL. A strip that matched nothing makes "seven placed" a claim about the fixture.
    expect(removed, "the strip matched no routine rows — arm B proves nothing").toBe(7);
    expect(placed).toBe(7);
  });
});
