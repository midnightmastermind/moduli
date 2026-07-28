// __tests__/protectedGridsIntegration.test.js
//
// Does the SEED's destructive entry point actually refuse a protected grid?
// The unit tests cover the rule; this covers the wiring, which is where the
// real risk lives — dropExistingLiveGrid takes the name as a PARAMETER, so
// "we only ever pass the disposable one" was a convention until the assert.
//
// This runs entirely on a mocked Grid model. It NEVER touches a database:
// on 2026-07-28 running this same check against the live database is what
// deleted the live grid (it was still named "Poms", which the list did not
// cover yet). A guard test must not be able to destroy the thing it guards.
import { describe, it, expect, vi, beforeEach } from "vitest";

const deleteMany = vi.fn(async () => ({ deletedCount: 0 }));
const deleteOne = vi.fn(async () => ({ deletedCount: 1 }));
let storedGrid = null;

vi.mock("../models/Grid.js", () => ({
  default: {
    findOne: vi.fn(async () => storedGrid),
    find: vi.fn(() => ({ lean: async () => (storedGrid ? [storedGrid] : []) })),
    deleteOne,
    deleteMany,
    updateMany: vi.fn(async () => ({})),
  },
}));
for (const m of ["Occurrence", "Module", "Field", "Manifest", "View", "Folder", "Operation", "Transaction"]) {
  vi.doMock(`../models/${m}.js`, () => ({ default: { deleteMany, find: vi.fn(() => ({ lean: async () => [] })) } }));
}

const { dropExistingLiveGrid } = await import("../scripts/createLiveData.js");

beforeEach(() => { deleteMany.mockClear(); deleteOne.mockClear(); storedGrid = null; });

describe("dropExistingLiveGrid refuses protected grids", () => {
  it.each(["poms grid", "test grid 1", "POMS GRID", "  poms grid  "])(
    "refuses %j before it even queries", async (name) => {
      storedGrid = { _id: "g1", name: "poms grid", userId: "u1" };
      await expect(dropExistingLiveGrid("u1", name)).rejects.toThrow(/protected live data/);
      // The point of asserting FIRST: no collection delete was issued at all.
      expect(deleteMany).not.toHaveBeenCalled();
      expect(deleteOne).not.toHaveBeenCalled();
    });

  it("refuses a RENAMED grid that still carries the meta.protected stamp", async () => {
    // The 2026-07-28 hole in reverse: a safe-looking name must not be enough
    // if the document itself says it is live data.
    storedGrid = { _id: "g1", name: "totally safe name", userId: "u1", meta: { protected: true } };
    await expect(dropExistingLiveGrid("u1", "totally safe name")).rejects.toThrow(/protected live data/);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(deleteOne).not.toHaveBeenCalled();
  });

  it("still drops an ordinary grid — the guard must not break the seed", async () => {
    storedGrid = { _id: "g2", name: "test grid 2", userId: "u1" };
    await expect(dropExistingLiveGrid("u1", "test grid 2")).resolves.toBe(true);
    expect(deleteMany).toHaveBeenCalled();
    expect(deleteOne).toHaveBeenCalledWith({ _id: "g2" });
  });

  it("is a no-op when the grid does not exist", async () => {
    storedGrid = null;
    await expect(dropExistingLiveGrid("u1", "test grid 2")).resolves.toBe(false);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
