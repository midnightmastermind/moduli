import { describe, it, expect } from "vitest";
import { mapProviderFields, parseLeadingNumber, providerKeysFromSamples, searchProviderConfig }
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
    expect(searchProviderConfig(cfg({ enabled: true, provider: "wikipedia", fieldMap: { a: "b" } })))
      .toEqual({ provider: "wikipedia", fieldMap: { a: "b" } });
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
