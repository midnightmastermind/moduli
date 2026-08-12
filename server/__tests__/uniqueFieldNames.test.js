import { describe, it, expect } from "vitest";
import { planRenames, RENAMES } from "../migrations/0077-unique-field-names.mjs";

const inp = (name, over = {}) => ({ id: `in-${name}`, name, inputEnabled: true, displayEnabled: false, ...over });
const dsp = (name, over = {}) => ({ id: `dp-${name}`, name, inputEnabled: false, displayEnabled: true, ...over });

describe("0077 planRenames", () => {
  it("renames the DISPLAY twin and never the input field", () => {
    // The input field is what people type into and what [Field] tokens name —
    // renaming it would rewrite the user's own vocabulary.
    const plan = planRenames([inp("Protein"), dsp("Protein")]);
    expect(plan).toHaveLength(1);
    expect(plan[0].field.id).toBe("dp-Protein");
    expect(plan[0].to).toBe("Total Protein");
  });

  it("does NOTHING when the name is already unique — the re-run guard", () => {
    expect(planRenames([dsp("Protein")])).toEqual([]);
    expect(planRenames([inp("Protein"), dsp("Total Protein")])).toEqual([]);
  });

  it("REFUSES a pair with no single display-only twin", () => {
    // Two display twins, or two inputs: which one the user types into is a
    // guess, and guessing here renames real vocabulary.
    expect(planRenames([dsp("Carbs"), dsp("Carbs", { id: "dp2" })])).toEqual([]);
    expect(planRenames([inp("Carbs"), inp("Carbs", { id: "in2" })])).toEqual([]);
  });

  it("refuses when the target name is already taken", () => {
    // Renaming into an existing name would trade one collision for another.
    const plan = planRenames([inp("Fats"), dsp("Fats"), inp("Total Fats", { id: "other" })]);
    expect(plan).toEqual([]);
  });

  it("ignores duplicate names it has no rule for", () => {
    const plan = planRenames([inp("Mood"), dsp("Mood")]);
    expect(plan).toEqual([]);
  });

  it("handles the real five together, picking five display twins", () => {
    const fields = Object.keys(RENAMES).flatMap(k => {
      const name = k[0].toUpperCase() + k.slice(1);
      return [inp(name), dsp(name)];
    });
    const plan = planRenames(fields);
    expect(plan).toHaveLength(5);
    expect(plan.every(p => p.field.displayEnabled === true)).toBe(true);
    expect(new Set(plan.map(p => p.to)).size).toBe(5);   // no two land on one name
  });

  it("matches case-insensitively, since a name is user text", () => {
    const plan = planRenames([inp("CARBS"), dsp("carbs")]);
    expect(plan[0].to).toBe("Total Carbs");
  });
});
