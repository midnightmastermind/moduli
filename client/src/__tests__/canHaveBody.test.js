// A body is an INSTANCE affordance.
//
// `ModuleInstance` is the shared row SHELL, not an instance-only renderer:
// `ModuleTextblock`'s `card` context composes it, and so does every ArtifactCard
// call site. When the body button was added to that shell it went to all three
// roles — user 2026-08-17: "textblock rows are not instances." One screen
// carried 34 textblock cards offering it.
//
// The value of these cases is not the tautology `role === "instance"`; it is
// that they NAME the roles that must be excluded, so a future "gate on
// !renderBody instead" (which happens to select the same rows today) fails here
// rather than quietly re-granting the affordance to a role that gains a
// renderBody later.
import { describe, it, expect } from "vitest";
import { canHaveBody } from "../modules/ModuleInstance.jsx";

describe("canHaveBody", () => {
  it("an instance row gets a body", () => {
    expect(canHaveBody({ role: "instance" })).toBe(true);
  });

  it("a TEXTBLOCK does not — it is already its own body", () => {
    // Its `occurrence.textmap` is what TextblockCard renders, so a disclosure
    // opened a doc showing the row's own text a second time.
    expect(canHaveBody({ role: "textblock" })).toBe(false);
  });

  it("an ARTIFACT does not — the other role that composes this shell", () => {
    expect(canHaveBody({ role: "artifact" })).toBe(false);
  });

  it("no other role does either", () => {
    for (const role of ["container", "page", "panel"]) {
      expect(canHaveBody({ role })).toBe(false);
    }
  });

  it("fails CLOSED on a missing module or missing role", () => {
    // Census on poms grid: all 3101 modules carry a role, so this never fires
    // in practice — but "no role" must not read as "instance", because the
    // wrong direction silently re-grants the affordance grid-wide.
    expect(canHaveBody(null)).toBe(false);
    expect(canHaveBody(undefined)).toBe(false);
    expect(canHaveBody({})).toBe(false);
  });
});
