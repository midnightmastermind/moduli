// POST /api/v1/share over REAL HTTP with a REAL multipart body: express, the
// real auth/rate-limit/idempotency middleware and real multer writing to a temp
// dir. What only this can show: that a file actually arrives through multer and
// reaches the uploader, and that a request with a bad token is refused BEFORE
// its file is written to disk.
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import multer from "multer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../models/ApiToken.js", () => ({ default: {
  authenticate: async (raw) => (raw === "good-token" ? { userId: "u1", scopes: ["read", "write"], tokenId: "t" } : null),
}}));
vi.mock("../models/Grid.js", () => ({ default: {
  exists: async (q) => (q._id === "g1" && q.userId === "u1" ? { _id: "g1" } : null),
  findOneAndUpdate: () => ({ lean: async () => ({ shareLog: [] }) }),
}}));
vi.mock("../models/User.js", () => ({ default: { findById: () => ({ lean: async () => null }) } }));
vi.mock("../models/Occurrence.js", () => ({ default: { findOne: () => ({ lean: async () => null }), updateOne: async () => ({}) } }));
vi.mock("../models/Module.js", () => ({ default: { findOne: () => ({ lean: async () => null }) } }));
vi.mock("../utils/shareRulesEnsure.js", () => ({ ensureCatchAllRule: async () => ({ created: false }) }));
const seen = [];
vi.mock("../services/shareRules.js", () => ({
  runShareRules: async ({ share }) => { seen.push(share); return { ran: [], halted: false }; },
}));

const { makeApiV1Router } = await import("../routes/apiV1.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "share-http-"));
const stored = [];
let server, base;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const storage = multer.diskStorage({ destination: tmp, filename: (_r, f, cb) => cb(null, `${Date.now()}-${f.originalname}`) });
  app.use("/api/v1", makeApiV1Router({
    getUserCache: async () => ({}), peekUserCache: () => null,
    io: { to: () => ({ emit: () => {} }) }, userRoom: (u) => `user:${u}`, opRunBridge: {},
    shareUpload: multer({ storage, limits: { fileSize: 1024 } }),   // a tiny cap, to exercise the refusal
    storeUploadedFile: async ({ file }) => {
      stored.push({ name: file.originalname, bytes: fs.readFileSync(file.path, "utf8") });
      return { occurrence: { id: "file-occ", meta: {} }, fileRef: "user/2026-09/x" };
    },
  }));
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => { server?.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

const form = (fields, files = []) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const [name, content, type] of files) fd.append("files", new Blob([content], { type }), name);
  return fd;
};

describe("POST /api/v1/share over HTTP", () => {
  it("a multipart photo arrives, is stored, and reaches the rules as an image", async () => {
    const res = await fetch(`${base}/share`, { method: "POST",
      headers: { authorization: "Bearer good-token" },
      body: form({ gridId: "g1", source: "android" }, [["cat.jpg", "meow", "image/jpeg"]]) });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(stored).toEqual([{ name: "cat.jpg", bytes: "meow" }]);
    expect(body.fileOccurrenceId).toBe("file-occ");
    expect(seen.at(-1).type).toBe("image");
    expect(seen.at(-1).source).toBe("android");
  });

  it("a BAD token is refused before the file is written anywhere", async () => {
    const before = fs.readdirSync(tmp).length;
    const res = await fetch(`${base}/share`, { method: "POST",
      headers: { authorization: "Bearer nope" },
      body: form({ gridId: "g1" }, [["secret.jpg", "x", "image/jpeg"]]) });
    expect(res.status).toBe(401);
    expect(fs.readdirSync(tmp).length).toBe(before);
  });

  it("a file over the cap is refused with 413, naming the limit", async () => {
    const res = await fetch(`${base}/share`, { method: "POST",
      headers: { authorization: "Bearer good-token" },
      body: form({ gridId: "g1" }, [["big.mov", "x".repeat(4096), "video/quicktime"]]) });
    expect(res.status).toBe(413);
    expect((await res.json()).message).toMatch(/limit/);
  });

  it("a JSON link share still works beside it", async () => {
    const res = await fetch(`${base}/share`, { method: "POST",
      headers: { authorization: "Bearer good-token", "content-type": "application/json" },
      body: JSON.stringify({ gridId: "g1", text: "hello there" }) });
    expect(res.status).toBe(201);
    expect(seen.at(-1).type).toBe("text");
  });
});
