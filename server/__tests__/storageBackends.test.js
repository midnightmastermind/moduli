// services/storage + the uploader's backend seam (plan 2026-09-24-connections-
// storage-gdrive, Task 2). Real file system, real PNG, Mongo faked.
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
    findOneAndUpdate: async (q, doc) => { store.set(q.id, { ...(store.get(q.id) || {}), ...doc }); return store.get(q.id); },
    deleteOne: async (q) => { store.delete(q.id); },
  };
};
vi.mock("../models/Module.js", () => ({ default: model(db.modules) }));
vi.mock("../models/Occurrence.js", () => ({ default: model(db.occurrences) }));
vi.mock("../models/View.js", () => ({ default: class { constructor(d) { Object.assign(this, d); } async save() { db.views.set(this.id, { ...this }); } } }));

const { makeArtifactUploader } = await import("../services/artifactUpload.js");
const { makeLocalBackend } = await import("../services/storage/local.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "moduli-stor-"));
const uploadsDir = path.join(tmp, "uploads");
fs.mkdirSync(path.join(uploadsDir, "thumbnails"), { recursive: true });
const PNG = path.resolve(__dirname, "../../extension/icon128.png");
const tempCopy = () => { const p = path.join(uploadsDir, `${Date.now()}-${Math.random().toString(36).slice(2)}.png`); fs.copyFileSync(PNG, p); return p; };
const file = (p) => ({ path: p, originalname: "photo.png", mimetype: "image/png", size: fs.statSync(p).size, filename: path.basename(p) });
const deps = { uploadsDir, routeCache: () => null, homeFolderForUpload: async ({ kind }) => `files-${kind}`,
  io: { to: () => ({ emit: () => {} }) }, userRoom: (u) => `user:${u}` };

beforeEach(() => { db.modules.clear(); db.occurrences.clear(); db.views.clear(); });
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("local (Server) backend", () => {
  const b = makeLocalBackend({ uploadsDir });
  it("put moves into the month shard; open reads it, with a range; remove deletes", async () => {
    const p = tempCopy();
    const { ref } = await b.put({ tmpPath: p, name: path.basename(p) });
    expect(ref).toMatch(/^user\/\d{4}-\d{2}\//);
    expect(fs.existsSync(p)).toBe(false);
    const whole = await b.open(ref);
    expect(whole.size).toBe(fs.statSync(PNG).size);
    const part = await b.open(ref, { start: 0, end: 7 });
    const chunks = []; for await (const c of part.stream) chunks.push(c);
    expect(Buffer.concat(chunks)).toEqual(fs.readFileSync(PNG).subarray(0, 8));
    expect(b.urlFor(ref)).toBe(`/uploads/${ref}`);
    expect(await b.remove(ref)).toBe(true);
    expect(await b.open(ref)).toBeNull();
  });
  it("owns every pre-existing ref, never a URL or another backend's scheme", () => {
    expect(b.owns("user/2026-09/x.png")).toBe(true);
    expect(b.owns("kittens.jpg")).toBe(true);
    for (const r of ["https://a/b.png", "data:x", "blob:x", "gdrive:c:f", "//x/y", "", null]) expect(b.owns(r)).toBe(false);
  });
  it("a ref that climbs out of uploads is neither opened nor removed", async () => {
    expect(await b.open("../../etc/passwd")).toBeNull();
    expect(await b.remove("../secret")).toBe(false);
  });
});

describe("the uploader with ANOTHER backend (the seam Drive plugs into)", () => {
  const received = [];
  const remote = {
    id: "fake", owns: (r) => String(r).startsWith("fake:"), urlFor: (r) => `/files/${r}`,
    put: async ({ tmpPath, name }) => { received.push({ exists: fs.existsSync(tmpPath), name }); fs.unlinkSync(tmpPath); return { ref: `fake:${name}` }; },
  };
  const uploader = makeArtifactUploader({ ...deps, storage: { backendForUpload: async () => remote, backendForRef: (r) => (remote.owns(r) ? remote : null) } });

  it("hands the bytes to the backend, and STILL gets EXIF + thumbnails (read from the temp file first)", async () => {
    const out = await uploader.storeUploadedFile({ file: file(tempCopy()), userId: "u1", gridId: "g1" });
    expect(received.at(-1).exists).toBe(true);
    expect(out.fileRef).toMatch(/^fake:/);
    expect(out.url).toBe(`/files/${out.fileRef}`);
    expect(out.module.meta).toMatchObject({ width: 128, height: 128 });
    expect(fs.existsSync(path.join(uploadsDir, out.module.meta.thumb256))).toBe(true);   // thumbnails stay on the server
  });
  it("a re-upload of the same bytes dedups onto the remote file, with the remote URL", async () => {
    const first = await uploader.storeUploadedFile({ file: file(tempCopy()), userId: "u1", gridId: "g1" });
    const again = await uploader.storeUploadedFile({ file: file(tempCopy()), userId: "u1", gridId: "g1" });
    expect(again.dedup).toBe(true);
    expect(again.fileRef).toBe(first.fileRef);
    expect(again.url).toBe(`/files/${first.fileRef}`);
  });
});

describe("the paths that used to be hand-copied uploaders", () => {
  const uploader = makeArtifactUploader(deps);
  it("storeFileFromPath (connection import) COPIES the source and files a full artifact", async () => {
    const src = path.join(tmp, "source.png"); fs.copyFileSync(PNG, src);
    const out = await uploader.storeFileFromPath({ srcPath: src, originalName: "source.png", mimeType: "image/png", userId: "u1", gridId: "g1" });
    expect(fs.existsSync(src)).toBe(true);                                   // never moved
    expect(out.module).toMatchObject({ role: "artifact", kind: "image", label: "source.png" });
    expect(out.module.meta.sha256).toMatch(/^[0-9a-f]{64}$/);                 // dedup now applies
    expect(out.module.meta.thumb256).toBeTruthy();                            // and thumbnails
  });
  it("storeBareFile (image field value) stores through the backend and mints no records", async () => {
    const out = await uploader.storeBareFile({ file: file(tempCopy()), userId: "u1" });
    expect(out.fileRef).toMatch(/^user\/\d{4}-\d{2}\//);
    expect(out.url).toBe(`/uploads/${out.fileRef}`);
    expect(db.modules.size).toBe(0);
  });
});
