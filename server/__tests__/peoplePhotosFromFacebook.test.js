import { describe, it, expect } from "vitest";
import { planPhotos, commonBindingField } from "../migrations/0355-people-photos-from-facebook.mjs";

const mod = (id, label, extra = []) => [id, { id, label, fieldBindings: [{ fieldId: "name", role: "input" }, ...extra] }];
const occ = (id, moduleId, ext, fields = {}) => ({ id, moduleId, fields, meta: { source: "social-import", externalId: ext } });

describe("0355 planPhotos", () => {
  const modulesById = new Map([mod("m1", "Leon"), mod("m2", "InÃªs InÃªs", [{ fieldId: "pic", role: "media" }]), mod("m3", "Ava")]);
  const occurrences = [occ("o1", "m1", "fb:Leon"), occ("o2", "m2", "fb:InÃªs InÃªs"), occ("o3", "m3", "fb:Ava", { pic: { value: "art1" } })];

  it("matches by externalId, not label, and skips people who already have a picture", () => {
    const r = planPhotos({ occurrences, modulesById, mediaFieldId: "pic", photos: [
      { externalId: "fb:Leon", name: "Leon", url: "u1" },
      { externalId: "fb:Ava", name: "Ava", url: "u3" },
      { externalId: "fb:Nobody", name: "Nobody", url: "u4" },
    ] });
    expect(r.fetches.map(f => f.occId)).toEqual(["o1"]);
    expect(r.alreadyHas).toBe(1);
    expect(r.notFound).toBe(1);
  });

  it("repairs a mojibake name only while the label is still the broken form", () => {
    const p = [{ externalId: "fb:InÃªs InÃªs", name: "Inês Inês", wasName: "InÃªs InÃªs", url: "u2" }];
    expect(planPhotos({ occurrences, modulesById, mediaFieldId: "pic", photos: p }).renames)
      .toEqual([{ occId: "o2", modId: "m2", from: "InÃªs InÃªs", to: "Inês Inês" }]);
    const renamed = new Map([...modulesById, mod("m2", "Inês (edited)")]);
    expect(planPhotos({ occurrences, modulesById: renamed, mediaFieldId: "pic", photos: p }).renames).toEqual([]);
  });

  it("commonBindingField picks the board's usual media field", () => {
    const mods = [{ fieldBindings: [{ fieldId: "a", role: "media" }] }, { fieldBindings: [{ fieldId: "b", role: "media" }] }, { fieldBindings: [{ fieldId: "b", role: "media" }] }, {}];
    expect(commonBindingField(mods, "media")).toBe("b");
    expect(commonBindingField([{}], "media")).toBeNull();
  });
});
