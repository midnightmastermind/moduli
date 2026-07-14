// helpers/labelTokens — "[Field Name]" in a label renders the occurrence's
// live field value (2026-07-14 directive). Raw label stays stored/editable.
import { describe, it, expect } from "vitest";
import { resolveLabelTokens, hasLabelTokens } from "../helpers/labelTokens";

const fieldsById = {
  f1: { id: "f1", name: "Water" },
  f2: { id: "f2", name: "Completed" },
  f3: { id: "f3", name: "Tags" },
  // duplicate NAME pair — input vs display, like the seed's Protein/Calories
  fIn: { id: "fIn", name: "Protein" },
  fOut: { id: "fOut", name: "Protein" },
};
const occ = (fields) => ({ id: "o1", fields });

describe("resolveLabelTokens", () => {
  it("plain labels pass through untouched (fast path)", () => {
    expect(resolveLabelTokens("Drink Water", occ({}), fieldsById)).toBe("Drink Water");
    expect(hasLabelTokens("Drink Water")).toBe(false);
  });

  it("interpolates a {value, flow} wrapper by field name, case-insensitive", () => {
    const o = occ({ f1: { value: 16, flow: "in" } });
    expect(resolveLabelTokens("Drink [water] oz", o, fieldsById)).toBe("Drink 16 oz");
  });

  it("booleans render yes/no; arrays join; empty renders a dash", () => {
    const o = occ({ f2: { value: true }, f3: { value: ["health", "work"] }, f1: { value: null } });
    expect(resolveLabelTokens("[Completed]", o, fieldsById)).toBe("yes");
    expect(resolveLabelTokens("[Tags]", o, fieldsById)).toBe("health, work");
    expect(resolveLabelTokens("[Water]", o, fieldsById)).toBe("—");
  });

  it("a field the occurrence CARRIES wins over a mere duplicate-name match", () => {
    const o = occ({ fOut: { value: 42 } }); // only the display twin has a value
    expect(resolveLabelTokens("[Protein]g", o, fieldsById)).toBe("42g");
  });

  it("unknown bracketed text stays literal (no eating [sic])", () => {
    expect(resolveLabelTokens("Quote [sic] here", occ({}), fieldsById)).toBe("Quote [sic] here");
  });

  it("multiple tokens in one label all resolve", () => {
    const o = occ({ f1: { value: 8 }, f2: { value: false } });
    expect(resolveLabelTokens("[Water]oz · done: [Completed]", o, fieldsById))
      .toBe("8oz · done: no");
  });

  it("null occurrence / fieldsById degrade to the raw label", () => {
    expect(resolveLabelTokens("[Water]", null, fieldsById)).toBe("[Water]");
    expect(resolveLabelTokens("[Water]", occ({}), null)).toBe("[Water]");
  });
});
