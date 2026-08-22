import { describe, it, expect } from "vitest";
import { isInertDuplicate, appWrittenFieldIds } from "../migrations/0184-retire-the-inert-macros-tile.mjs";

const TILE = "wok6dpg4nh";
const base = () => ({
  tile: { id: TILE, fields: {}, occurrences: [] },
  ops: [{ pipeline: { steps: [{ config: { path: "$goalItem.fields.trackerDateFF.value" } }] } }],
  occs: [{ id: "parent", occurrences: [TILE] }, { id: TILE, fields: {} }],
  mods: [],
});

describe("0184 — the refusals are the safety", () => {
  it("removes a tile nothing references, nothing lists twice, and nobody typed in", () => {
    const b = base();
    const r = isInertDuplicate(b.tile, b);
    expect(r.ok).toBe(true);
    expect(r.lister.id).toBe("parent");
  });

  it("REFUSES a tile holding a value in a field NO operation writes — that is the user's typing", () => {
    const b = base();
    b.tile.fields = { someUserField: { value: 42 } };
    const r = isInertDuplicate(b.tile, b);
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toMatch(/NO operation writes/);
  });

  it("ALLOWS a tile whose only value is one an operation wrote — the 0038 trap, from the other side", () => {
    // This is the case that made the first dry run refuse: Tracker Date, stamped by
    // `Trackers: Date-Prefix Labels`. The app's own footprint is not the user's writing.
    const b = base();
    b.tile.fields = { trackerDateFF: { value: "2026-08-22" } };
    expect(isInertDuplicate(b.tile, b).ok).toBe(true);
  });

  it("REFUSES a tile with children — a subtree is never collateral", () => {
    const b = base(); b.tile.occurrences = ["kid"];
    expect(isInertDuplicate(b.tile, b).reasons.join()).toMatch(/child/);
  });

  it("REFUSES when an operation names its id — the 0035 selector lesson", () => {
    const b = base();
    b.ops.push({ pipeline: { steps: [{ config: { expr: `$allItemsById.${TILE}` } }] } });
    expect(isInertDuplicate(b.tile, b).reasons.join()).toMatch(/operation names its id/);
  });

  it("REFUSES when another occurrence points at it through a FIELD VALUE — the third reachability path", () => {
    const b = base();
    b.occs.push({ id: "other", fields: { pick: { value: TILE } } });
    expect(isInertDuplicate(b.tile, b).reasons.join()).toMatch(/field value/);
  });

  it("REFUSES a multi-parented tile — shared is not spare", () => {
    const b = base();
    b.occs.push({ id: "parent2", occurrences: [TILE] });
    expect(isInertDuplicate(b.tile, b).reasons.join()).toMatch(/listed by 2 parents/);
  });

  it("appWrittenFieldIds reads every field id any pipeline writes", () => {
    const ids = appWrittenFieldIds([{ pipeline: { steps: [{ config: { path: "$t.fields.abc123.value" } }] } }]);
    expect(ids.has("abc123")).toBe(true);
    expect(ids.has("nope99")).toBe(false);
  });
});
