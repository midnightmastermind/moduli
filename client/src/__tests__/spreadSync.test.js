import { describe, it, expect } from "vitest";
import { planSpreadSync } from "../ui/ArtifactSpreadHost";

describe("planSpreadSync", () => {
  it("CONVERGES on a media row that is one of its own files — the crash", () => {
    // `filesOf` pushes the owner's own id when the owner is role:"artifact"
    // with a src, which every book row is since `0222`. The write strips it, so
    // if it also counted as MISSING the effect rewrote forever: React #185.
    const args = { listed: ["poster"], fileIds: ["owner", "poster"], ownerId: "owner", needsLayout: false };
    expect(planSpreadSync(args)).toBeNull();
  });

  it("whatever it returns, feeding that back in returns null", () => {
    // The invariant. An effect that cannot say "done" about its own output is
    // an infinite loop waiting for the right data.
    const first = planSpreadSync({ listed: [], fileIds: ["a", "b", "owner"], ownerId: "owner", needsLayout: false });
    expect(first).toEqual(["a", "b"]);
    expect(planSpreadSync({ listed: first, fileIds: ["a", "b", "owner"], ownerId: "owner", needsLayout: false })).toBeNull();
  });

  it("still ADDS genuinely new files — the control", () => {
    // Without this, "always return null" passes both tests above.
    expect(planSpreadSync({ listed: ["a"], fileIds: ["a", "b"], ownerId: "owner", needsLayout: false }))
      .toEqual(["a", "b"]);
  });

  it("RETRACTS an owner that was persisted into the list by an older build", () => {
    expect(planSpreadSync({ listed: ["owner", "a"], fileIds: ["a"], ownerId: "owner", needsLayout: false }))
      .toEqual(["a"]);
  });

  it("writes once for layout alone, then settles", () => {
    const out = planSpreadSync({ listed: ["a"], fileIds: ["a"], ownerId: "owner", needsLayout: true });
    expect(out).toEqual(["a"]);
    expect(planSpreadSync({ listed: out, fileIds: ["a"], ownerId: "owner", needsLayout: false })).toBeNull();
  });

  it("never prunes a file the owner no longer reports — additive by design", () => {
    // A picture a migration replaced stays listed; only the OWNER is dropped.
    expect(planSpreadSync({ listed: ["old", "a"], fileIds: ["a"], ownerId: "owner", needsLayout: false })).toBeNull();
  });
});
