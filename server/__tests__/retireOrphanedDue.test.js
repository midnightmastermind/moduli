import { describe, it, expect } from "vitest";
import { planRetire } from "../migrations/0071-retire-orphaned-due-shells.mjs";

const TS = "f-ts";
const mk = (id, marker, kids = []) => ({ id, occurrences: kids, fields: marker ? { [TS]: { value: marker } } : {} });
const run = (occs) => planRetire({ occurrences: occs, timeslotFieldId: TS });

describe("0071 planRetire", () => {
  it("retires an orphaned Due whose children are already in a LIVE Todo", () => {
    const occs = [
      mk("col", null, ["todo"]),            // the day column lists the Todo
      mk("todo", "Todo", ["t1"]),
      mk("orphanDue", "Due", ["t1"]),       // listed by nobody
      mk("t1", null),
    ];
    const { retire, keep } = run(occs);
    expect(retire.map((r) => r.occ.id)).toEqual(["orphanDue"]);
    expect(keep).toEqual([]);
  });

  it("KEEPS a shell holding the only link to a task — the discriminating refusal", () => {
    // Deleting this would make the task unreachable. "Probably dead" is not
    // good enough for a delete.
    const occs = [
      mk("col", null, ["todo"]),
      mk("todo", "Todo", []),
      mk("orphanDue", "Due", ["t1"]),
      mk("t1", null),
    ];
    const { retire, keep } = run(occs);
    expect(retire).toEqual([]);
    expect(keep[0].unreachable).toEqual(["t1"]);
  });

  it("does NOT count an ORPHANED Todo as a home", () => {
    // A Todo nobody lists renders nowhere, so it cannot vouch for a child.
    const occs = [
      mk("orphanTodo", "Todo", ["t1"]),     // itself unlisted
      mk("orphanDue", "Due", ["t1"]),
      mk("t1", null),
    ];
    expect(run(occs).retire).toEqual([]);
  });

  it("leaves a Due that IS still listed to 0070, not this", () => {
    const occs = [mk("col", null, ["due", "todo"]), mk("due", "Due", ["t1"]), mk("todo", "Todo"), mk("t1", null)];
    const { retire, keep } = run(occs);
    expect(retire).toEqual([]); expect(keep).toEqual([]);
  });

  it("retires an EMPTY orphaned shell", () => {
    const occs = [mk("orphanDue", "Due", [])];
    expect(run(occs).retire.map((r) => r.occ.id)).toEqual(["orphanDue"]);
  });

  it("ignores a child id naming nothing rather than treating it as unreachable", () => {
    const occs = [mk("orphanDue", "Due", ["ghost"])];
    expect(run(occs).retire.map((r) => r.occ.id)).toEqual(["orphanDue"]);
  });

  it("is a no-op on a grid with no Due at all — the re-run guard", () => {
    const occs = [mk("col", null, ["todo"]), mk("todo", "Todo", ["t1"]), mk("t1", null)];
    const { retire, keep } = run(occs);
    expect(retire).toEqual([]); expect(keep).toEqual([]);
  });
});
