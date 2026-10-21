// A sender can name each share, so two posts of the same text are two rows.
import { describe, it, expect } from "vitest";
import { senderIdentity, prepareShare } from "../services/shareIngress.js";

describe("senderIdentity", () => {
  it("namespaces the id so it cannot collide with a derived one", () => {
    expect(senderIdentity("bangle", "1700000000000-ab")).toBe("ext:bangle:1700000000000-ab");
    expect(senderIdentity("bangle", "text:Drink water")).toBe("ext:bangle:text:Drink water");
  });
  it("refuses empty, non-string and oversized ids", () => {
    expect(senderIdentity("bangle", "")).toBeNull();
    expect(senderIdentity("bangle", 5)).toBeNull();
    expect(senderIdentity("bangle", "x".repeat(201))).toBeNull();
  });
});

describe("prepareShare with a sender id", () => {
  it("two posts of the same text get different identities", async () => {
    const a = await prepareShare({ userId: "u", gridId: "g", source: "bangle", text: "Drink water", externalId: "1" });
    const b = await prepareShare({ userId: "u", gridId: "g", source: "bangle", text: "Drink water", externalId: "2" });
    expect(a.externalId).not.toBe(b.externalId);
  });
  it("control: without one, the same text is the same share", async () => {
    const a = await prepareShare({ userId: "u", gridId: "g", source: "bangle", text: "Drink water" });
    const b = await prepareShare({ userId: "u", gridId: "g", source: "bangle", text: "Drink water" });
    expect(a.externalId).toBe(b.externalId);
  });
});
