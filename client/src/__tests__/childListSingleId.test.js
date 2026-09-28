// ADD_CHILD / REMOVE_CHILD must refuse a multi-match the way SET_FIELD_VALUE
// already does — and the reason is a write that LEFT the app malformed.
//
// FIND binds an ARRAY when its predicate matches several records (its own
// documented contract). `Schedule: Place Dated Work` on the rebuild grid finds
// its slot by LABEL under the Schedule page; that was unambiguous until
// `Schedule: Build Schedule` created a day column carrying a second container
// labelled "12:00pm", and then:
//
//     $slotId       ["34ea189f…" (the loose 12:00pm), "3c4cb4cf…" (the column's)]
//     ADD_CHILD     emitted  update_occurrence { id: [ … ] }
//     prod log      CastError: Cast to string failed for value "[…]" (type Array)
//                   at path "id"   ×14 from a single toolbar date step
//
// The app showed nothing: `[op-effects]` counted the step as applied and the
// failure lived only in the server's error log. SET_FIELD_VALUE's guard (and
// its test, "refuses a multi-match binding rather than picking one") is the
// decision this adopts — one definition now, in `singleOccurrenceId`.
import { describe, it, expect } from "vitest";
import { executeActionItem, singleOccurrenceId } from "../helpers/operationActions";

const ctx = (occs = {}) => ({ state: {}, fieldsById: {}, occurrencesById: occs, operationsById: {} });
const parent = (children = []) => ({ "p-1": { id: "p-1", occurrences: children } });

describe("singleOccurrenceId", () => {
  it("passes a plain id through", () => {
    expect(singleOccurrenceId("occ-1", "ADD_CHILD", "$x")).toBe("occ-1");
  });

  it("unwraps a record to its id", () => {
    expect(singleOccurrenceId({ id: "occ-2" }, "ADD_CHILD", "$x")).toBe("occ-2");
  });

  it("refuses an array, naming the action, the expression and the count", () => {
    expect(() => singleOccurrenceId(["a", "b", "c"], "ADD_CHILD", "$slotId"))
      .toThrow(/ADD_CHILD: \$slotId matched 3 records — bind one/);
  });

  it("refuses even a one-element array — a FIND that means one binds the bare id", () => {
    expect(() => singleOccurrenceId(["a"], "REMOVE_CHILD", "$x")).toThrow(/matched 1 records/);
  });

  it("leaves nothing as nothing, so the caller's own falsy guard still runs", () => {
    expect(singleOccurrenceId(null, "ADD_CHILD", "$x")).toBe(null);
    expect(singleOccurrenceId(undefined, "ADD_CHILD", "$x")).toBe(undefined);
  });
});

describe("ADD_CHILD", () => {
  it("lists the child under a single parent (control)", () => {
    const out = executeActionItem(
      "ADD_CHILD",
      { parentId: "$slotId", childId: "$appt.id" },
      { $slotId: "p-1", $appt: { id: "c-9" } },
      ctx(parent([])),
      null,
    );
    expect(out).toEqual([
      { _effect: "UPDATE_OCCURRENCE", occurrence: { id: "p-1", occurrences: ["c-9"] }, occurrencesBase: [] },
    ]);
  });

  it("refuses a parent that matched several records", () => {
    expect(() =>
      executeActionItem(
        "ADD_CHILD",
        { parentId: "$slotId", childId: "$appt.id" },
        { $slotId: ["p-1", "p-2"], $appt: { id: "c-9" } },
        ctx(parent([])),
        null,
      ),
    ).toThrow(/ADD_CHILD: \$slotId matched 2 records/);
  });

  it("refuses a CHILD that matched several records too", () => {
    expect(() =>
      executeActionItem(
        "ADD_CHILD",
        { parentId: "$slotId", childId: "$rows" },
        { $slotId: "p-1", $rows: ["c-1", "c-2"] },
        ctx(parent([])),
        null,
      ),
    ).toThrow(/ADD_CHILD: \$rows matched 2 records/);
  });

  it("emits nothing at all when the array reaches it — no malformed write", () => {
    // The shipped behaviour emitted `{ id: ["p-1","p-2"] }`; the server
    // answered with a CastError the app never surfaced.
    let out = null;
    try {
      out = executeActionItem(
        "ADD_CHILD",
        { parentId: "$slotId", childId: "$appt.id" },
        { $slotId: ["p-1", "p-2"], $appt: { id: "c-9" } },
        ctx(parent([])),
        null,
      );
    } catch { /* the refusal is asserted above */ }
    expect(out).toBe(null);
  });
});

describe("REMOVE_CHILD", () => {
  it("unlists the child from a single parent (control)", () => {
    const out = executeActionItem(
      "REMOVE_CHILD",
      { parentId: "$slotId", childId: "$row" },
      { $slotId: "p-1", $row: "c-9" },
      ctx(parent(["c-9", "c-8"])),
      null,
    );
    expect(out).toEqual([
      { _effect: "UPDATE_OCCURRENCE", occurrence: { id: "p-1", occurrences: ["c-8"] }, occurrencesBase: ["c-9", "c-8"] },
    ]);
  });

  it("refuses a parent that matched several records", () => {
    expect(() =>
      executeActionItem(
        "REMOVE_CHILD",
        { parentId: "$slotId", childId: "$row" },
        { $slotId: ["p-1", "p-2"], $row: "c-9" },
        ctx(parent(["c-9"])),
        null,
      ),
    ).toThrow(/REMOVE_CHILD: \$slotId matched 2 records/);
  });
});
