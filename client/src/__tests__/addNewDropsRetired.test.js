import { describe, it, expect } from "vitest";
import { prunedAddNew } from "../../../server/migrations/0386-addnew-drops-retired-fields.mjs";
describe("prunedAddNew (0386)", () => {
  const f = (ids) => ({ meta: { optionsSource: { addNew: { fieldIds: ids } } } });
  it("drops an id that names no field", () => { expect(prunedAddNew(f(["amt", "cad", "day"]), new Set(["amt", "day"]))).toEqual(["amt", "day"]); });
  it("unchanged list, or no addNew, is null (the control)", () => { expect(prunedAddNew(f(["amt"]), new Set(["amt"]))).toBeNull(); expect(prunedAddNew({ meta: {} }, new Set())).toBeNull(); });
});
