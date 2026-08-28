import { describe, it, expect } from "vitest";
import {
  planTaskRestore,
  dimensionTaskIds,
  DAMAGE_FROM,
  DAMAGE_TO,
} from "../migrations/0273-restore-probe-ticked-tasks.mjs";

const CF = "tZWiPDQUDP74";
const WINDOW = { from: DAMAGE_FROM, to: DAMAGE_TO };
const INSIDE = "2026-08-27T18:05:49.748Z";   // a real flip from the log
const AFTER = "2026-08-28T14:00:00.000Z";
const BEFORE = "2026-08-20T09:00:00.000Z";

const task = (id, completed, at) => ({
  id,
  fields: completed === undefined ? {} : { [CF]: { value: completed, flow: "in" } },
  fieldUpdatedAt: at ? { [CF]: at } : {},
});
const prior = (id, completed) => [id, { id, fields: completed === undefined ? {} : { [CF]: { value: completed } } }];

describe("0273 — dimensionTaskIds", () => {
  it("scopes to children of containers that HIDE completed rows", () => {
    const occs = [
      { id: "physical", filters: [{ active: true, hides: true }], occurrences: ["t1", "t2"] },
      { id: "completed", filters: [], occurrences: ["copy1"] },   // the feed container
      { id: "t1" }, { id: "t2" }, { id: "copy1" },
    ];
    const scope = dimensionTaskIds(occs);
    expect([...scope].sort()).toEqual(["t1", "t2"]);
    // The feed copies must never be in scope — feedSync owns them.
    expect(scope.has("copy1")).toBe(false);
  });

  it("ignores an INACTIVE hide filter", () => {
    const occs = [
      { id: "c", filters: [{ active: false, hides: true }], occurrences: ["t1"] },
      { id: "t1" },
    ];
    expect(dimensionTaskIds(occs).size).toBe(0);
  });
});

describe("0273 — planTaskRestore", () => {
  const scope = new Set(["t1", "t2", "t3", "t4", "t5"]);

  it("restores a row the probe ticked: was absent, is true, ticked inside the window", () => {
    const live = [task("t1", true, INSIDE)];
    const { restore, kept } = planTaskRestore(live, new Map([prior("t1", undefined)]), CF, scope, WINDOW);
    expect(restore).toEqual([{ id: "t1", priorField: null, source: "snapshot" }]);   // null => $unset the key
    expect(kept).toEqual([]);
  });

  it("restores a stored FALSE as false, not as an absent key", () => {
    const live = [task("t2", true, INSIDE)];
    const { restore } = planTaskRestore(live, new Map([prior("t2", false)]), CF, scope, WINDOW);
    expect(restore[0].priorField).toEqual({ value: false });
  });

  it("KEEPS a completion made AFTER the window — the guard that protects real work", () => {
    const live = [task("t3", true, AFTER)];
    const { restore, kept } = planTaskRestore(live, new Map([prior("t3", undefined)]), CF, scope, WINDOW);
    expect(restore).toEqual([]);
    expect(kept[0].why).toMatch(/OUTSIDE the probe window/);
  });

  it("KEEPS a completion made BEFORE the window", () => {
    const live = [task("t3", true, BEFORE)];
    const { restore, kept } = planTaskRestore(live, new Map([prior("t3", undefined)]), CF, scope, WINDOW);
    expect(restore).toEqual([]);
    expect(kept[0].why).toMatch(/OUTSIDE the probe window/);
  });

  it("KEEPS a row that was ALREADY complete before the window", () => {
    const live = [task("t4", true, INSIDE)];
    const { restore, kept } = planTaskRestore(live, new Map([prior("t4", true)]), CF, scope, WINDOW);
    expect(restore).toEqual([]);
    expect(kept[0].why).toMatch(/ALREADY complete/);
  });

  it("KEEPS a row missing from the snapshot rather than guessing", () => {
    const live = [task("t5", true, INSIDE)];
    const { restore, kept } = planTaskRestore(live, new Map(), CF, scope, WINDOW);
    expect(restore).toEqual([]);
    expect(kept[0].why).toMatch(/absent from the pre-damage snapshot/);
  });

  it("KEEPS a row with no fieldUpdatedAt — it cannot be placed in time", () => {
    const live = [task("t1", true, null)];
    const { restore, kept } = planTaskRestore(live, new Map([prior("t1", undefined)]), CF, scope, WINDOW);
    expect(restore).toEqual([]);
    expect(kept[0].why).toMatch(/cannot place it in time/);
  });

  it("ignores a row that is not complete now, and one outside the scope", () => {
    const live = [task("t1", false, INSIDE), task("outsider", true, INSIDE)];
    const { restore, kept } = planTaskRestore(live, new Map([prior("t1", undefined), prior("outsider", undefined)]), CF, scope, WINDOW);
    expect(restore).toEqual([]);
    expect(kept).toEqual([]);
  });

  it("CONTROL: a mixed set separates cleanly — only the probe's rows are restored", () => {
    const live = [
      task("t1", true, INSIDE),   // probe        -> restore
      task("t2", true, INSIDE),   // probe        -> restore
      task("t3", true, AFTER),    // user, since  -> keep
      task("t4", true, INSIDE),   // already done -> keep
      task("t5", false, INSIDE),  // not complete -> ignored
    ];
    const priors = new Map([prior("t1", undefined), prior("t2", false), prior("t3", undefined), prior("t4", true), prior("t5", undefined)]);
    const { restore, kept } = planTaskRestore(live, priors, CF, scope, WINDOW);
    expect(restore.map(r => r.id)).toEqual(["t1", "t2"]);
    expect(kept.map(k => k.id)).toEqual(["t3", "t4"]);
  });
});

describe("0273 — the transaction-log exception", () => {
  const scope = new Set(["ptx"]);
  const INSIDE2 = "2026-08-27T17:32:58.209Z";

  it("restores a row the snapshot cannot cover when the tx log states its prior value", () => {
    const live = [task("ptx", true, INSIDE2)];
    const { restore, kept } = planTaskRestore(live, new Map(), CF, scope, WINDOW, new Map([["ptx", null]]));
    expect(restore).toEqual([{ id: "ptx", priorField: null, source: "transaction log" }]);
    expect(kept).toEqual([]);
  });

  it("still KEEPS a snapshot-absent row that is NOT in the exception list", () => {
    const live = [task("ptx", true, INSIDE2)];
    const { restore, kept } = planTaskRestore(live, new Map(), CF, scope, WINDOW, new Map());
    expect(restore).toEqual([]);
    expect(kept[0].why).toMatch(/absent from the pre-damage snapshot/);
  });

  it("the exception does NOT bypass the window guard", () => {
    const live = [task("ptx", true, "2026-08-28T14:00:00.000Z")];
    const { restore, kept } = planTaskRestore(live, new Map(), CF, scope, WINDOW, new Map([["ptx", null]]));
    expect(restore).toEqual([]);
    expect(kept[0].why).toMatch(/OUTSIDE the probe window/);
  });

  it("the exception does NOT bypass the already-complete guard", () => {
    const live = [task("ptx", true, INSIDE2)];
    const { restore, kept } = planTaskRestore(live, new Map(), CF, scope, WINDOW, new Map([["ptx", { value: true }]]));
    expect(restore).toEqual([]);
    expect(kept[0].why).toMatch(/ALREADY complete/);
  });

  it("CONTROL: a snapshot prior still wins and is labelled as such", () => {
    const live = [task("ptx", true, INSIDE2)];
    const { restore } = planTaskRestore(live, new Map([prior("ptx", false)]), CF, scope, WINDOW, new Map([["ptx", null]]));
    expect(restore[0].source).toBe("snapshot");
    expect(restore[0].priorField).toEqual({ value: false });
  });
});
