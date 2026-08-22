import { describe, it, expect } from "vitest";
import { taskCategories, hideCompletedEntry } from "../migrations/0189-completed-tasks-leave-their-category.mjs";

const COMPLETED = "tZWiPDQUDP74";
const modById = new Map([
  ["m-cont", { id: "m-cont", role: "container" }],
  ["m-inst", { id: "m-inst", role: "instance" }],
]);
const world = () => ({
  tasksPage: { id: "tasks", occurrences: ["physical", "pauls", "completed", "stray"] },
  occs: [
    { id: "physical",  moduleId: "m-cont" },
    { id: "pauls",     moduleId: "m-cont", label: "Paul's Website" },
    { id: "completed", moduleId: "m-cont", feed: { enabled: true } },
    { id: "stray",     moduleId: "m-inst" },
  ],
  modById,
});

describe("0189 — which containers get the hide rule", () => {
  it("takes every container child of the Tasks page", () => {
    expect(taskCategories(world()).map((c) => c.id)).toEqual(["physical", "pauls"]);
  });

  it("includes a category a NAME LIST would have missed", () => {
    // `Paul's Website` is a real category the user added beside the nine dimensions.
    expect(taskCategories(world()).map((c) => c.id)).toContain("pauls");
  });

  it("EXCLUDES the feed-backed container — it is the destination, not a source", () => {
    // Adding the rule there would hide the very copies the feed exists to show.
    expect(taskCategories(world()).map((c) => c.id)).not.toContain("completed");
  });

  it("ignores an instance child — only containers hold tasks", () => {
    expect(taskCategories(world()).map((c) => c.id)).not.toContain("stray");
  });

  it("returns nothing for a page with no children rather than throwing", () => {
    expect(taskCategories({ tasksPage: { occurrences: [] }, occs: [], modById })).toEqual([]);
  });
});

describe("0189 — the entry it writes", () => {
  it("declares `hides` explicitly — there is no default to fall back on", () => {
    expect(hideCompletedEntry(COMPLETED).hides).toBe(true);
  });

  it("is active, and gates on the Completed field NOT being true", () => {
    const e = hideCompletedEntry(COMPLETED);
    expect(e.active).toBe(true);
    expect(e.condition.rules[0]).toMatchObject({
      left: `$occ.fields.${COMPLETED}.value`, comparator: "IS_NOT", right: true,
    });
  });

  it("mints a unique id per call, so two runs cannot collide", () => {
    expect(hideCompletedEntry(COMPLETED).id).not.toBe(hideCompletedEntry(COMPLETED).id);
  });
});
