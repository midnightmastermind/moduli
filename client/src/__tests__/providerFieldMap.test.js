import { describe, it, expect } from "vitest";
import { mapProviderFields, parseLeadingNumber, providerKeysFromSamples, searchProviderConfig,
         selectOptionValues, matchSelectOption }
  from "../helpers/providerFieldMap.js";

const F = { t: { id: "t", type: "text" }, n: { id: "n", type: "number" },
            d: { id: "d", type: "duration" }, b: { id: "b", type: "boolean" },
            o: { id: "o", type: "occurrence" } };

describe("mapProviderFields — provider keys become our field values", () => {
  it("writes only what the mapping names (the control: it writes something)", () => {
    const { values, wrote } = mapProviderFields(
      { "Directed by": "Christopher Nolan", "Starring": "Leonardo DiCaprio", "Budget": "$160 million" },
      { "Directed by": "t" }, F);
    expect(values).toEqual({ t: { value: "Christopher Nolan", flow: "in" } });
    expect(wrote).toHaveLength(1);
  });

  it("an unmapped key writes nothing — that IS the optional half", () => {
    const { values } = mapProviderFields({ "Starring": "x" }, {}, F);
    expect(values).toEqual({});
  });

  it("mapping a key to nothing is the OFF state, not an empty write", () => {
    const { values } = mapProviderFields({ "Starring": "x" }, { Starring: "" }, F);
    expect(values).toEqual({});
  });

  it("a number field REFUSES a string with no number, rather than storing NaN", () => {
    // `Number("unknown")` is NaN, and a NaN in a field every tracker sums is a
    // silent wrong total — the failure this refusal exists to prevent.
    const { values, skipped } = mapProviderFields({ Runtime: "unknown" }, { Runtime: "n" }, F);
    expect(values).toEqual({});
    expect(skipped[0].why).toContain("not a number");
  });

  it("a number field PARSES the leading number out of a provider's prose", () => {
    const { values } = mapProviderFields({ Runtime: "148 minutes" }, { Runtime: "d" }, F);
    expect(values).toEqual({ d: { value: 148, flow: "in" } });
  });

  it("refuses a field type a string cannot honestly fill", () => {
    const { values, skipped } = mapProviderFields({ X: "yes" }, { X: "b" }, F);
    expect(values).toEqual({});
    expect(skipped[0].why).toContain("boolean");
    // and an occurrence field too — a title is not a row reference
    expect(mapProviderFields({ X: "Nolan" }, { X: "o" }, F).values).toEqual({});
  });

  it("a key the provider did not return is reported, not silently dropped", () => {
    const { values, skipped } = mapProviderFields({}, { "Directed by": "t" }, F);
    expect(values).toEqual({});
    expect(skipped[0].why).toContain("provider returned nothing");
  });

  it("parseLeadingNumber handles the shapes providers actually return", () => {
    expect(parseLeadingNumber("148 minutes")).toBe(148);
    expect(parseLeadingNumber("$160,000,000")).toBe(160000000);
    expect(parseLeadingNumber("8.8/10")).toBe(8.8);
    expect(parseLeadingNumber("unknown")).toBeNull();
    expect(parseLeadingNumber(null)).toBeNull();
  });
});

describe("providerKeysFromSamples — what to offer in the mapping UI", () => {
  it("ranks by how often a key appears, so one-off keys sink", () => {
    const keys = providerKeysFromSamples([
      { fields: { "Directed by": "a", Oddity: "z" } },
      { fields: { "Directed by": "b", Starring: "c" } },
    ]);
    expect(keys[0]).toEqual({ key: "Directed by", seen: 2 });
    expect(keys.map(k => k.key)).toContain("Oddity");
  });

  it("an empty sample is an empty list, not a throw", () => {
    expect(providerKeysFromSamples(null)).toEqual([]);
  });
});

describe("searchProviderConfig — the authored toggle", () => {
  const cfg = (sp) => ({ meta: { optionsSource: { searchProvider: sp } } });

  it("reads an enabled provider", () => {
    // `valueAliases` joined the contract when wger's exercise categories turned
    // out to be its own vocabulary — six of eight match `Muscle Group`, and
    // Abs/Calves need an authored translation. It defaults to {} so a config
    // written before it existed reads identically.
    expect(searchProviderConfig(cfg({ enabled: true, provider: "wikipedia", fieldMap: { a: "b" } })))
      .toEqual({ provider: "wikipedia", fieldMap: { a: "b" }, valueAliases: {} });
  });

  it("OFF means off even with a provider and a mapping still stored", () => {
    // Switching the toggle off keeps the authored mapping so turning it back on
    // does not mean re-doing the work — so `enabled` must be what gates it.
    expect(searchProviderConfig(cfg({ enabled: false, provider: "wikipedia", fieldMap: { a: "b" } })))
      .toBeNull();
  });

  it("a field that never configured one is null, not a default provider", () => {
    expect(searchProviderConfig({ meta: {} })).toBeNull();
    expect(searchProviderConfig(null)).toBeNull();
  });
});

describe("a SELECT with a fixed list is not a text field", () => {
  // wger answers "Pectoralis major"; `Muscle Group`'s options are chest/back/legs.
  // Writing the string stores a value absent from the list, which renders BLANK
  // and gets written away as null on the next edit (CLAUDE.md 2026-08-23 (7)).
  const muscle = {
    id: "mg", name: "Muscle Group", type: "select",
    meta: { optionsSource: { values: [
      { value: "chest", label: "Chest" }, { value: "back", label: "Back" }, { value: "legs", label: "Legs" }] } },
  };
  const fieldsById = { mg: muscle };

  it("REFUSES a value the select does not offer, and says why", () => {
    const r = mapProviderFields({ Muscles: "Pectoralis major" }, { Muscles: "mg" }, fieldsById);
    expect(r.values).toEqual({});
    expect(r.wrote).toEqual([]);
    expect(r.skipped[0].why).toMatch(/not an option on Muscle Group/);
  });

  it("accepts an option matched on its LABEL and stores the VALUE", () => {
    // A source says "Chest"; the option is {value:"chest", label:"Chest"} —
    // the same answer in the field's own vocabulary.
    const r = mapProviderFields({ Muscles: "Chest" }, { Muscles: "mg" }, fieldsById);
    expect(r.values.mg).toEqual({ value: "chest", flow: "in" });
  });

  it("matches case-insensitively on the value too", () => {
    expect(mapProviderFields({ Muscles: "LEGS" }, { Muscles: "mg" }, fieldsById).values.mg)
      .toEqual({ value: "legs", flow: "in" });
  });

  it("lets anything through when the select declares NO fixed list", () => {
    // A free-form select is a text field wearing a different control; refusing
    // there would break every provider mapping into one.
    const free = { id: "s", name: "Tag", type: "select", meta: {} };
    expect(mapProviderFields({ K: "anything" }, { K: "s" }, { s: free }).values.s)
      .toEqual({ value: "anything", flow: "in" });
  });

  it("reads options from meta.options too, the other shape the grid uses", () => {
    const alt = { id: "s", name: "Library", type: "select", meta: { options: ["book", "movie"] } };
    expect(mapProviderFields({ K: "book" }, { K: "s" }, { s: alt }).values.s)
      .toEqual({ value: "book", flow: "in" });
    expect(mapProviderFields({ K: "album" }, { K: "s" }, { s: alt }).skipped).toHaveLength(1);
  });
});

describe("selectOptionValues", () => {
  it("returns null for a select with no fixed list, so callers can tell", () => {
    expect(selectOptionValues({ meta: {} })).toBeNull();
    expect(selectOptionValues({ meta: { options: [] } })).toBeNull();
  });
  it("flattens both option shapes to bare values", () => {
    expect(selectOptionValues({ meta: { optionsSource: { values: [{ value: "a", label: "A" }, "b"] } } }))
      .toEqual(["a", "b"]);
  });
});

describe("valueAliases — an authored translation of a provider's vocabulary", () => {
  // wger's exercise Category is its own vocabulary: Chest/Legs/Back/Arms/
  // Shoulders/Cardio land on `Muscle Group`'s options by name, Abs and Calves
  // do not. Measured against the live API, 6 of 8.
  const muscle = {
    id: "mg", name: "Muscle Group", type: "select",
    meta: { optionsSource: { values: [
      { value: "chest", label: "Chest" }, { value: "legs", label: "Legs" },
      { value: "core", label: "Core" }] } },
  };
  const by = { mg: muscle };
  const map = { Category: "mg" };
  const aliases = { Category: { Abs: "core", Calves: "legs" } };

  it("translates a value the select does not offer into one it does", () => {
    expect(mapProviderFields({ Category: "Abs" }, map, by, aliases).values.mg)
      .toEqual({ value: "core", flow: "in" });
  });

  it("leaves a value that already matches alone", () => {
    expect(mapProviderFields({ Category: "Chest" }, map, by, aliases).values.mg)
      .toEqual({ value: "chest", flow: "in" });
  });

  it("matches the alias key case-insensitively", () => {
    expect(mapProviderFields({ Category: "abs" }, map, by, aliases).values.mg)
      .toEqual({ value: "core", flow: "in" });
  });

  it("still REFUSES a value with no alias and no option — the guard is not bypassed", () => {
    // An alias table must not become a way to write arbitrary strings into a
    // fixed select; anything unaliased still meets the option check.
    const r = mapProviderFields({ Category: "Shoulders" }, map, by, aliases);
    expect(r.values).toEqual({});
    expect(r.skipped[0].why).toMatch(/not an option/);
  });

  it("is optional — no aliases behaves exactly as before", () => {
    expect(mapProviderFields({ Category: "Chest" }, map, by).values.mg)
      .toEqual({ value: "chest", flow: "in" });
  });
});
