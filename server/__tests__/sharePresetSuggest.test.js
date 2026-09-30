// server/__tests__/sharePresetSuggest.test.js
//
// The presets a grid IMPLIES — "movies, appointments, bookmarks, etc. based on
// where they go" (user, 2026-09-29).
//
// The load-bearing property is that NOTHING here knows the word "movie": a
// suggestion is a destination's own shape plus a mapping chosen from each
// field's name and type. So the tests use a made-up board as well as the real
// ones, and assert the same rules apply.
import { describe, it, expect } from "vitest";
import { suggestPresets, mappingForField } from "../services/sharePresetSuggest.js";

const F = {
  title: { id: "f-title", name: "Title", type: "text" },
  year: { id: "f-year", name: "Year", type: "number" },
  url: { id: "f-url", name: "URL", type: "text" },
  notes: { id: "f-notes", name: "Notes", type: "text" },
  added: { id: "f-added", name: "Date Added", type: "date" },
  cat: { id: "f-cat", name: "Board Category", type: "select" },
  site: { id: "f-site", name: "Site", type: "text" },
  drive: { id: "f-drive", name: "Drive", type: "text" },
};
const FIELDS = Object.values(F);

const dest = (over = {}) => ({
  id: "d-movies", label: "Movies", crumb: "Boards › Media", childCount: 994,
  shape: {
    moduleId: "m-movie", role: "artifact", kind: "movie",
    bindFields: [F.title.id, F.year.id, F.cat.id, F.drive.id],
    autoFields: { [F.cat.id]: ["movie"] },
  },
  ...over,
});

describe("suggestPresets", () => {
  it("makes one preset per typed, populated board, named after it", () => {
    const out = suggestPresets([dest()], FIELDS);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      name: "Movies", suggested: true,
      role: "artifact", kind: "movie", bindingsLike: "m-movie",
      destinationId: "d-movies", destinationLabel: "Movies",
    });
  });

  it("carries the destination's own shape and the values its rows agree on", () => {
    const [p] = suggestPresets([dest()], FIELDS);
    expect(p.bindFields).toEqual([F.title.id, F.year.id, F.cat.id, F.drive.id]);
    // Same `auto` flag the window sets when you pick the destination by hand.
    expect(p.mappings[F.cat.id]).toEqual({ source: "literal", value: "movie", raw: ["movie"], auto: true });
  });

  it("maps each bound field from its NAME and TYPE, not from the board", () => {
    const [p] = suggestPresets([dest()], FIELDS);
    expect(p.mappings[F.title.id]).toEqual({ source: "title", transform: "stripSuffix" });
    expect(p.mappings[F.year.id]).toEqual({ source: "title", transform: "year" });
    // "Drive" matches no rule — left unmapped rather than guessed at.
    expect(p.mappings[F.drive.id]).toBeUndefined();
  });

  it("never overwrites an auto value with a name guess", () => {
    // Board Category is BOTH a select the rows agree on and a field no rule
    // claims — but if a rule ever did, the constant every row carries wins.
    const d = dest({ shape: { ...dest().shape, bindFields: [F.title.id], autoFields: { [F.title.id]: "fixed" } } });
    const [p] = suggestPresets([d], FIELDS);
    expect(p.mappings[F.title.id]).toMatchObject({ source: "literal", value: "fixed", auto: true });
  });

  it("labels every row from the clip's title, with the site suffix stripped", () => {
    const [p] = suggestPresets([dest()], FIELDS);
    expect(p.labelMapping).toEqual({ source: "title", transform: "stripSuffix" });
  });

  it("a bookmark board's row IS its address", () => {
    const marks = dest({
      id: "d-marks", label: "Bookmarks", childCount: 1464,
      shape: { moduleId: "m-b", role: "artifact", kind: "bookmark", bindFields: [F.url.id, F.notes.id], autoFields: {} },
    });
    const [p] = suggestPresets([marks], FIELDS);
    expect(p.fileFrom).toBe("url");
    expect(p.mappings[F.url.id]).toEqual({ source: "linkUrl" });
    expect(p.mappings[F.notes.id]).toEqual({ source: "selection" });
  });

  // The rule is grid-agnostic, so a board nobody wrote a rule for behaves the
  // same way. This is the test that fails if someone hardcodes a name list.
  it("works for a board this file has never heard of", () => {
    const recipes = dest({
      id: "d-recipes", label: "Recipes", childCount: 12,
      shape: {
        moduleId: "m-r", role: "instance", kind: "recipe",
        bindFields: [F.title.id, F.site.id, F.added.id], autoFields: {},
      },
    });
    const [p] = suggestPresets([recipes], FIELDS);
    expect(p.name).toBe("Recipes");
    expect(p.kind).toBe("recipe");
    expect(p.mappings[F.site.id]).toEqual({ source: "siteName" });
    expect(p.mappings[F.added.id]).toEqual({ source: "today" });
  });

  // INVERTED 2026-09-29, with its old reasoning kept: this asserted that a
  // kindless board is skipped, on the reading that a suggestion should be "a
  // real, TYPED kind". Measured on poms, that rejected People (1,181 rows, 27
  // bound fields) and Appointments — the two the user named alongside movies —
  // so the rule is now a kind OR bound fields. `untyped` binds four fields and
  // is therefore suggested; the shapeless and barely-used cases are unchanged
  // and are what this still pins.
  it("skips a shapeless destination and a barely-used one", () => {
    const untyped = dest({ id: "d-1", shape: { ...dest().shape, kind: null } });
    const empty = dest({ id: "d-2", shape: null });
    const scratch = dest({ id: "d-3", childCount: 2 });
    const out = suggestPresets([untyped, empty, scratch], FIELDS);
    expect(out.map((p) => p.destinationId)).toEqual(["d-1"]);
  });

  it("offers the biggest boards first, and caps the list", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      dest({ id: `d-${i}`, label: `Board ${i}`, childCount: i + 3 }));
    const out = suggestPresets(many, FIELDS);
    expect(out).toHaveLength(12);
    expect(out[0].name).toBe("Board 29");
    expect(out.at(-1).name).toBe("Board 18");
    expect(suggestPresets(many, FIELDS, { max: 2 })).toHaveLength(2);
  });

  it("answers empty for nothing rather than throwing", () => {
    expect(suggestPresets()).toEqual([]);
    expect(suggestPresets([], [])).toEqual([]);
    expect(suggestPresets([dest()], [])).toHaveLength(1); // no fields → shape only
  });
});

describe("mappingForField", () => {
  it("takes the FIRST matching rule, so Year and Date beat Title", () => {
    // "Year" contains no title word, but "Release Date" contains both "date"
    // and nothing else — ordering is what stops a date landing in the label.
    expect(mappingForField({ name: "Year", type: "number" })).toEqual({ source: "title", transform: "year" });
    expect(mappingForField({ name: "Release Date", type: "date" })).toEqual({ source: "today" });
    expect(mappingForField({ name: "Title", type: "text" })).toEqual({ source: "title", transform: "stripSuffix" });
  });

  it("a year rule needs the NUMBER type — a text 'Year Notes' is not a year", () => {
    expect(mappingForField({ name: "Year Notes", type: "text" })).toEqual({ source: "selection" });
  });

  it("matches whole words, so 'Linked People' is not a URL", () => {
    expect(mappingForField({ name: "Linked People", type: "text" })).toBeNull();
    expect(mappingForField({ name: "Website", type: "text" })).toEqual({ source: "linkUrl" });
  });

  it("returns null for a field no rule claims", () => {
    expect(mappingForField({ name: "Drive", type: "text" })).toBeNull();
    expect(mappingForField(null)).toBeNull();
  });
});

// ── A PRESET MAKES A ROW, SO ITS DESTINATION MUST HOLD ROWS ──────────────────
//
// Found on prod: the first pass suggested Songs / Albums / Artists / Bookmarks /
// Movies / Books / Authors / TV Series — and then FOUR Schedule day columns
// ("Schedule - Tuesday, September 8th, 2026"), which rank high because a day
// column holds 49 children. Its children are time SLOTS, so each one displaced
// a real board at the 12-suggestion cap.
describe("a layout is not a board", () => {
  const dayColumn = (over = {}) => ({
    id: "d-day", label: "Schedule - Tuesday, September 8th, 2026", crumb: "Schedule",
    childCount: 49,
    shape: { moduleId: "m-slot", role: "container", kind: "board", bindFields: [], autoFields: {} },
    ...over,
  });

  it("skips a destination whose rows are CONTAINERS", () => {
    const out = suggestPresets([dayColumn()], FIELDS);
    expect(out).toEqual([]);
  });

  it("so a smaller real board is no longer crowded out by it", () => {
    // The day column is bigger, so without the rule it takes the only slot.
    const out = suggestPresets([dayColumn(), dest({ childCount: 12 })], FIELDS, { max: 1 });
    expect(out.map((p) => p.name)).toEqual(["Movies"]);
  });

  it("skips a destination whose rows are PAGES", () => {
    expect(suggestPresets([dayColumn({
      shape: { moduleId: "m-pg", role: "page", kind: "board", bindFields: [], autoFields: {} },
    })], FIELDS)).toEqual([]);
  });

  // A textblock IS a row — a clipped selection becomes one — so the rule must
  // not narrow to "artifact and instance" and quietly drop that case.
  it("keeps a board whose rows are textblocks", () => {
    const out = suggestPresets([dest({
      id: "d-quotes", label: "Quotes",
      shape: { moduleId: "m-q", role: "textblock", kind: "quote",
        bindFields: [F.notes.id], autoFields: {} },
    })], FIELDS);
    expect(out.map((p) => p.name)).toEqual(["Quotes"]);
  });
});

// ── A KIND *OR* BOUND FIELDS ────────────────────────────────────────────────
//
// Measured on poms: requiring a kind rejected People (1,181 rows, 27 bound
// fields, `kind: null`) and Appointments — the two the user named alongside
// movies — while suggesting three imported article sections that bind NO fields
// and so produce a preset with no mappings at all.
describe("a kindless board that binds fields is still a board", () => {
  const kindless = (over = {}) => ({
    id: "d-people", label: "People", crumb: "Boards › Social", childCount: 1181,
    shape: { moduleId: "m-person", role: "instance", kind: null,
      bindFields: [F.title.id, F.notes.id], autoFields: {} },
    ...over,
  });

  it("suggests it, and maps the fields its rows bind", () => {
    const out = suggestPresets([kindless()], FIELDS);
    expect(out.map((p) => p.name)).toEqual(["People"]);
    expect(out[0].kind).toBe(null);
    expect(out[0].mappings[F.title.id]).toMatchObject({ source: "title" });
    expect(out[0].mappings[F.notes.id]).toMatchObject({ source: "selection" });
  });

  it("but a destination that binds NOTHING and has no kind is not a preset", () => {
    // An imported article section: rows, but no fields to map — so there is
    // nothing about it to reuse.
    expect(suggestPresets([kindless({
      id: "d-sec", label: "Psychology & Philosophy Insights", childCount: 17,
      shape: { moduleId: "m-tb", role: "textblock", kind: null, bindFields: [], autoFields: {} },
    })], FIELDS)).toEqual([]);
  });

  // The control: a KIND on its own is still enough, fields or not — that is how
  // a typed board with one binding (poms' Authors) stays in.
  it("a typed board with no bound fields is still suggested", () => {
    const out = suggestPresets([kindless({
      id: "d-img", label: "Eminem",
      shape: { moduleId: "m-img", role: "artifact", kind: "image", bindFields: [], autoFields: {} },
    })], FIELDS);
    expect(out.map((p) => p.name)).toEqual(["Eminem"]);
  });
});

