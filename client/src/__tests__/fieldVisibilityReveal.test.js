// `fieldVisibility.reveal` — fields shown even where a module binds them HIDDEN, without turning the
// level into a whitelist (show-mode). Carried by the cascade resolver; honoured by resolveOccurrenceFields.
import { describe, it, expect } from "vitest";
import { getEffectiveFieldVisibilityForOccurrence } from "../state/selectors";
import { resolveOccurrenceFields } from "../helpers/autoAppliedFields";

const fieldsById = { fDate: { id: "fDate", name: "Date" }, fDone: { id: "fDone", name: "Completed" }, fTag: { id: "fTag", name: "Tags" } };
const module = { id: "m", role: "instance", fieldBindings: [
  { fieldId: "fDone" }, { fieldId: "fDate", hidden: true }, { fieldId: "fTag" },
] };
const names = (fv) => resolveOccurrenceFields({ module, fieldsById, fieldVisibility: fv }).map((x) => x.field.name);

describe("fieldVisibility.reveal", () => {
  it("a hidden binding stays hidden without it", () => {
    expect(names(null)).toEqual(["Completed", "Tags"]);
  });
  it("reveal shows the hidden binding and keeps every other field (not a whitelist)", () => {
    expect(names({ mode: "off", fieldIds: [], reveal: ["fDate"] })).toEqual(["Completed", "Date", "Tags"]);
  });
  it("combines with a hide list", () => {
    expect(names({ mode: "hide", fieldIds: ["fTag"], reveal: ["fDate"] })).toEqual(["Completed", "Date"]);
  });
  it("the resolver carries reveal from the nearest level, and off+reveal is not 'no constraint'", () => {
    const occ = {
      col: { id: "col", fieldVisibility: { mode: "off", reveal: ["fDate"] } },
      row: { id: "row", parentId: "col" },
      page: { id: "page", fieldVisibility: { mode: "hide", fieldIds: ["fTag"] }, occurrences: ["col"] },
    };
    occ.col.parentId = "page";
    expect(getEffectiveFieldVisibilityForOccurrence(occ.row, { occurrencesById: occ }))
      .toEqual({ mode: "off", fieldIds: [], reveal: ["fDate"] });
    expect(getEffectiveFieldVisibilityForOccurrence({ id: "x", parentId: "page" }, { occurrencesById: { ...occ, x: { id: "x", parentId: "page" } } }))
      .toEqual({ mode: "hide", fieldIds: ["fTag"] });
    expect(getEffectiveFieldVisibilityForOccurrence({ id: "y", fieldVisibility: { mode: "off" } }, { occurrencesById: {} })).toBeNull();
  });
});
