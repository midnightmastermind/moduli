// client/src/__tests__/sharePresets.test.js
//
// A preset is a saved SHAPE, not a trigger (user 2026-09-28: "its just a saved
// preset of type of occurance, values, and binded fields. there is no rule
// from IMDB"). Nothing here may fire on its own.
import { describe, it, expect } from "vitest";
import { readPresets, withPreset, presetFromForm, formFromPreset } from "../helpers/sharePresets";

const FORM = {
  name: "Movie",
  destination: { id: "o-movies", label: "Movies", childCount: 993 },
  shape: { role: "artifact", kind: "movie", bindingsLike: "m-movie", bindFields: ["f-year", "f-cat"] },
  mappings: {
    "f-year": { source: "title", transform: "year", override: "2006" },
    "f-cat": { source: "literal", value: "movie", raw: ["movie"], auto: true },
  },
  labelMapping: { source: "title", transform: "stripSuffix", override: "A Guide" },
};

describe("readPresets", () => {
  it("returns [] for a grid with none, rather than undefined", () => {
    expect(readPresets({})).toEqual([]);
    expect(readPresets(null)).toEqual([]);
  });

  it("reads them off grid.meta", () => {
    expect(readPresets({ meta: { sharePresets: [{ id: "p1", name: "Movie" }] } })).toHaveLength(1);
  });
});

describe("presetFromForm", () => {
  it("keeps the shape and the destination", () => {
    const p = presetFromForm(FORM);
    expect(p).toMatchObject({
      name: "Movie", role: "artifact", kind: "movie",
      bindingsLike: "m-movie", destinationId: "o-movies", destinationLabel: "Movies", bindFields: ["f-year", "f-cat"],
    });
    expect(p.id).toBeTruthy();
  });

  it("DROPS an override — an edit is for one clip, never for every clip after it", () => {
    const p = presetFromForm(FORM);
    expect(p.mappings["f-year"]).toEqual({ source: "title", transform: "year" });
    expect(p.labelMapping).toEqual({ source: "title", transform: "stripSuffix" });
  });

  it("KEEPS a literal, typed value included, because a literal source is a deliberate constant", () => {
    expect(presetFromForm(FORM).mappings["f-cat"]).toEqual({ source: "literal", value: "movie", raw: ["movie"], auto: true });
  });

  it("does not mutate the form it was saved from", () => {
    presetFromForm(FORM);
    expect(FORM.mappings["f-year"].override).toBe("2006");
  });
});

describe("formFromPreset", () => {
  it("round-trips the shape and the destination", () => {
    const f = formFromPreset(presetFromForm(FORM));
    expect(f.shape).toMatchObject({ role: "artifact", kind: "movie", bindingsLike: "m-movie" });
    expect(f.destination).toMatchObject({ id: "o-movies", label: "Movies" });
  });

  it("returns mappings with no override, so values re-resolve for the new clip", () => {
    const f = formFromPreset({ ...presetFromForm(FORM), mappings: { "f-year": { source: "title", override: "leaked" } } });
    expect(f.mappings["f-year"].override).toBeUndefined();
  });

  it("editing the form after picking does not mutate the stored preset", () => {
    const stored = presetFromForm(FORM);
    const f = formFromPreset(stored);
    f.mappings["f-year"].override = "1999";
    expect(stored.mappings["f-year"].override).toBeUndefined();
  });

  it("has no destination when the preset saved none", () => {
    expect(formFromPreset({ id: "p", name: "X", mappings: {} }).destination).toBeNull();
  });
});

describe("withPreset", () => {
  it("appends a new one", () => {
    expect(withPreset([], { id: "p1", name: "Movie" })).toHaveLength(1);
  });

  it("REPLACES one of the same name, so saving twice does not make two Movies", () => {
    const out = withPreset([{ id: "p1", name: "Movie", kind: "old" }], { id: "p2", name: "Movie", kind: "movie" });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("movie");
  });

  it("matches a name case-insensitively and trimmed", () => {
    expect(withPreset([{ id: "p1", name: "Movie" }], { id: "p2", name: "  movie " })).toHaveLength(1);
  });
});
