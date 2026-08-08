// Parsing a geocoder hit into { label, address, lat, lon }.
//
// The split is the whole decision: the LABEL is what a dropdown shows and the
// ADDRESS is what you navigate to. Get it wrong and every Location row reads
// "Dewey Center, 2010 West Wisconsin Avenue, Milwaukee, Milwaukee County,
// Wisconsin, 53233, United States".
//
// Fixtures are real response shapes from each provider, not invented ones —
// the two providers disagree about structure, and that disagreement is
// precisely what this module exists to absorb.
import { describe, it, expect } from "vitest";
import {
  splitDisplayName, isValidLatLon, looksLikeStreetAddress, mergeRanked,
} from "../utils/geocode.js";

describe("choosing which provider leads", () => {
  // These expectations come from a LIVE probe of both providers, recorded in
  // geocode.js. Photon returned 8 hits for the street address and not one was
  // the right building; Nominatim returned exactly one and it was correct.
  it("treats a leading house number as a street address", () => {
    expect(looksLikeStreetAddress("2010 W Wisconsin Ave Milwaukee")).toBe(true);
    expect(looksLikeStreetAddress("9200 West Wisconsin Avenue")).toBe(true);
    expect(looksLikeStreetAddress("221B Baker Street")).toBe(true);
  });

  it("treats a venue name as NOT a street address", () => {
    expect(looksLikeStreetAddress("Froedtert")).toBe(false);
    expect(looksLikeStreetAddress("Dewey Center Milwaukee")).toBe(false);
    expect(looksLikeStreetAddress("")).toBe(false);
    // A bare number is not an address — there is no street to go with it.
    expect(looksLikeStreetAddress("2010")).toBe(false);
  });
});

describe("merging two providers' results", () => {
  const hit = (label, osmId) => ({ label, osmId, lat: 43, lon: -87, address: "" });

  it("interleaves so neither provider buries the other", () => {
    // Concatenating would hide a good second-provider hit under eight
    // mediocre first-provider ones — the actual failure mode measured.
    const merged = mergeRanked(
      [hit("P1", "n/1"), hit("P2", "n/2")],
      [hit("N1", "n/3"), hit("N2", "n/4")],
    );
    expect(merged.map((h) => h.label)).toEqual(["P1", "N1", "P2", "N2"]);
  });

  it("keeps the primary provider's best hit first", () => {
    const merged = mergeRanked([hit("first", "n/1")], [hit("second", "n/2")]);
    expect(merged[0].label).toBe("first");
  });

  it("collapses the same OSM object returned by both providers", () => {
    // Both geocoders read the same database, so overlap is the norm, and a
    // duplicated row in a picker looks like two different places.
    const merged = mergeRanked([hit("Froedtert", "way/123")], [hit("Froedtert Hospital", "way/123")]);
    expect(merged).toHaveLength(1);
  });

  it("survives one provider returning nothing", () => {
    expect(mergeRanked([], [hit("only", "n/1")]).map((h) => h.label)).toEqual(["only"]);
    expect(mergeRanked([hit("only", "n/1")], []).map((h) => h.label)).toEqual(["only"]);
    expect(mergeRanked([], [])).toEqual([]);
  });

  it("caps the merged list", () => {
    const many = Array.from({ length: 20 }, (_, i) => hit(`p${i}`, `n/${i}`));
    expect(mergeRanked(many, [], 10)).toHaveLength(10);
  });
});

describe("splitting a display name", () => {
  it("drops the venue name from the head of the address", () => {
    const { label, address } = splitDisplayName(
      "Dewey Center, 2010 West Wisconsin Avenue, Milwaukee, Milwaukee County, Wisconsin, 53233, United States",
      "Dewey Center",
    );
    expect(label).toBe("Dewey Center");
    expect(address).toBe("2010 West Wisconsin Avenue, Milwaukee, Milwaukee County, Wisconsin, 53233, United States");
    // The point of the split: the name must not survive inside the address.
    expect(address).not.toContain("Dewey Center");
  });

  it("folds case when matching the head — Nominatim is inconsistent about it", () => {
    // Without folding, the name stays duplicated at the head of the address.
    const { label, address } = splitDisplayName(
      "FROEDTERT HOSPITAL, 9200 West Wisconsin Avenue, Milwaukee, Wisconsin, United States",
      "Froedtert Hospital",
    );
    expect(label).toBe("Froedtert Hospital");
    expect(address.toLowerCase()).not.toContain("froedtert");
  });

  it("keeps the address whole when the name is NOT at the head", () => {
    // Removing some other segment would be a guess, and a wrong guess here
    // silently deletes part of a real address.
    const { label, address } = splitDisplayName(
      "2010, West Wisconsin Avenue, Milwaukee, Wisconsin",
      "Dewey Center",
    );
    expect(label).toBe("Dewey Center");
    expect(address).toBe("2010, West Wisconsin Avenue, Milwaukee, Wisconsin");
  });

  it("labels an unnamed hit with its number AND street, never the number alone", () => {
    // "2010" is a useless thing to see in a dropdown.
    const { label } = splitDisplayName(
      "2010, West Wisconsin Avenue, Milwaukee, Wisconsin, 53233, United States",
      null,
    );
    expect(label).toBe("2010 West Wisconsin Avenue");
  });

  it("falls back to the first segment for an unnamed, unnumbered hit", () => {
    const { label } = splitDisplayName("Milwaukee, Wisconsin, United States", null);
    expect(label).toBe("Milwaukee");
  });

  it("survives an empty display name without inventing anything", () => {
    expect(splitDisplayName("", "Somewhere")).toEqual({ label: "Somewhere", address: "" });
    expect(splitDisplayName(null, null)).toEqual({ label: "", address: "" });
  });
});

describe("coordinate validation", () => {
  it("accepts a real coordinate given as strings — every geocoder sends strings", () => {
    expect(isValidLatLon("43.0389", "-87.9065")).toBe(true);
  });

  it("rejects out-of-range values rather than clamping them", () => {
    // A clamped coordinate silently pins the wrong place, which is worse than
    // refusing: the user sees a saved address sitting in the ocean.
    expect(isValidLatLon(91, 0)).toBe(false);
    expect(isValidLatLon(0, 181)).toBe(false);
    expect(isValidLatLon(-90.1, 0)).toBe(false);
  });

  it("rejects missing and non-numeric input", () => {
    expect(isValidLatLon(undefined, undefined)).toBe(false);
    expect(isValidLatLon("", "")).toBe(false);
    expect(isValidLatLon("north", "west")).toBe(false);
    expect(isValidLatLon(NaN, 0)).toBe(false);
  });

  it("accepts the exact boundaries", () => {
    expect(isValidLatLon(90, 180)).toBe(true);
    expect(isValidLatLon(-90, -180)).toBe(true);
    expect(isValidLatLon(0, 0)).toBe(true);
  });
});
