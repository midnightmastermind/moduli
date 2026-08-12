import { describe, it, expect } from "vitest";
import { kindForNewModule } from "../helpers/operationActions";

// The 2026-07-29 rule: only container / page / artifact / textblock have
// sub-types. `getModuleTypeIcon` resolves kind BEFORE role, so a kind on any
// other role draws the wrong icon everywhere an icon appears.
describe("kindForNewModule", () => {
  it("invents NO kind for a kindless role — the 232-module defect", () => {
    // A cloned routine instance arrives with kind undefined; defaulting it to
    // "doc" is what produced instance/doc on the live grid for nine days.
    expect(kindForNewModule("instance", undefined)).toBeNull();
    expect(kindForNewModule("panel", undefined)).toBeNull();
  });

  it("keeps the historical doc default for every kind-BEARING role", () => {
    for (const role of ["container", "page", "artifact", "textblock"]) {
      expect(kindForNewModule(role, undefined)).toBe("doc");
    }
  });

  it("an EXPLICIT kind always wins, even on a kindless role", () => {
    // The discriminating case: a caller that means it must not be overruled.
    expect(kindForNewModule("instance", "inline")).toBe("inline");
    expect(kindForNewModule("container", "board")).toBe("board");
  });

  it("treats an unknown role as kind-bearing rather than stripping it", () => {
    // Fail toward the status quo: a role nobody has classified keeps the old
    // behaviour instead of silently losing a kind something may render by.
    expect(kindForNewModule("somethingNew", undefined)).toBe("doc");
  });

  it("does not mistake an empty string for an explicit kind", () => {
    expect(kindForNewModule("instance", "")).toBeNull();
  });
});
