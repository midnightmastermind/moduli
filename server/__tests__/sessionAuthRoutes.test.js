// Audit A2/A3 (plan 2026-09-24-connections-storage-gdrive): the upload,
// image, connection and import routes authenticate the SESSION and ignore a
// body userId; a connection import cannot leave its folder.
import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("../models/Grid.js", () => ({ default: {
  exists: async (q) => (String(q._id) === "64b000000000000000000001" && q.userId === "u1" ? { _id: q._id } : null),
}}));
const { resolveInside } = await import("../utils/safePath.js");
const { requireSession, sessionUserId, ownsGrid } = await import("../middleware/sessionAuth.js");
const { signToken } = await import("../utils/jwts.js");

const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; return r; };

describe("resolveInside", () => {
  it("keeps a plain name inside the folder", () => {
    expect(resolveInside("/srv/files", "a.png")).toBe(path.resolve("/srv/files/a.png"));
    expect(resolveInside("/srv/files", "sub/a.png")).toBe(path.resolve("/srv/files/sub/a.png"));
  });
  it("refuses everything that leaves it", () => {
    for (const bad of ["../../etc/passwd", "/etc/passwd", "sub/../../x", "..", ".", "", "a\0b", "../files2/x"]) {
      expect(resolveInside("/srv/files", bad)).toBeNull();
    }
  });
});

describe("requireSession", () => {
  it("401 without a session, and does not call next", () => {
    const next = vi.fn(); const r = res();
    requireSession({ headers: {}, body: { userId: "u1" } }, r, next);
    expect(r.code).toBe(401); expect(next).not.toHaveBeenCalled();
  });
  it("401 on a forged token", () => {
    const next = vi.fn(); const r = res();
    requireSession({ headers: { authorization: "Bearer not-a-jwt" } }, r, next);
    expect(r.code).toBe(401);
  });
  it("the user is the SESSION's, never the body's", () => {
    const next = vi.fn(); const req = { headers: { authorization: `Bearer ${signToken({ userId: "u1" })}` }, body: { userId: "someone-else" } };
    requireSession(req, res(), next);
    expect(next).toHaveBeenCalled();
    expect(req.userId).toBe("u1");
    expect(sessionUserId(req)).toBe("u1");
  });
  it("ownsGrid: own grid yes, another's or garbage no, absent = nothing to check", async () => {
    expect(await ownsGrid("u1", "64b000000000000000000001")).toBe(true);
    expect(await ownsGrid("u2", "64b000000000000000000001")).toBe(false);
    expect(await ownsGrid("u1", "not-an-id")).toBe(false);
    expect(await ownsGrid("u1", null)).toBe(true);
  });
});

describe("server.js wiring", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../server.js"), "utf8");
  const routeLine = (r) => src.split("\n").find((l) => l.includes(`"${r}"`) && /app\.(get|post)\(/.test(l)) || "";
  it("every audited route authenticates, and BEFORE multer on uploads", () => {
    for (const r of ["/api/artifacts/upload", "/api/images/upload", "/api/connections/google/start",
                     "/api/connections/:id/health", "/api/research/wikipedia/import"]) {
      expect(routeLine(r), r).toMatch(/requireSession/);
    }
    for (const r of ["/api/artifacts/upload", "/api/images/upload"]) {
      const l = routeLine(r);
      expect(l.indexOf("requireSession"), r).toBeLessThan(l.indexOf("upload.single"));
    }
  });
  it("no audited route reads userId from the body any more; the dead storage-settings route is gone", () => {
    expect(src).not.toMatch(/const \{[^}]*\buserId\b[^}]*\} = req\.body/);
    expect(src).not.toMatch(/app\.post\("\/api\/storage-settings"/);
    // The folder-connection routes (the audit-A3 traversal surface) are gone entirely.
    expect(src).not.toMatch(/app\.(get|post)\("\/api\/connections\/:id\/(files|import)"/);
  });
});
