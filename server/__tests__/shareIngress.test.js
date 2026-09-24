// server/__tests__/shareIngress.test.js
//
// INGRESS PREPARES, THE RULE ROUTES (spec §3).
import { describe, it, expect } from "vitest";
import { prepareShare, shareLabelFor, shareExternalIdFor } from "../services/shareIngress.js";

const okPreview = async (url) => ({ ok: true, url, title: "Example Page", favicon: "https://x.test/f.ico", cover: "https://x.test/c.jpg" });

describe("prepareShare", () => {
  it("fetches link metadata BEFORE any rule runs, and labels from it", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1", url: "https://x.test/a", fetchPreview: okPreview });
    expect(s.type).toBe("link");
    expect(s.props.title).toBe("Example Page");
    expect(s.props.image).toBe("https://x.test/c.jpg");
    expect(s.label).toBe("Example Page");
  });

  it("a dead link still shares, labelled by its url", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1", url: "https://dead.test/a",
      fetchPreview: async () => ({ ok: false, error: "nope" }) });
    expect(s.label).toBe("https://dead.test/a");
    expect(s.props.title).toBeNull();
  });

  it("a throwing preview does not lose the share", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1", url: "https://x.test/a",
      fetchPreview: async () => { throw new Error("dns"); } });
    expect(s.type).toBe("link");
  });

  it("keys a link on the extension's <shape>:<url> scheme (D15)", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1", url: "https://x.test/a", shape: "page" });
    expect(s.externalId).toBe("page:https://x.test/a");
  });

  it("defaults a link's shape to `link`", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1", url: "https://x.test/a" });
    expect(s.externalId).toBe("link:https://x.test/a");
  });

  it("an explicit label wins over the fetched title", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1", url: "https://x.test/a", label: "Mine", fetchPreview: okPreview });
    expect(s.label).toBe("Mine");
  });

  it("labels text by its first line", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1", text: "Buy milk\nand eggs" });
    expect(s.type).toBe("text");
    expect(s.label).toBe("Buy milk");
  });

  it("carries the source so a rule can branch on where it came from", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1", source: "android", text: "hi" });
    expect(s.source).toBe("android");
  });

  it("REFUSES a file rather than dropping it while file upload is unwired", async () => {
    await expect(prepareShare({ userId: "u1", gridId: "g1",
      files: [{ filename: "a.jpg", mimetype: "image/jpeg", size: 1 }] }))
      .rejects.toMatchObject({ code: "files_unsupported" });
  });

  it("with a storeFile, exposes the uploaded ids and keys on the hash", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1",
      files: [{ filename: "a.jpg", mimetype: "image/jpeg", size: 1 }],
      storeFile: async () => ({ occurrenceId: "occ-file", fileRef: "user/2026-09/a.jpg", sha256: "abc" }) });
    expect(s.props.occurrenceId).toBe("occ-file");
    expect(s.externalId).toBe("sha256:abc");
  });
});

describe("labels and keys", () => {
  it("trims a long label", () => {
    expect(shareLabelFor("text", { firstLine: "x".repeat(300) }).length).toBeLessThanOrEqual(120);
  });
  it("keys text on its content", () => {
    expect(shareExternalIdFor("text", { text: "hello  world" })).toBe("text:hello world");
  });
});
