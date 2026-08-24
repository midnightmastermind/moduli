// 0232 — confirmation, not resemblance.
import { describe, it, expect } from "vitest";
import { drugName, confirms, KEY_TO_FIELD } from "../migrations/0232-medication-generic-and-class.mjs";
import { drugFields } from "../utils/providers/openfda.js";

describe("drugName", () => {
  it("strips the AUTHORED dose, not a guessed one", () => {
    // `0158` put the dose on `meta.dose` precisely so nothing would parse a
    // label. "Aripiprazole 10mg" and "Aripiprazole 20mg" are different things
    // to take, which is why the dose is part of the name in the first place.
    expect(drugName("Aripiprazole 10mg", "10mg")).toBe("Aripiprazole");
    expect(drugName("Vyvanse 30mg", "30mg")).toBe("Vyvanse");
  });
  it("leaves a label alone when the dose is not its suffix", () => {
    expect(drugName("Aripiprazole", null)).toBe("Aripiprazole");
    expect(drugName("10mg Something", "10mg")).toBe("10mg Something");
  });
});

describe("confirms — the four real rows, measured live", () => {
  it("accepts an exact generic name", () => {
    expect(confirms("Aripiprazole", "Aripiprazole")).toBe(true);
    expect(confirms("Lamotrigine", "Lamotrigine")).toBe(true);
  });
  it("accepts a generic that EXTENDS the name with its salt", () => {
    expect(confirms("Trazodone", "Trazodone Hydrochloride")).toBe(true);
  });
  it("REFUSES a brand name against its own generic, though the answer is right", () => {
    // The discriminating case. openFDA is correct that Vyvanse is
    // lisdexamfetamine — and accepting it would mean accepting whatever the
    // search returned, which is how "Fish Oil" becomes "Benzalkonium Chloride".
    expect(confirms("Vyvanse", "Lisdexamfetamine Dimesylate")).toBe(false);
  });
  it("REFUSES the supplement answers that made this Medication-only", () => {
    expect(confirms("Creatine", "Colotox")).toBe(false);
    expect(confirms("Fish Oil", "Benzalkonium Chloride")).toBe(false);
    expect(confirms("Vitamin D", "Silicea")).toBe(false);
    // The near miss that a substring match would have let through: our name
    // appears INSIDE the answer, and the product is an acid reducer.
    expect(confirms("Magnesium", "Esomeprazole Magnesium")).toBe(false);
  });
  it("refuses empty on either side rather than treating it as a match", () => {
    expect(confirms("", "Aripiprazole")).toBe(false);
    expect(confirms("Aripiprazole", "")).toBe(false);
    expect(confirms("Aripiprazole", null)).toBe(false);
  });
});

describe("the map", () => {
  it("uses openFDA's OWN casing for every key it maps", () => {
    // "Generic name" — lowercase n. A key authored as "Generic Name" would
    // match nothing and fill nothing, silently.
    // `drugFields` takes the openfda block ITSELF, not a wrapper around it.
    const keys = Object.keys(drugFields({
      generic_name: ["Aripiprazole"], substance_name: ["Aripiprazole"],
      route: ["Oral"], pharm_class_epc: ["Atypical Antipsychotic [Epc]"],
      manufacturer_name: ["Preferred Pharmaceuticals Inc."],
    }));
    for (const k of Object.keys(KEY_TO_FIELD)) expect(keys).toContain(k);
  });
  it("maps only the two the user chose — Route and Manufacturer are left out", () => {
    expect(Object.keys(KEY_TO_FIELD)).toEqual(["Generic name", "Drug class"]);
  });
});
