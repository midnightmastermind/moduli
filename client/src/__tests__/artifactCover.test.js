// A bookmark's `fileRef` is a WEB PAGE, so the card's own `src` points at HTML
// and all 1,467 of them drew the generic 📄 — including the 1,030 that had
// carried a cover URL since the import. This is the rule that fixes that.
import { describe, it, expect } from "vitest";
import { coverAppliesTo } from "../modules/ArtifactCard";

describe("coverAppliesTo", () => {
  it("fills in for a kind with no picture of its own", () => {
    expect(coverAppliesTo("bookmark", "https://cdn/og.png")).toBe(true);
    expect(coverAppliesTo(undefined, "https://cdn/og.png")).toBe(true);
  });

  it("NEVER replaces an image's own picture", () => {
    // The cover would be a worse version of the thing itself.
    expect(coverAppliesTo("image", "https://cdn/og.png")).toBe(false);
  });

  it("never replaces a video, audio or pdf — each has a real control", () => {
    // A still frame in place of an <audio> player is a downgrade, not a cover.
    expect(coverAppliesTo("video", "https://cdn/og.png")).toBe(false);
    expect(coverAppliesTo("audio", "https://cdn/og.png")).toBe(false);
    expect(coverAppliesTo("pdf", "https://cdn/og.png")).toBe(false);
  });

  it("is false with no cover, whatever the kind — the control", () => {
    // Without this the whole predicate could read `true` and three of the tests
    // above would still pass.
    expect(coverAppliesTo("bookmark", null)).toBe(false);
    expect(coverAppliesTo("bookmark", "")).toBe(false);
    expect(coverAppliesTo("image", null)).toBe(false);
  });
});
