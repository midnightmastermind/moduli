import { describe, it, expect } from "vitest";
import { idsToLabels, withoutTag, CONVERT } from "../migrations/0428-bare-board-selects-become-string-lists.mjs";
import { purchaseItemSource } from "../migrations/0427-purchases-board.mjs";

const names = { a: "Pencil", b: "Piano" };
const labelOf = (x) => names[x] ?? null;

describe("0428 idsToLabels", () => {
  it("a single id becomes its name", () => expect(idsToLabels("a", labelOf, false)).toBe("Pencil"));
  it("a multi value becomes names, deduped", () => expect(idsToLabels(["a", "b", "a"], labelOf, true)).toEqual(["Pencil", "Piano"]));
  it("an id naming nothing drops", () => {
    expect(idsToLabels("zz", labelOf, false)).toBeNull();
    expect(idsToLabels(["zz", "b"], labelOf, true)).toEqual(["Piano"]);
  });
});

describe("0428 withoutTag", () => {
  it("drops only the named tag's rule, nested OR included", () => {
    const p = { operator: "AND", rules: [{ operator: "OR", rules: [
      { left: "fields.BC.value", comparator: "CONTAINS", right: "savingsGoal" },
      { left: "fields.BC.value", comparator: "CONTAINS", right: "wishlist" },
    ] }, { left: "meta.feedSourceId", comparator: "IS_EMPTY", right: "" }] };
    const out = withoutTag(p, "BC", "wishlist");
    expect(JSON.stringify(out)).not.toContain("wishlist");
    expect(JSON.stringify(out)).toContain("savingsGoal");
    expect(out.rules[1].left).toBe("meta.feedSourceId");
  });
});

describe("0428 scope", () => {
  it("never converts a field whose rows carry data or an op reads", () => {
    for (const kept of ["Ingredient", "Meal", "Movement", "Mood", "Location", "Beverage", "Media", "Reading", "Project", "Schedule Type", "Account", "Purchase Item"]) {
      expect(CONVERT).not.toContain(kept);
    }
  });
});

describe("0427 purchaseItemSource", () => {
  it("queries the purchase tag, excludes feed copies, files new items on the board", () => {
    const s = purchaseItemSource({ valuePath: "id", addNew: { targets: ["x", "y"] }, search: true }, "BC", "BOARD");
    expect(s.predicate.rules[0]).toEqual({ left: "fields.BC.value", comparator: "CONTAINS", right: "purchase" });
    expect(s.predicate.rules[1].left).toBe("meta.feedSourceId");
    expect(s.addNew.targets).toEqual(["BOARD"]);
    expect(s.search).toBe(true);
  });
});
