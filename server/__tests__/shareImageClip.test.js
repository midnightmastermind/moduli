// An image clipped by the extension is stored as a FILE (2026-10-14). It used
// to run as a link and land in Bookmarks pointing at a CDN url that expires.
import { describe, it, expect, vi } from "vitest";
import { prepareShare } from "../services/shareIngress.js";
import { shareTypeOfPayload } from "../services/shareRules.js";

const png = Buffer.from("89504e470d0a1a0a0000", "hex");
const clip = { externalId: "image:https://cdn.test/p/846_n.png?oe=1", label: "Facebook", moduleKind: "image",
  moduleFileRef: "https://cdn.test/p/846_n.png?oe=1", meta: { clipShape: "image", clippedFrom: "https://facebook.com/photo" } };

describe("image clips", () => {
  it("are fetched, stored, and shared as an image with its own row", async () => {
    const storeFile = vi.fn(async ({ file }) => ({ occurrenceId: "occ-img", fileRef: "user/x.png", sha256: "h", name: file.filename }));
    const s = await prepareShare({ userId: "u", gridId: "g", source: "extension", url: clip.moduleFileRef, shape: "image", clip,
      storeFile, fetchImage: async () => ({ buf: png, type: "image/png" }) });
    expect(s.type).toBe("image");
    expect(s.props.occurrenceId).toBe("occ-img");
    expect(s.clip).toBeNull();
    expect(storeFile.mock.calls[0][0].file.filename).toBe("846_n.png");
    expect(s.externalId).toBe(clip.externalId);
  });

  it("a data: image is decoded and stored too", async () => {
    const src = `data:image/png;base64,${png.toString("base64")}`;
    const storeFile = vi.fn(async () => ({ occurrenceId: "o2", fileRef: "user/y.png" }));
    const s = await prepareShare({ userId: "u", gridId: "g", url: src, shape: "image",
      clip: { ...clip, moduleFileRef: src }, storeFile });
    expect(s.type).toBe("image");
    expect(storeFile).toHaveBeenCalled();
  });

  it("control: an unreadable picture still shares as before (a link)", async () => {
    const s = await prepareShare({ userId: "u", gridId: "g", url: clip.moduleFileRef, shape: "image", clip,
      storeFile: vi.fn(), fetchImage: async () => null });
    expect(s.type).toBe("link");
    expect(s.clip).not.toBeNull();
  });

  it("the placement window's preview calls it an image", () => {
    expect(shareTypeOfPayload({ url: clip.moduleFileRef, shape: "image" })).toBe("image");
    expect(shareTypeOfPayload({ url: "https://x.test/a" })).toBe("link");
  });
});
