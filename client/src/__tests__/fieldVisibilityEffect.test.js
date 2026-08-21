// AN OPERATION CAN NOW SHOW AND HIDE A TILE'S FIELDS.
//
// `fieldVisibility` has been READ by the cascade
// (getEffectiveFieldVisibilityForOccurrence) since 2026-05, and written only by
// a client helper — so no pipeline could set it. The Workouts tile needs exactly
// that: one field per movement, and only that day's session visible.
//
// The path mirrors `$page.filterOverride.<fieldId>` (2026-07-26): one occurrence
// key an op may set, applied through the same commit helper the UI uses.
import { describe, it, expect } from "vitest";
import { applyUpdate } from "../helpers/applyUpdate";
import { applyEffectsToLiveOccs } from "../helpers/operationExecutor";

const TILE = "tile1";
const live = (fv) => ({ [TILE]: { id: TILE, moduleId: "m1", role: "instance", occurrences: [], fieldVisibility: fv } });
const vis = (...ids) => ({ mode: "show", fieldIds: ids });

describe("$tile.fieldVisibility is a writable UPDATE path", () => {
  it("emits the effect, carrying the whole object", () => {
    // POSITIONAL — (path, value, ctx), and ctx carries `vars`, not `$vars`.
    // Calling it object-style throws "default is not a function", which reads
    // exactly like a broken branch; it is the probe, as it was for
    // executeActionItem and runMatchingOperations before it.
    const out = applyUpdate("$tile.fieldVisibility", vis("f1", "f2"),
      { vars: { $tile: { id: TILE } }, occurrencesById: live(null) });
    expect(out.effects).toEqual([
      { _effect: "UPDATE_ITEM_FIELD_VISIBILITY", itemId: TILE, value: { mode: "show", fieldIds: ["f1", "f2"] } },
    ]);
  });

  it("THE ONE THAT MATTERS: a later step in the same sweep reads the NEW visibility", () => {
    // The defect this mirrors cost a day's schedule one effect over — a write
    // that never reached the in-batch overlay, so the next op read stale state.
    const world = live(vis("old"));
    applyEffectsToLiveOccs(world, [
      { _effect: "UPDATE_ITEM_FIELD_VISIBILITY", itemId: TILE, value: vis("f1", "f2") },
    ]);
    expect(world[TILE].fieldVisibility).toEqual({ mode: "show", fieldIds: ["f1", "f2"] });
  });

  it("CONTROL — an effect for an unknown occurrence changes nothing and does not throw", () => {
    const world = live(vis("f1"));
    expect(() => applyEffectsToLiveOccs(world, [
      { _effect: "UPDATE_ITEM_FIELD_VISIBILITY", itemId: "nope", value: vis("x") },
    ])).not.toThrow();
    expect(world[TILE].fieldVisibility).toEqual({ mode: "show", fieldIds: ["f1"] });
  });

  it("a null value clears it, falling the tile back to showing everything", () => {
    const world = live(vis("f1"));
    applyEffectsToLiveOccs(world, [{ _effect: "UPDATE_ITEM_FIELD_VISIBILITY", itemId: TILE, value: null }]);
    expect(world[TILE].fieldVisibility).toBeNull();
  });

  it("does NOT swallow the neighbouring paths it was modelled on", () => {
    // `fieldVisibility` sits beside `filterOverride` and `textmap` in the same
    // segment switch; a mis-scoped branch would capture one of them.
    const fo = applyUpdate("$tile.filterOverride.dateF", "2026-08-21",
      { vars: { $tile: { id: TILE } }, occurrencesById: live(null) });
    expect(fo.effects[0]._effect).toBe("UPDATE_ITEM_FILTER_OVERRIDE");
  });
});
