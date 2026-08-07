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

describe("intake: minted artifacts carry the destination's filter fields (Step 3)", () => {
  const FILE = { name: "a.png", type: "image/png", size: 10 };
  let prevGetFilterContext;

  beforeEach(() => {
    prevGetFilterContext = operationsBridge.getFilterContext;
  });
  afterEach(() => {
    operationsBridge.getFilterContext = prevGetFilterContext;
  });

  // The real shape `computePageFilterFields` reads: only a NAV condition on the
  // ACTIVE named filter is stamped. Mocking just `activeFilterValues` produced a
  // silent {} and looked like a code failure — the stamp is opt-in by design, so
  // the test has to opt in the same way the grid does.
  function withFilter(dateFieldId, value) {
    const parent = { id: "col-today", fields: { [dateFieldId]: { value } } };
    operationsBridge.getFilterContext = () => ({
      state: {
        grid: {
          activeFilterId: "f1",
          namedFilters: [{ id: "f1", conditions: [{ fieldId: dateFieldId, isNav: true }] }],
          activeFilterValues: { [dateFieldId]: value },
        },
      },
      occurrencesById: { [parent.id]: parent },
    });
    return parent;
  }

  it("stamps the parent's filter fields onto the new artifact occurrence", () => {
    const parent = withFilter("f-date", "2026-08-07");
    const dispatch = vi.fn();
    const [p] = createArtifactPlaceholders([FILE], {
      gridId: "g", userId: "u", dispatch,
      occExtra: () => ({ parentId: parent.id }),
      parentOccurrence: parent,
    });
    // Without this the row exists in the data and renders nowhere, which is
    // indistinguishable from a lost upload. `flow` is part of the stored field
    // shape (`{value, flow}`) — asserting the whole object, not just the value,
    // is what keeps this honest about what actually gets persisted.
    expect(p.occurrence.fields).toEqual({ "f-date": { value: "2026-08-07", flow: "in" } });
  });

  it("lets caller-supplied field values win over the filter stamp", () => {
    const parent = withFilter("f-date", "2026-08-07");
    const dispatch = vi.fn();
    const [p] = createArtifactPlaceholders([FILE], {
      gridId: "g", userId: "u", dispatch,
      occExtra: () => ({ parentId: parent.id, fields: { "f-date": { value: "2026-01-01" } } }),
      parentOccurrence: parent,
    });
    expect(p.occurrence.fields["f-date"]).toEqual({ value: "2026-01-01" });
  });

  it("is byte-identical to today when there is no parent occurrence", () => {
    operationsBridge.getFilterContext = () => null;
    const dispatch = vi.fn();
    const [p] = createArtifactPlaceholders([FILE], {
      gridId: "g", userId: "u", dispatch, occExtra: () => ({}),
    });
    expect(p.occurrence.fields).toEqual({});
  });

  it("never throws when the bridge is unwired — a create must not fail on it", () => {
    operationsBridge.getFilterContext = () => { throw new Error("unwired"); };
    const dispatch = vi.fn();
    expect(() => createArtifactPlaceholders([FILE], {
      gridId: "g", userId: "u", dispatch,
      occExtra: () => ({ parentId: "p" }),
      parentOccurrence: { id: "p" },
    })).not.toThrow();
  });
});
