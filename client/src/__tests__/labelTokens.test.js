// helpers/labelTokens — "[Field Name]" / "{Field Name}" in a label render the
// occurrence's live field value (2026-07-14 directive; extended same day with
// the name-showing curly form + colon write-back). Raw label stays stored.
import { describe, it, expect } from "vitest";
import {
  resolveLabelTokens, hasLabelTokens,
  materializeLabelTokens, commitLabelTokens,
} from "../helpers/labelTokens";

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

// The {Name} form + colon write-back (user: "Drink {Water:16oz} and i can
// just type in there, 14oz and the field value syncs up with it").
const fieldsWithUnit = {
  ...fieldsById,
  f1: { id: "f1", name: "Water", type: "number", meta: { postfix: "oz" } },
  f2: { id: "f2", name: "Completed", type: "boolean" },
};

describe("{Field} name-showing form", () => {
  it("renders name + value + unit", () => {
    const o = occ({ f1: { value: 16, flow: "in" } });
    expect(resolveLabelTokens("Drink {Water}", o, fieldsWithUnit)).toBe("Drink Water 16oz");
  });
  it("a stale embedded value in the STORED label is ignored — current value wins", () => {
    const o = occ({ f1: { value: 16 } });
    expect(resolveLabelTokens("Drink {Water:99oz}", o, fieldsWithUnit)).toBe("Drink Water 16oz");
  });
  it("unknown curly tokens stay literal (template tokens like {ProjectName})", () => {
    expect(resolveLabelTokens("Project: {ProjectName}", occ({}), fieldsWithUnit))
      .toBe("Project: {ProjectName}");
  });
});

describe("materializeLabelTokens (edit view)", () => {
  it("curly tokens gain :value+unit; square tokens gain the bare :value", () => {
    const o = occ({ f1: { value: 16 } });
    expect(materializeLabelTokens("Drink {Water}", o, fieldsWithUnit)).toBe("Drink {Water:16oz}");
    expect(materializeLabelTokens("Drink [Water] oz", o, fieldsWithUnit)).toBe("Drink [Water:16] oz");
  });
  it("empty field materializes an empty value slot", () => {
    expect(materializeLabelTokens("{Water}", occ({}), fieldsWithUnit)).toBe("{Water:}");
  });
});

describe("commitLabelTokens (write-back)", () => {
  it("typing a new value writes the field and strips the value from the label", () => {
    const o = occ({ f1: { value: 16 } });
    const { label, writes } = commitLabelTokens("Drink {Water:14oz}", o, fieldsWithUnit);
    expect(label).toBe("Drink {Water}");
    expect(writes).toEqual([{ fieldId: "f1", value: 14 }]);
  });
  it("an UNCHANGED materialized value produces no write", () => {
    const o = occ({ f1: { value: 16 } });
    const { label, writes } = commitLabelTokens("Drink {Water:16oz}", o, fieldsWithUnit);
    expect(label).toBe("Drink {Water}");
    expect(writes).toEqual([]);
  });
  it("booleans parse yes/no; clearing the slot writes null", () => {
    const o = occ({ f2: { value: false }, f1: { value: 16 } });
    expect(commitLabelTokens("[Completed:yes]", o, fieldsWithUnit).writes)
      .toEqual([{ fieldId: "f2", value: true }]);
    expect(commitLabelTokens("{Water:}", o, fieldsWithUnit).writes)
      .toEqual([{ fieldId: "f1", value: null }]);
  });
  it("labels without tokens pass through with zero writes", () => {
    const { label, writes } = commitLabelTokens("Plain rename", occ({}), fieldsWithUnit);
    expect(label).toBe("Plain rename");
    expect(writes).toEqual([]);
  });
});
