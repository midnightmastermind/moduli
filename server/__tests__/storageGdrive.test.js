// Google Drive storage (plan 2026-09-24-connections-storage-gdrive, Tasks 4 + 5):
// the connect flow, the gdrive backend, the Server fallback, and the /files
// proxy — all against a fake Drive served through an injected fetch.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import express from "express";

process.env.SECRETS_KEY = crypto.randomBytes(32).toString("base64");
process.env.GOOGLE_CLIENT_ID = "cid";
process.env.GOOGLE_CLIENT_SECRET = "csecret";

const rows = new Map();
vi.mock("../models/Connection.js", () => ({ default: {
  findOne: (q) => ({ lean: async () => [...rows.values()].find(r =>
    Object.entries(q).every(([k, v]) => (k.includes(".") ? k.split(".").reduce((o, p) => o?.[p], r) : r[k]) === v)) || null }),
  create: async (doc) => { rows.set(doc.id, { ...doc }); return doc; },
  updateOne: async ({ id }, { $set }) => { const r = rows.get(id); if (r) Object.assign(r, $set); return { matchedCount: r ? 1 : 0 }; },
}}));
vi.mock("../models/User.js", () => ({ default: { findById: () => ({ lean: async () => null, catch: () => null }) } }));

const { makeGdriveBackend, DriveAuthError, parseDriveRef } = await import("../services/storage/gdrive.js");
const oauth = await import("../services/googleOAuth.js");
const { makeStorageRegistry } = await import("../services/storage/index.js");
const { serveStoredFile, parseRange } = await import("../services/storage/serveFile.js");
const { decryptCipherShape } = await import("../models/Secret.js");

// ── A fake Google: token endpoint + Drive v3 (files, folders, resumable upload, media) ──
function fakeGoogle({ refreshOk = true } = {}) {
  const files = new Map();          // id -> { name, parents, mime, bytes, folder, trashed }
  const log = [];
  let n = 0;
  const reply = (status, body, headers = {}) => new Response(
    body == null ? null : (typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body)),
    { status, headers });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || "GET";
    log.push(`${method} ${u.pathname}`);
    if (u.host === "oauth2.googleapis.com") {
      const p = new URLSearchParams(String(init.body));
      if (p.get("grant_type") === "authorization_code")
        return p.get("code") === "good" ? reply(200, { access_token: "AT", refresh_token: "RT-1", expires_in: 3600 }) : reply(400, { error: "invalid_grant" });
      return refreshOk && p.get("refresh_token") === "RT-1" ? reply(200, { access_token: "AT", expires_in: 3600 }) : reply(400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
    }
    if (u.host === "upload.example") {             // the resumable session URL
      const id = u.pathname.slice(1);
      const chunks = []; for await (const c of init.body) chunks.push(Buffer.from(c));
      files.get(id).bytes = Buffer.concat(chunks);
      return reply(200, { id });
    }
    const auth = init.headers?.Authorization;
    if (auth !== "Bearer AT") return reply(401, { error: "unauthenticated" });
    if (u.pathname === "/drive/v3/about") return reply(200, { user: { emailAddress: "me@example.com" } });
    if (u.pathname === "/upload/drive/v3/files" && method === "POST") {
      const meta = JSON.parse(init.body); const id = `F${++n}`;
      files.set(id, { ...meta, mime: init.headers["X-Upload-Content-Type"] });
      return reply(200, null, { location: `https://upload.example/${id}` });
    }
    if (u.pathname === "/drive/v3/files" && method === "POST") {
      const meta = JSON.parse(init.body); const id = `D${++n}`;
      files.set(id, { ...meta, folder: true }); return reply(200, { id });
    }
    if (u.pathname === "/drive/v3/files" && method === "GET") {
      const q = u.searchParams.get("q"); const name = /name='([^']+)'/.exec(q)[1]; const parent = /'([^']+)' in parents/.exec(q)[1];
      const hit = [...files.entries()].filter(([, f]) => f.folder && f.name === name && f.parents?.includes(parent)).map(([id]) => ({ id }));
      return reply(200, { files: hit });
    }
    const m = /^\/drive\/v3\/files\/([^/]+)$/.exec(u.pathname);
    if (m) {
      const f = files.get(decodeURIComponent(m[1]));
      if (!f) return reply(404, { error: "notFound" });
      if (method === "DELETE") { files.delete(m[1]); return reply(204, null); }
      if (u.searchParams.get("alt") === "media") {
        const r = /bytes=(\d+)-(\d*)/.exec(init.headers?.Range || "");
        if (r) {
          const s = Number(r[1]), e = r[2] ? Number(r[2]) : f.bytes.length - 1;
          return reply(206, f.bytes.subarray(s, e + 1), { "content-range": `bytes ${s}-${e}/${f.bytes.length}`, "content-length": String(e - s + 1), "content-type": f.mime });
        }
        return reply(200, f.bytes, { "content-length": String(f.bytes.length), "content-type": f.mime });
      }
      return reply(200, { id: m[1], trashed: !!f.trashed });
    }
    return reply(500, { error: `unhandled ${method} ${u.pathname}` });
  };
  // Pre-create the app's upload folder, as the connect flow does.
  files.set("ROOT", { name: "Moduli uploads", folder: true });
  return { fetchImpl, files, log };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gdrive-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const tmpFile = (content = "hello drive") => { const p = path.join(tmp, `t-${crypto.randomUUID()}.txt`); fs.writeFileSync(p, content); return p; };
const conn = (extra = {}) => ({ id: "c1", type: "gdrive", name: "Drive", config: { folderId: "ROOT" }, status: "ok", ...extra });

beforeEach(() => rows.clear());

describe("gdrive backend", () => {
  it("stores a file in the month folder under its ORIGINAL name, deletes the temp file, returns a gdrive ref", async () => {
    const g = fakeGoogle();
    const b = makeGdriveBackend({ connection: conn(), refreshToken: "RT-1", fetchImpl: g.fetchImpl });
    const p = tmpFile("bytes!");
    const { ref } = await b.put({ tmpPath: p, name: "171-abc.txt", originalName: "notes.txt", mime: "text/plain", size: 6 });
    const { connectionId, fileId } = parseDriveRef(ref);
    expect(connectionId).toBe("c1");
    const stored = g.files.get(fileId);
    expect(stored.name).toBe("notes.txt");
    expect(g.files.get(stored.parents[0])).toMatchObject({ folder: true, parents: ["ROOT"] });
    expect(stored.bytes.toString()).toBe("bytes!");
    expect(fs.existsSync(p)).toBe(false);
    expect(b.owns(ref)).toBe(true);
    expect(b.urlFor(ref)).toBe(`/files/c1/${fileId}`);
  });

  it("reuses the month folder and the access token across uploads", async () => {
    const g = fakeGoogle();
    const b = makeGdriveBackend({ connection: conn(), refreshToken: "RT-1", fetchImpl: g.fetchImpl });
    await b.put({ tmpPath: tmpFile(), name: "a.txt", mime: "text/plain" });
    await b.put({ tmpPath: tmpFile(), name: "b.txt", mime: "text/plain" });
    expect(g.log.filter(l => l.includes("/token")).length).toBe(1);
    expect([...g.files.values()].filter(f => f.folder && f.parents?.includes("ROOT")).length).toBe(1);
  });

  it("a failed upload leaves the temp file in place (so the Server can take it)", async () => {
    const g = fakeGoogle({ refreshOk: false });
    const statuses = [];
    const b = makeGdriveBackend({ connection: conn(), refreshToken: "RT-1", fetchImpl: g.fetchImpl, onStatus: async (s) => statuses.push(s) });
    const p = tmpFile();
    await expect(b.put({ tmpPath: p, name: "x.txt" })).rejects.toBeInstanceOf(DriveAuthError);
    expect(fs.existsSync(p)).toBe(true);
    expect(statuses).toContain("needs_reconnect");
  });

  it("opens a byte range (206) and reports a missing file as null", async () => {
    const g = fakeGoogle();
    const b = makeGdriveBackend({ connection: conn(), refreshToken: "RT-1", fetchImpl: g.fetchImpl });
    const { ref } = await b.put({ tmpPath: tmpFile("0123456789"), name: "n.txt", mime: "text/plain" });
    const f = await b.open(ref, { start: 2, end: 5 });
    const chunks = []; for await (const c of f.stream) chunks.push(c);
    expect(Buffer.concat(chunks).toString()).toBe("2345");
    expect(f).toMatchObject({ status: 206, size: 10, contentRange: "bytes 2-5/10" });
    expect(await b.open("gdrive:c1:NOPE")).toBeNull();
    expect(await b.open("gdrive:other:F1")).toBeNull();     // another connection's ref
  });

  it("remove deletes from Drive; health is ok for a live folder and flags a revoked token", async () => {
    const g = fakeGoogle();
    const b = makeGdriveBackend({ connection: conn(), refreshToken: "RT-1", fetchImpl: g.fetchImpl });
    const { ref } = await b.put({ tmpPath: tmpFile(), name: "r.txt" });
    expect(await b.remove(ref)).toBe(true);
    expect(await b.remove(ref)).toBe(false);
    expect(await b.health()).toMatchObject({ ok: true });
    const dead = makeGdriveBackend({ connection: conn(), refreshToken: "RT-revoked", fetchImpl: g.fetchImpl });
    expect(await dead.health()).toMatchObject({ ok: false, needsReconnect: true });
  });
});

describe("the registry never loses an upload (plan decision 1)", () => {
  it("falls back to the Server when the default Drive put fails, and says why", async () => {
    const uploadsDir = fs.mkdtempSync(path.join(tmp, "up-"));
    const g = fakeGoogle({ refreshOk: false });
    const reg = makeStorageRegistry({
      uploadsDir,
      factories: { gdrive: async (c) => makeGdriveBackend({ connection: c, refreshToken: "RT-1", fetchImpl: g.fetchImpl }) },
      getDefaultConnection: async () => conn(),
    });
    const p = tmpFile("keep me");
    const name = path.basename(p);
    const out = await reg.putForUser("u1", { tmpPath: p, name, originalName: "keep.txt" });
    expect(out.backend).toBe(reg.server);
    expect(out.fallback).toMatchObject({ connectionId: "c1", needsReconnect: true });
    expect(fs.readFileSync(path.join(uploadsDir, out.ref), "utf8")).toBe("keep me");
  });

  it("stores on Drive when it works, and the ref resolves back to that backend", async () => {
    const g = fakeGoogle();
    const reg = makeStorageRegistry({
      uploadsDir: tmp,
      factories: { gdrive: async (c) => makeGdriveBackend({ connection: c, refreshToken: "RT-1", fetchImpl: g.fetchImpl }) },
      getDefaultConnection: async () => conn(),
      getConnectionById: async (id) => (id === "c1" ? conn() : null),
    });
    const out = await reg.putForUser("u1", { tmpPath: tmpFile(), name: "d.txt" });
    expect(out.fallback).toBeNull();
    expect(out.ref).toMatch(/^gdrive:c1:/);
    expect(reg.backendForRef(out.ref)).toBe(out.backend);
    expect(await reg.backendForConnectionId("c1")).toBe(out.backend);   // same built backend, token cache kept
    expect(await reg.backendForConnectionId("nope")).toBeNull();
  });
});

describe("Google connect flow", () => {
  it("asks for drive.file only, offline, with consent, and a state that names the user", () => {
    const url = new URL(oauth.startUrl("u1", { redirectUri: "https://x/cb" }));
    expect(url.searchParams.get("scope")).toBe(oauth.DRIVE_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(oauth.readState(url.searchParams.get("state"))).toMatchObject({ userId: "u1" });
    expect(oauth.readState("garbage")).toBeNull();
  });

  it("creates the connection with an ENCRYPTED refresh token and the app's upload folder", async () => {
    const g = fakeGoogle();
    const state = new URL(oauth.startUrl("u1", { redirectUri: "r" })).searchParams.get("state");
    const c = await oauth.completeConnect({ code: "good", state, redirectUri: "r", fetchImpl: g.fetchImpl, newId: () => "c9" });
    const row = rows.get("c9");
    expect(row).toMatchObject({ userId: "u1", type: "gdrive", status: "ok", config: { accountEmail: "me@example.com" } });
    expect(JSON.stringify(row)).not.toContain("RT-1");
    expect(decryptCipherShape(row.credentials)).toBe("RT-1");
    expect(g.files.get(row.config.folderId)).toMatchObject({ name: oauth.UPLOAD_FOLDER_NAME, folder: true });
    expect(c.reconnected).toBe(false);
  });

  it("reconnecting the same Google account keeps the connection id (so stored refs keep loading)", async () => {
    const g = fakeGoogle();
    const state = () => new URL(oauth.startUrl("u1", { redirectUri: "r" })).searchParams.get("state");
    await oauth.completeConnect({ code: "good", state: state(), redirectUri: "r", fetchImpl: g.fetchImpl, newId: () => "c9" });
    const folder = rows.get("c9").config.folderId;
    rows.get("c9").status = "needs_reconnect";
    const again = await oauth.completeConnect({ code: "good", state: state(), redirectUri: "r", fetchImpl: g.fetchImpl, newId: () => "SHOULD-NOT-BE-USED" });
    expect(again.reconnected).toBe(true);
    expect(rows.size).toBe(1);
    expect(rows.get("c9")).toMatchObject({ status: "ok", config: { folderId: folder } });
  });

  it("refuses a forged or expired state and a spent code", async () => {
    const g = fakeGoogle();
    await expect(oauth.completeConnect({ code: "good", state: "nope", redirectUri: "r", fetchImpl: g.fetchImpl })).rejects.toMatchObject({ status: 400 });
    const state = new URL(oauth.startUrl("u1", { redirectUri: "r" })).searchParams.get("state");
    await expect(oauth.completeConnect({ code: "bad", state, redirectUri: "r", fetchImpl: g.fetchImpl })).rejects.toBeInstanceOf(oauth.GoogleAuthError);
    expect(rows.size).toBe(0);
  });
});

describe("/files proxy", () => {
  it("parses ranges", () => {
    expect(parseRange(undefined)).toBeNull();
    expect(parseRange("bytes=0-")).toEqual({ start: 0, end: null });
    expect(parseRange("bytes=5-2")).toBe("invalid");
    expect(parseRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });

  it("streams a Drive file with Range, ETag and a private long cache; 304 on revalidation; 404 when gone", async () => {
    const g = fakeGoogle();
    const b = makeGdriveBackend({ connection: conn(), refreshToken: "RT-1", fetchImpl: g.fetchImpl });
    const { ref } = await b.put({ tmpPath: tmpFile("abcdefghij"), name: "v.txt", mime: "text/plain" });
    const { fileId } = parseDriveRef(ref);
    const app = express();
    app.get("/files/:c/:f", (req, res) => serveStoredFile(req, res, b, `gdrive:${req.params.c}:${req.params.f}`));
    const server = http.createServer(app).listen(0);
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const whole = await fetch(`${base}/files/c1/${fileId}`);
      expect(whole.status).toBe(200);
      expect(await whole.text()).toBe("abcdefghij");
      expect(whole.headers.get("cache-control")).toMatch(/private/);
      const part = await fetch(`${base}/files/c1/${fileId}`, { headers: { Range: "bytes=3-5" } });
      expect(part.status).toBe(206);
      expect(part.headers.get("content-range")).toBe("bytes 3-5/10");
      expect(await part.text()).toBe("def");
      const again = await fetch(`${base}/files/c1/${fileId}`, { headers: { "If-None-Match": whole.headers.get("etag") } });
      expect(again.status).toBe(304);
      expect((await fetch(`${base}/files/c1/GONE`)).status).toBe(404);
    } finally { server.close(); }
  });
});
