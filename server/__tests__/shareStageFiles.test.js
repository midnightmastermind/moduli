// A shared FILE reaches the placement window like a link does (user,
// 2026-09-30: "i dont want anything going through auto unless i express that in
// the dropdown (so images, other things, etc, not just links)").
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import multer from "multer";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../models/ApiToken.js", () => ({ default: {
  authenticate: async (raw) => (raw === "good-token" ? { userId: "u1", scopes: ["read", "write"], tokenId: "t" } : null),
}}));
const stages = new Map();
vi.mock("../services/shareStage.js", () => ({
  STAGE_TTL_MS: 600000,
  createStage: async ({ userId, payload }) => { stages.set("s1", { userId, payload }); return { stageId: "s1", key: "k1" }; },
  readStage: async (id, key) => (key === "k1" ? stages.get(id)?.payload ?? null : null),
  consumeStage: async () => null,
}));

const { makeApiV1Router } = await import("../routes/apiV1.js");
const { parkStagedFile, publicStagePayload, stagedFileForShare, sweepStagedFiles, STAGE_FILES_DIR } = await import("../services/shareStageFiles.js");
const { shareTypeOfPayload } = await import("../services/shareRules.js");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "stagefile-"));
let server, base;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const shareUpload = multer({ storage: multer.diskStorage({ destination: TMP, filename: (_r, f, cb) => cb(null, `up-${Date.now()}${path.extname(f.originalname)}`) }) });
  app.use("/api/v1", makeApiV1Router({
    getUserCache: async () => ({}), peekUserCache: () => null, io: null, userRoom: (u) => `user:${u}`, shareUpload,
  }));
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});
afterAll(() => {
  server?.close();
  for (const s of stages.values()) { try { fs.unlinkSync(s.payload.file.path); } catch { /* */ } }
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe("staging a file", () => {
  it("a multipart share with a photo is staged, its bytes parked outside uploads/", async () => {
    const form = new FormData();
    form.append("title", "cat");
    form.append("files", new Blob([Buffer.from("PNGDATA")], { type: "image/png" }), "cat.png");
    const r = await fetch(`${base}/share/stage`, { method: "POST", headers: { authorization: "Bearer good-token" }, body: form });
    expect(r.status).toBe(201);
    const file = stages.get("s1").payload.file;
    expect(file).toMatchObject({ originalname: "cat.png", mimetype: "image/png" });
    expect(path.dirname(file.path)).toBe(STAGE_FILES_DIR);
    expect(fs.readFileSync(file.path, "utf8")).toBe("PNGDATA");
  });

  it("the window's read never shows the server path, and the file is served by key", async () => {
    const r = await fetch(`${base}/share/stage/s1?k=k1`);
    const { payload } = await r.json();
    expect(payload.file.originalname).toBe("cat.png");
    expect(payload.file.path).toBeUndefined();
    const f = await fetch(`${base}/share/stage/s1/file?k=k1`);
    expect(f.status).toBe(200);
    expect(f.headers.get("content-type")).toBe("image/png");
    expect(await f.text()).toBe("PNGDATA");
    // The control: a wrong key gets nothing.
    expect((await fetch(`${base}/share/stage/s1/file?k=nope`)).status).toBe(404);
  });

  it("the window names the share as an IMAGE, not as text", () => {
    expect(shareTypeOfPayload({ file: { originalname: "cat.png", mimetype: "image/png" } })).toBe("image");
  });
});

describe("the parked file's helpers", () => {
  it("publicStagePayload strips only the path", () => {
    expect(publicStagePayload({ url: "u", file: { path: "/x", originalname: "a" } })).toEqual({ url: "u", file: { originalname: "a" } });
    expect(publicStagePayload({ url: "u" })).toEqual({ url: "u" });
  });

  it("stagedFileForShare is null once the file is gone", () => {
    expect(stagedFileForShare({ file: { path: path.join(TMP, "nope") } })).toBe(null);
  });

  it("the sweep removes files older than any live stage, keeps fresh ones", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweep-"));
    const old = path.join(dir, "old"), fresh = path.join(dir, "fresh");
    fs.writeFileSync(old, "x"); fs.writeFileSync(fresh, "y");
    const past = (Date.now() - 60 * 60 * 1000) / 1000;
    fs.utimesSync(old, past, past);
    expect(sweepStagedFiles({ dir })).toBe(1);
    expect(fs.existsSync(fresh)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("parkStagedFile moves the upload", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "park-"));
    const src = path.join(TMP, "p.txt"); fs.writeFileSync(src, "z");
    const d = parkStagedFile({ path: src, filename: "p.txt", originalname: "p.txt", mimetype: "text/plain", size: 1 }, { dir });
    expect(fs.existsSync(src)).toBe(false);
    expect(fs.readFileSync(d.path, "utf8")).toBe("z");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
