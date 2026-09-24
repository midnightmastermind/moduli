// services/artifactUpload.js — the upload moved out of server.js so the share
// route can use it. Run for REAL on the file system (a temp uploads dir, a real
// PNG, real sha256, real sharp thumbnails) with only the Mongo models faked, so
// a name that did not survive the move fails here, not on the first upload.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const db = { modules: new Map(), occurrences: new Map(), views: new Map() };
const matches = (d, q) => Object.entries(q).every(([k, v]) =>
  k.includes(".") ? k.split(".").reduce((o, p) => o?.[p], d) === v
  : (v && typeof v === "object" && "$not" in v) ? !v.$not.test(d[k] || "") : d[k] === v);
const model = (store) => {
  const found = (q) => [...store.values()].find(d => matches(d, q)) || null;
  return {
    findOne: (q) => { const r = found(q); const doc = r ? { ...r, toObject: () => ({ ...r }) } : null;
      return Object.assign(Promise.resolve(doc), { lean: async () => (r ? { ...r } : null) }); },
    findOneAndUpdate: async (q, doc) => { const id = q.id; store.set(id, { ...(store.get(id) || {}), ...doc }); return store.get(id); },
    deleteOne: async (q) => { store.delete(q.id); },
  };
};
vi.mock("../models/Module.js", () => ({ default: model(db.modules) }));
vi.mock("../models/Occurrence.js", () => ({ default: model(db.occurrences) }));
vi.mock("../models/View.js", () => ({ default: class { constructor(d) { Object.assign(this, d); } async save() { db.views.set(this.id, { ...this }); } } }));

const { makeArtifactUploader } = await import("../services/artifactUpload.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "moduli-upl-"));
const uploadsDir = path.join(tmp, "uploads");
fs.mkdirSync(path.join(uploadsDir, "thumbnails"), { recursive: true });
const PNG = path.resolve(__dirname, "../../extension/icon128.png");
const emitted = [];
const uploader = makeArtifactUploader({
  uploadsDir,
  routeCache: () => null,
  homeFolderForUpload: async ({ kind }) => `files-${kind}`,
  io: { to: () => ({ emit: (ev) => emitted.push(ev) }) },
  userRoom: (u) => `user:${u}`,
});
const tempCopy = (name) => { const p = path.join(tmp, `${Date.now()}-${Math.random()}-${name}`); fs.copyFileSync(PNG, p); return p; };
const file = (p, name = "photo.png") => ({ path: p, originalname: name, mimetype: "image/png", size: fs.statSync(p).size, filename: path.basename(p) });

beforeEach(() => { db.modules.clear(); db.occurrences.clear(); db.views.clear(); emitted.length = 0; });
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("storeUploadedFile", () => {
  it("files a new image: sharded fileRef, sha256, dimensions, thumbnails, home folder", async () => {
    const p = tempCopy("photo.png");
    const out = await uploader.storeUploadedFile({ file: file(p), userId: "u1", gridId: "g1" });
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.fileRef).toMatch(/^user\/\d{4}-\d{2}\//);
    expect(fs.existsSync(path.join(uploadsDir, out.fileRef))).toBe(true);
    expect(fs.existsSync(p)).toBe(false);                       // moved, not copied
    expect(out.module).toMatchObject({ role: "artifact", kind: "image", label: "photo.png" });
    expect(out.module.meta).toMatchObject({ sha256: out.sha256, mimeType: "image/png", width: 128, height: 128 });
    expect(fs.existsSync(path.join(uploadsDir, out.module.meta.thumb256))).toBe(true);
    expect(out.occurrence.parentId).toBe("files-image");
    expect(emitted).toEqual(expect.arrayContaining(["module_created", "occurrence_created", "artifact_created"]));
  });

  it("the same bytes again reuse the module (dedup) and remove the temp file", async () => {
    const first = await uploader.storeUploadedFile({ file: file(tempCopy("a.png")), userId: "u1", gridId: "g1" });
    const p2 = tempCopy("b.png");
    const second = await uploader.storeUploadedFile({ file: file(p2, "b.png"), userId: "u1", gridId: "g1" });
    expect(second.dedup).toBe(true);
    expect(second.module.id).toBe(first.module.id);
    expect(second.occurrence.id).not.toBe(first.occurrence.id);
    expect(fs.existsSync(p2)).toBe(false);
  });

  it("refuses with no file", async () => {
    await expect(uploader.storeUploadedFile({ userId: "u1" })).rejects.toThrow(/Missing/);
  });
});
