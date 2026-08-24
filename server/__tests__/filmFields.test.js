// 0233 — the film map, against the keys TMDB really emits.
import { describe, it, expect } from "vitest";
import { NEW_FIELDS, KEY_TO_FIELD, fieldsToMint } from "../migrations/0233-film-fields.mjs";
import { filmFields } from "../utils/providers/tmdb.js";

const SAMPLE = {
  release_date: "2010-07-15", runtime: 148, vote_average: 8.4,
  genres: [{ name: "Action" }, { name: "Science Fiction" }],
  tagline: "Your mind is the scene of the crime.",
  credits: { crew: [{ job: "Director", name: "Christopher Nolan" }, { job: "Writer", name: "Christopher Nolan" }],
             cast: [{ name: "Leonardo DiCaprio" }, { name: "Joseph Gordon-Levitt" }] },
};

describe("0233", () => {
  it("EVERY key it maps is one TMDB actually emits", () => {
    // A map is authored against a key NAME, so a casing slip is a field that
    // stays empty with nothing to say why.
    const keys = Object.keys(filmFields(SAMPLE));
    for (const k of Object.keys(KEY_TO_FIELD)) expect(keys).toContain(k);
  });

  it("leaves Cast, Writer and Tagline unmapped — decided, not forgotten", () => {
    const mapped = new Set(Object.keys(KEY_TO_FIELD));
    for (const k of ["Cast", "Writer", "Tagline"]) expect(mapped.has(k)).toBe(false);
  });

  it("mints only what is missing — a re-run mints nothing", () => {
    expect(fieldsToMint(new Set())).toHaveLength(5);
    expect(fieldsToMint(new Set(NEW_FIELDS.map(([n]) => n)))).toEqual([]);
  });

  it("Released is a real date field, and TMDB answers in that exact shape", () => {
    expect(NEW_FIELDS.find(([n]) => n === "Released")[1]).toBe("date");
    expect(filmFields(SAMPLE).Released).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("names the rating for its source — the grid's own `Rating` is 1-5 stars", () => {
    // Two numbers on different scales under one name is the IU/mcg mismatch.
    expect(KEY_TO_FIELD.Rating).toBe("TMDB Rating");
    expect(Number(filmFields(SAMPLE).Rating)).toBeGreaterThan(5);
  });

  it("every numeric field carries its unit", () => {
    for (const [name, type, unit] of NEW_FIELDS) {
      if (type === "number") expect(unit, `${name} needs a unit`).toBeTruthy();
    }
  });
});
