// @vitest-environment jsdom
// The early load pass: an operation that looks up a row which has not arrived yet is marked, so its writes are
// dropped and it runs again with the catalogue (helpers/operationExecutor watchMisses).
import { describe, it, expect } from "vitest";
import { runMatchingOperations } from "../helpers/operationExecutor.js";

const tile = { id: "tileRow00001", moduleId: "m1", fields: {} };
const occurrencesById = { [tile.id]: tile };
const modulesById = { m1: { id: "m1", role: "instance", label: "Tile" } };
const op = (id, expr) => ({
  id, name: id, enabled: true,
  triggerObjects: [{ eventType: "onLoad" }], triggerTypes: ["onLoad"],
  pipeline: { steps: [{ id: "s1", type: "action", config: { type: "INIT_VAR", name: "$x", expr } }] },
});
const run = (ops, misses) => runMatchingOperations(ops, null, null, {
  state: { grid: {} }, fieldsById: {}, operationsById: Object.fromEntries(ops.map((o) => [o.id, o])),
  occurrencesById, modulesById, ...(misses ? { _earlyMisses: misses } : {}),
});

describe("the early pass watches lookups", () => {
  it("marks an operation that looks up a row that has not arrived", () => {
    const misses = new Set();
    run([op("reads-missing", "$allItemsById.notHereYet01"), op("reads-present", "$allItemsById.tileRow00001")], misses);
    expect([...misses]).toEqual(["reads-missing"]);
  });
  it("marks nothing outside the early pass", () => {
    expect(() => run([op("reads-missing", "$allItemsById.notHereYet01")], null)).not.toThrow();
  });
});
