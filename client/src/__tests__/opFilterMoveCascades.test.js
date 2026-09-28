// An OPERATION that moves a page's filter must fire that page's navigation.
//
// The UPDATE_ITEM_FILTER_OVERRIDE effect calls updateOccurrenceFilterOverride
// "so the NavigationOp cascade fires … the same path a nav widget takes" — but
// passed `modulesById: state.modulesById`, and store state keeps `modules` as
// an ARRAY with no id map. The helper's `if (!occurrencesById || !modulesById)
// return` then exited after writing the value and BEFORE building the cascade:
// every op-driven page-filter move persisted and ran nothing. Invisible on
// poms because its morning snap also moves the GRID filter (a separate path).
// Found 2026-09-28: a day column's date change moved the Schedule page (via an
// op) and the page's builder never ran. filterOverrideEffect.test.js passes a
// module map itself, which is exactly why it could not see this.
import { describe, it, expect, vi } from "vitest";
import { bindSocketToStore, operationsBridge } from "../state/bindSocketToStore";

vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {}, removeItem: () => {} });
const D = "fDate";

describe("an op's page-filter move fires the page's navigation", () => {
  it("UPDATE_ITEM_FILTER_OVERRIDE, with store-shaped state, fires a NavigationOp for the page", async () => {
    const socket = { on() {}, emit() {}, connected: true };
    const stateRef = { current: {
      modules: [{ id: "mPage", role: "page", label: "Schedule" }],           // an ARRAY, as the store keeps it
      occurrences: [{ id: "page", moduleId: "mPage", occurrences: [], filterOverride: { [D]: "2026-09-28" } }],
      operations: [], fields: [], grid: { activeFilterValues: {} },
    } };
    bindSocketToStore(socket, () => {}, stateRef);
    // The app seeds the executor's local overlay from the load payload; the
    // effect reads the page from there (on prod the page DID move — only the
    // cascade was missing).
    operationsBridge.updateLocalOcc(stateRef.current.occurrences[0]);
    const fired = [];
    operationsBridge.fireOperationsBatch = (type, txs) => fired.push(...txs.map((t) => [type, t.sourceOccurrenceId]));
    operationsBridge.applyEffect({ _effect: "UPDATE_ITEM_FILTER_OVERRIDE", itemId: "page", fieldId: D, value: "2026-09-29" });
    await new Promise((r) => setTimeout(r, 50));   // the cascade is deferred to the next frame
    expect(fired).toContainEqual(["NavigationOp", "page"]);
  });
});
