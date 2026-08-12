import { describe, it, expect } from "vitest";
import { nextChildMinWidth, TARGET_CHILD_MIN_WIDTH }
  from "../migrations/0066-wider-tracker-tiles.mjs";

describe("0066 nextChildMinWidth", () => {
  it("raises the width 0064 stored", () => {
    expect(nextChildMinWidth(132)).toBe(TARGET_CHILD_MIN_WIDTH);
  });
  it("adopts the target when unset — the page wraps either way", () => {
    expect(nextChildMinWidth(undefined)).toBe(TARGET_CHILD_MIN_WIDTH);
    expect(nextChildMinWidth(null)).toBe(TARGET_CHILD_MIN_WIDTH);
  });
  it("NEVER lowers a width someone set wider by hand", () => {
    // The discriminating refusal: a migration that re-runs must not undo a
    // user's own choice.
    expect(nextChildMinWidth(240)).toBeNull();
  });
  it("is a no-op at exactly the target, which is what makes a re-run safe", () => {
    expect(nextChildMinWidth(TARGET_CHILD_MIN_WIDTH)).toBeNull();
  });
  it("treats a junk value as unset rather than throwing", () => {
    expect(nextChildMinWidth("wide")).toBe(TARGET_CHILD_MIN_WIDTH);
    expect(nextChildMinWidth(0)).toBe(TARGET_CHILD_MIN_WIDTH);
    expect(nextChildMinWidth(-5)).toBe(TARGET_CHILD_MIN_WIDTH);
  });
});
