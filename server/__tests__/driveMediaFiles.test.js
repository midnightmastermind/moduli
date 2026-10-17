import { describe, it, expect, vi } from "vitest";
vi.mock("../models/Connection.js", () => ({ default: {} }));
vi.mock("../models/Secret.js", () => ({ decryptCipherShape: () => ({}) }));
vi.mock("../services/googleOAuth.js", () => ({ refreshAccessToken: async () => ({}) }));
const { planMediaFiles } = await import("../migrations/0412-drive-media-files.mjs");

describe("0412 planMediaFiles", () => {
  const files = [
    { id: "a", name: "ep1.mp3", mimeType: "audio/mpeg" },
    { id: "v", name: "clip.mp4", mimeType: "video/mp4" },
    { id: "d", name: "Books", mimeType: "application/vnd.google-apps.folder" },
    { id: "p", name: "doc.pdf", mimeType: "application/pdf" },
  ];
  it("takes audio and video, not folders or documents", () => {
    const plan = planMediaFiles(files, { connectionId: "c", existingRefs: new Set() });
    expect(plan.map((f) => [f.id, f.kind, f.fileRef])).toEqual([["a", "audio", "gdrive:c:a"], ["v", "video", "gdrive:c:v"]]);
  });
  it("skips a file a module already points at", () => {
    const plan = planMediaFiles(files, { connectionId: "c", existingRefs: new Set(["gdrive:c:a"]) });
    expect(plan.map((f) => f.id)).toEqual(["v"]);
  });
});
