// Task 3 Steps 2 + 3 of docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md
//
// STEP 2 — one action scope per intake, so ONE undo reverts the whole thing.
//   An intake mints modules, occurrences, a parent-list update and then an
//   upload. Without a scope each of those is its own undo step, which is the
//   exact failure `helpers/actionScope.js` was written for.
//
// STEP 3 — everything intake mints carries `parentFilterFields` from its
//   destination. A file dropped on today's column that carries no date is
//   INVISIBLE to the date filter the moment it renders — the same class the
//   2026-08-05 entry records for typed textblocks ("any occurrence can carry
//   fields"). The drop path stamped it since 2026-05-07; the ARTIFACT path
//   never did.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { applyIntakeShape } from "../helpers/intakeApply";
import { INTAKE_SHAPES } from "../helpers/intake";
import { createArtifactPlaceholders } from "../helpers/artifactUpload";
import { getActionId, _resetActionScope, forceEndAction } from "../helpers/actionScope";
import { operationsBridge } from "../state/bindSocketToStore";

describe("intake: one action scope per intake (Step 2)", () => {
  beforeEach(() => { forceEndAction(); _resetActionScope(); });
  afterEach(() => { forceEndAction(); });

  it("runs the route INSIDE an open action, and closes it afterwards", () => {
    expect(getActionId()).toBeNull();

    let idDuringRun = "not-run";
    const ctx = { onLegacyLink: () => { idDuringRun = getActionId(); } };
    applyIntakeShape(INTAKE_SHAPES.LINK_INSTANCE.id, ctx);

    // The assertion that discriminates: the write must see an OPEN action.
    // Asserting only "an action existed at some point" would pass even if the
    // scope opened and closed before the route ran.
    expect(idDuringRun).not.toBe("not-run");
    expect(idDuringRun).toBeTruthy();
    expect(getActionId()).toBeNull();
  });

  it("groups every write of one intake under a SINGLE action id", () => {
    const seen = [];
    const ctx = { onLegacyLink: () => { seen.push(getActionId()); seen.push(getActionId()); } };
    applyIntakeShape(INTAKE_SHAPES.LINK_INSTANCE.id, ctx);
    expect(seen).toHaveLength(2);
    // `toBeTruthy` first: without it two NULLs also form a set of size 1, so
    // this would pass against the unfixed code — a vacuous assertion.
    for (const id of seen) expect(id).toBeTruthy();
    expect(new Set(seen).size).toBe(1);
  });

  it("leaves no action open when the route THROWS", () => {
    const ctx = { onLegacyLink: () => { throw new Error("boom"); } };
    expect(() => applyIntakeShape(INTAKE_SHAPES.LINK_INSTANCE.id, ctx)).toThrow("boom");
    // A leaked scope would swallow every later write into a stale action and
    // undo would revert far too much — the backstop this asserts is why
    // withAction uses try/finally.
    expect(getActionId()).toBeNull();
  });

  it("does not open an action for an unrouted shape (nothing is written)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = applyIntakeShape("no-such-shape", {});
    expect(res.ok).toBe(false);
    expect(getActionId()).toBeNull();
    warn.mockRestore();
  });
});

// INVERTED 2026-09-29: Step 3 stamped the destination's filter date onto every
// minted artifact. The app no longer stamps (the user: "stamping something with
// the date and using the date filter are two diff things"); an artifact with no
// date passes the filter, and dating Schedule adds is an operation's job. The
// bridge is still wired with a dated filter, so an empty result means nothing
// read it.
describe("intake: minted artifacts carry only the caller's fields (Step 3, inverted)", () => {
  const FILE = { name: "a.png", type: "image/png", size: 10 };
  let prevGetFilterContext;
  beforeEach(() => { prevGetFilterContext = operationsBridge.getFilterContext; });
  afterEach(() => { operationsBridge.getFilterContext = prevGetFilterContext; });

  function withFilter(dateFieldId, value) {
    operationsBridge.getFilterContext = () => ({
      state: { grid: {
        activeFilterId: "f1",
        namedFilters: [{ id: "f1", conditions: [{ fieldId: dateFieldId, isNav: true }] }],
        activeFilterValues: { [dateFieldId]: value },
      } },
      occurrencesById: {},
    });
  }

  it("does NOT stamp the destination's filter date", () => {
    withFilter("f-date", "2026-08-07");
    const [p] = createArtifactPlaceholders([FILE], {
      gridId: "g", userId: "u", dispatch: vi.fn(), occExtra: () => ({ parentId: "col-today" }),
    });
    expect(p.occurrence.fields).toEqual({});
  });

  it("passes caller-supplied fields through (control)", () => {
    withFilter("f-date", "2026-08-07");
    const [p] = createArtifactPlaceholders([FILE], {
      gridId: "g", userId: "u", dispatch: vi.fn(),
      occExtra: () => ({ parentId: "col-today", fields: { "f-date": { value: "2026-01-01" } } }),
    });
    expect(p.occurrence.fields).toEqual({ "f-date": { value: "2026-01-01" } });
  });
});
