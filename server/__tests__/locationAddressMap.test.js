// 0230 — the Location map, and the reason 0229 said it was impossible.
import { describe, it, expect } from "vitest";
import { AUTHORED } from "../migrations/0230-location-takes-the-geocoders-address.mjs";
import { resolveMap } from "../migrations/0229-author-the-field-maps.mjs";
import { placeFields } from "../utils/providers/places.js";

const byName = (list) => new Map(list.map((f) => [f.name, f]));

describe("0230", () => {
  it("maps Address onto the grid's address FIELD, by id", () => {
    const fields = byName([{ id: "mVCwUhSfxP-k", name: "Address", type: "address" }]);
    expect(resolveMap(AUTHORED[0], fields)).toMatchObject({ fieldMap: { Address: "mVCwUhSfxP-k" }, missing: [] });
  });

  it("reports a grid with no Address field rather than half-writing one", () => {
    const { fieldMap, missing } = resolveMap(AUTHORED[0], byName([]));
    expect(fieldMap).toEqual({});
    expect(missing).toEqual(["Address"]);
  });

  it("maps ONLY Address — the provider's other three keys have no field to land in", () => {
    // Measured against the live provider: places answers Address | Kind |
    // Latitude | Longitude, and poms grid carries a field for exactly one.
    // Mapping the rest would mean minting fields nothing renders.
    expect(Object.keys(AUTHORED[0].map)).toEqual(["Address"]);
  });

  it("the key it maps is one the provider actually emits", () => {
    // The discriminating check: a field map is authored against a KEY NAME, so
    // a renamed provider key is a map that silently writes nothing.
    const keys = Object.keys(placeFields({
      address: { road: "West Wisconsin Avenue", house_number: "9200", city: "Milwaukee",
                 state: "WI", postcode: "53226", country: "United States" },
      lat: "43.0413956", lon: "-88.0241", type: "hospital",
    }));
    for (const k of Object.keys(AUTHORED[0].map)) expect(keys).toContain(k);
  });
});
