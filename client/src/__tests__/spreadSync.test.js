import { describe, it, expect } from "vitest";
import { planSpreadSync } from "../ui/ArtifactSpreadHost";

describe("planSpreadSync", () => {
  // INVERTED 2026-08-27, and the reason matters more than the assertion.
  //
  // This case used to assert that the owner is dropped even when `filesOf`
  // REPORTS it. That is one of the two ways to stop the React #185 loop, and it
  // is the wrong one: the row that actually crashed — "A Theory of Human
  // Motivation" — is a book with `module.fileRef: null` and NO children, so
  // `filesOf` pushes self through its `!othersExist` arm and the owner is the
  // ONLY file there is. Dropping it converges by emptying the viewer, which is
  // what 10,795 rows on this grid then did ("images arent loading at all").
  //
  // Both directions still converge. This one also keeps the picture.
  it("LISTS an owner that is its own only file, and converges — the crash row", () => {
    const args = { listed: [], fileIds: ["owner"], ownerId: "owner", needsLayout: false };
    const out = planSpreadSync(args);
    expect(out).toEqual(["owner"]);
    expect(planSpreadSync({ ...args, listed: out })).toBeNull();
  });

  it("keeps the owner listed alongside its other files when filesOf reports it", () => {
    // An owner carrying its own src AND a child is two attachments, not one.
    const args = { listed: ["poster"], fileIds: ["owner", "poster"], ownerId: "owner", needsLayout: false };
    const out = planSpreadSync(args);
    expect(out).toEqual(["poster", "owner"]);
    expect(planSpreadSync({ ...args, listed: out })).toBeNull();
  });

  it("whatever it returns, feeding that back in returns null", () => {
    // The invariant. An effect that cannot say "done" about its own output is
    // an infinite loop waiting for the right data.
    const args = { listed: [], fileIds: ["a", "b", "owner"], ownerId: "owner", needsLayout: false };
    const first = planSpreadSync(args);
    expect(first).toEqual(["a", "b", "owner"]);
    expect(planSpreadSync({ ...args, listed: first })).toBeNull();
  });

  it("still ADDS genuinely new files — the control", () => {
    // Without this, "always return null" passes both tests above.
    expect(planSpreadSync({ listed: ["a"], fileIds: ["a", "b"], ownerId: "owner", needsLayout: false }))
      .toEqual(["a", "b"]);
  });

  it("RETRACTS an owner filesOf does NOT report — the movie double-poster", () => {
    // A movie row carries no src of its own and owns a poster child, so
    // `filesOf` returns the poster ALONE. An owner in the list is then a
    // phantom persisted by an older mint, and it drew the same poster twice
    // over a header saying "2 files". This is the half `504fc3ca` fixed and it
    // must survive: the discriminator is what filesOf reports, not the id.
    const args = { listed: ["owner", "a"], fileIds: ["a"], ownerId: "owner", needsLayout: false };
    const out = planSpreadSync(args);
    expect(out).toEqual(["a"]);
    expect(planSpreadSync({ ...args, listed: out })).toBeNull();
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
