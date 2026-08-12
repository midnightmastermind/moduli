// 0073 fixes 0072, which walked a fixed TWO levels and never checked role — so
// it missed every tile in a nested group and bound four container headers.
// These tests are about depth-independence and the role split.
import { describe, it, expect } from "vitest";
import { collectSubtree } from "../migrations/0073-tracker-date-tiles-only.mjs";

// page -> [Physical(c) -> [Water(i), Today's Workout(c) -> [Reps(i), Chest Volume(i)]],
//          Intellectual(c) -> [Today's Media(c) -> [Books(i)]]]
const OCCS = {
  page: { id: "page", occurrences: ["phys", "intel"] },
  phys: { id: "phys", occurrences: ["water", "workout"] },
  water: { id: "water" },
  workout: { id: "workout", occurrences: ["reps", "chest"] },
  reps: { id: "reps" }, chest: { id: "chest" },
  intel: { id: "intel", occurrences: ["media"] },
  media: { id: "media", occurrences: ["books"] },
  books: { id: "books" },
};
const ROLES = {
  phys: "container", intel: "container", workout: "container", media: "container",
  water: "instance", reps: "instance", chest: "instance", books: "instance",
};
const occById = new Map(Object.entries(OCCS));
const run = (occs = occById) => collectSubtree("page", { occById: occs, roleOf: (id) => ROLES[id] });

describe("0073 collectSubtree", () => {
  // THE REGRESSION. A two-level walk sees water only; the nested groups' tiles
  // are at depth 3 and were silently missed.
  it("finds instances at EVERY depth, not just the first two levels", () => {
    const ids = run().filter((n) => n.role === "instance").map((n) => n.id).sort();
    expect(ids).toEqual(["books", "chest", "reps", "water"]);
  });

  it("reports the depth, so a fixed-depth assumption is visible", () => {
    const byId = Object.fromEntries(run().map((n) => [n.id, n.depth]));
    expect(byId.water).toBe(2);
    expect(byId.reps).toBe(3);
    expect(byId.books).toBe(3);
  });

  it("separates containers from instances", () => {
    const conts = run().filter((n) => n.role === "container").map((n) => n.id).sort();
    expect(conts).toEqual(["intel", "media", "phys", "workout"]);
  });

  it("does not include the root itself", () => {
    expect(run().some((n) => n.id === "page")).toBe(false);
  });

  it("terminates on a cycle instead of hanging", () => {
    const cyc = new Map(Object.entries({
      page: { id: "page", occurrences: ["a"] },
      a: { id: "a", occurrences: ["b"] },
      b: { id: "b", occurrences: ["a"] },
    }));
    const out = collectSubtree("page", { occById: cyc, roleOf: () => "instance" });
    expect(out.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("skips a dangling child id rather than throwing", () => {
    const d = new Map(Object.entries({ page: { id: "page", occurrences: ["gone", "water"] }, water: { id: "water" } }));
    const out = collectSubtree("page", { occById: d, roleOf: (id) => ROLES[id] });
    expect(out.map((n) => n.id)).toEqual(["gone", "water"]);
  });

  it("returns nothing for a childless root", () => {
    expect(collectSubtree("water", { occById, roleOf: (id) => ROLES[id] })).toEqual([]);
  });
});
