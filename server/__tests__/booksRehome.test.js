import { describe, it, expect } from "vitest";
import { planRehome } from "../migrations/0227-books-out-of-the-music-folder.mjs";

describe("planRehome — only what is actually in the Music folder moves", () => {
  it("moves the pages sitting in Music", () => {
    const p = [{ id: "b", label: "Books", parentId: "MUSIC" }, { id: "a", label: "Authors", parentId: "MUSIC" }];
    expect(planRehome(p, "MUSIC", "BOOKS").map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("leaves a page that is ALREADY in the right place — this is the idempotency", () => {
    // A second run must move nothing, or the migration is not re-runnable.
    const p = [{ id: "b", label: "Books", parentId: "BOOKS" }];
    expect(planRehome(p, "MUSIC", "BOOKS")).toEqual([]);
  });

  it("never touches a page homed somewhere else entirely", () => {
    const p = [{ id: "x", label: "Books", parentId: "SOMEWHERE" }];
    expect(planRehome(p, "MUSIC", "BOOKS")).toEqual([]);
  });

  it("handles no pages at all rather than throwing", () => {
    expect(planRehome([], "M", "B")).toEqual([]);
    expect(planRehome(undefined, "M", "B")).toEqual([]);
  });
});
