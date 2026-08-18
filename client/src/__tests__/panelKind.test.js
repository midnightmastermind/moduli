// A panel has no sub-types, and `getModuleTypeIcon` resolves kind BEFORE role —
// so a panel carrying `kind:"board"` draws the BOARD icon. Migration 0003 swept
// 525 of these off the live grid on 2026-07-29 and gridIntegrity flags them as
// `inert-kind`, yet every UI path that minted a panel still hand-wrote one.
// Measured 2026-08-18: a brand-new account's FIRST panel, created by clicking
// "Tap to add a panel", was born with that integrity warning.
//
// The rule is applied at createPanelInGrid — the one chokepoint every panel
// passes through — so a new call site cannot reintroduce it.
import { describe, it, expect } from "vitest";
import * as LayoutHelpers from "../helpers/LayoutHelpers.js";

// Assert on the WRITES THAT LEAVE, not on which helper was called: vi.spyOn on
// an ESM namespace import does not intercept (CLAUDE.md 2026-08-07 (6)), so a
// spy-based version of this test would pass against any implementation.
function mint(panel) {
  const emitted = [];
  LayoutHelpers.createPanelInGrid({
    dispatch: () => {},
    socket: { emit: (ev, payload) => emitted.push([ev, payload]), connected: true },
    grid: { id: "g1", _id: "g1", occurrences: [] },
    panel,
    placement: { row: 0, col: 0, width: 1, height: 1 },
    userId: "u1",
    emit: true,
  });
  const call = emitted.find(([ev]) => ev === "create_module");
  return call?.[1]?.module;
}

describe("createPanelInGrid", () => {
  it("actually emits a module (the probe works)", () => {
    const m = mint({ id: "p3", label: "Panel 3", kind: "board" });
    expect(m, "no create_module left the helper").toBeTruthy();
    expect(m.id).toBe("p3");
    expect(m.role).toBe("panel");
  });

  it("strips a kind the caller passed — a panel has no sub-types", () => {
    expect(mint({ id: "p1", label: "Board 1", kind: "board" }).kind).toBeNull();
  });

  it("mints no kind when the caller passed none", () => {
    expect(mint({ id: "p2", label: "Panel 2" }).kind).toBeNull();
  });
});
