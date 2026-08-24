import { describe, it, expect } from "vitest";
import { resolveMap, AUTHORED } from "../migrations/0229-author-the-field-maps.mjs";

const fields = new Map([["Pages", { id: "p1", type: "number" }], ["Muscle Group", { id: "m1", type: "select" }]]);

describe("resolveMap — names become ids, and a missing target is REPORTED", () => {
  it("resolves an authored map to field ids", () => {
    const e = AUTHORED.find((x) => x.field === "Reading");
    expect(resolveMap(e, fields)).toMatchObject({ fieldMap: { Pages: "p1" }, missing: [] });
  });

  it("carries the wger aliases through", () => {
    const e = AUTHORED.find((x) => x.field === "Movement");
    const r = resolveMap(e, fields);
    expect(r.fieldMap).toEqual({ Category: "m1" });
    expect(r.aliases.Category).toMatchObject({ Abs: "core", Calves: "legs" });
  });

  it("REPORTS a target this grid does not have instead of writing a dangling id", () => {
    // A field id that resolves to nothing is a mapping that silently writes
    // nowhere — the class this whole pass exists to remove.
    const r = resolveMap({ map: { Pages: "Nonexistent" } }, fields);
    expect(r.fieldMap).toEqual({});
    expect(r.missing).toEqual(["Nonexistent"]);
  });

  it("maps wger's CATEGORY, never its Muscles", () => {
    // Measured: `Muscles` answers "Quads" / "Obliquus externus abdominis",
    // which `Muscle Group` does not offer. `Category` answers Chest/Legs/Back.
    const e = AUTHORED.find((x) => x.field === "Movement");
    expect(Object.keys(e.map)).toEqual(["Category"]);
  });

  it("authors nothing for a provider whose keys were never probed", () => {
    // openfoodfacts (503), tmdb (no key), places/musicbrainz (unwritable target
    // types) are deliberately absent — authoring them would be a guess.
    const names = AUTHORED.map((e) => e.provider);
    expect(names).not.toContain("openfoodfacts");
    expect(names).not.toContain("tmdb");
    expect(names).not.toContain("places");
  });
});
