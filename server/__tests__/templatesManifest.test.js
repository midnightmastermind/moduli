// server/__tests__/templatesManifest.test.js
import mongoose from "mongoose";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Manifest from "../models/Manifest.js";
import Folder from "../models/Folder.js";
import { ensureTemplatesManifest } from "../utils/templatesManifest.js";

describe("ensureTemplatesManifest", () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/moduli-test", {
        serverSelectionTimeoutMS: 1000,
      }).catch(() => {});
    }
  });
  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  });
  beforeEach(async () => {
    if (mongoose.connection.readyState !== 1) return;
    await Manifest.deleteMany({ gridId: "g-test" });
    await Folder.deleteMany({ gridId: "g-test" });
  });

  it("creates manifest + root folder when missing", async () => {
    if (mongoose.connection.readyState !== 1) return;
    const uc = { manifestsById: {}, foldersById: {} };
    const m = await ensureTemplatesManifest({ gridId: "g-test", userId: "u1", uc });
    expect(m.manifestType).toBe("templates");
    expect(m.rootFolderId).toBeTruthy();
    const folder = uc.foldersById[m.rootFolderId];
    expect(folder.folderType).toBe("templates");
  });

  it("is idempotent", async () => {
    if (mongoose.connection.readyState !== 1) return;
    const uc = { manifestsById: {}, foldersById: {} };
    const m1 = await ensureTemplatesManifest({ gridId: "g-test", userId: "u1", uc });
    const m2 = await ensureTemplatesManifest({ gridId: "g-test", userId: "u1", uc });
    expect(m1.id).toBe(m2.id);
  });
});
