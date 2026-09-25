import { describe, it, expect } from "vitest";
import { planFacebook } from "../migrations/0354-more-profile-links.mjs";

const fid = "fb";
const occ = (id, moduleId, ext, fields = {}) => ({ id, moduleId, fields, meta: { source: "social-import", externalId: ext } });

describe("0354 planFacebook", () => {
  it("fills the name and adds the binding on people who came from Facebook", () => {
    const modulesById = new Map([["m1", { id: "m1", label: "Leon Fernholdt", fieldBindings: [] }]]);
    const r = planFacebook({ occurrences: [occ("o1", "m1", "fb:Leon Fernholdt")], modulesById, fieldId: fid });
    expect(r.setValue).toEqual([{ id: "o1", value: "Leon Fernholdt" }]);
    expect(r.addBinding).toEqual(["m1"]);
  });
  it("skips Instagram-only people (control)", () => {
    const modulesById = new Map([["m1", { id: "m1", label: "marge026", fieldBindings: [] }]]);
    const r = planFacebook({ occurrences: [occ("o1", "m1", "ig:marge026")], modulesById, fieldId: fid });
    expect(r).toEqual({ setValue: [], addBinding: [], unhide: [] });
  });
  it("is idempotent: an existing value and binding are left alone", () => {
    const modulesById = new Map([["m1", { id: "m1", label: "Leon", fieldBindings: [{ fieldId: fid }] }]]);
    const r = planFacebook({ occurrences: [occ("o1", "m1", "fb:Leon", { [fid]: { value: "Leon" } })], modulesById, fieldId: fid });
    expect(r).toEqual({ setValue: [], addBinding: [], unhide: [] });
  });
  it("un-hides a hidden Facebook binding", () => {
    const modulesById = new Map([["m1", { id: "m1", label: "Leon", fieldBindings: [{ fieldId: fid, hidden: true }] }]]);
    expect(planFacebook({ occurrences: [occ("o1", "m1", "fb:Leon")], modulesById, fieldId: fid }).unhide).toEqual(["m1"]);
  });
});
