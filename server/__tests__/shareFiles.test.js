// A shared file goes through the ONE uploader, and a re-share of the same
// bytes reuses the first share's row instead of filing it again (spec §7).
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const occs = new Map();
vi.mock("../models/Occurrence.js", () => ({ default: {
  findOne: (q) => ({ lean: async () => [...occs.values()].find(o =>
    o.userId === q.userId && o.gridId === q.gridId && o.meta?.source === q["meta.source"] &&
    o.meta?.externalId === q["meta.externalId"]) || null }),
  updateOne: async (q, u) => { const o = occs.get(q.id); if (o) Object.assign(o, u.$set); },
}}));
vi.mock("../models/Module.js", () => ({ default: {
  findOne: () => ({ lean: async () => ({ fileRef: "user/2026-09/first.png" }) }),
}}));
const { storeSharedFile } = await import("../services/shareFiles.js");
const { SHARE_MAX_BYTES, ARTIFACT_MAX_BYTES, describeTooLarge } = await import("../config/uploadLimits.js");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "moduli-share-"));
const temp = (bytes = "same bytes") => { const p = path.join(tmp, `${Math.random()}`); fs.writeFileSync(p, bytes); return { path: p, originalname: "a.png", mimetype: "image/png", size: 10 }; };
let uploads;
const storeUploadedFile = async ({ file, gridId }) => {
  uploads.push(file.path);
  const id = `occ${uploads.length}`;
  occs.set(id, { id, userId: "u1", gridId, meta: {} });
  return { occurrence: { id, meta: {} }, fileRef: `user/2026-09/${id}.png` };
};
beforeEach(() => { occs.clear(); uploads = []; });

describe("storeSharedFile", () => {
  it("uploads through the injected uploader and stamps the row as a share", async () => {
    const r = await storeSharedFile({ file: temp(), userId: "u1", gridId: "g1", storeUploadedFile });
    expect(uploads).toHaveLength(1);
    expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(occs.get(r.occurrenceId).meta).toEqual({ source: "share", externalId: `sha256:${r.sha256}` });
  });

  it("the SAME bytes shared again reuse the row and do not upload twice", async () => {
    const a = await storeSharedFile({ file: temp(), userId: "u1", gridId: "g1", storeUploadedFile });
    const f2 = temp();
    const b = await storeSharedFile({ file: f2, userId: "u1", gridId: "g1", storeUploadedFile });
    expect(uploads).toHaveLength(1);
    expect(b.reused).toBe(true);
    expect(b.occurrenceId).toBe(a.occurrenceId);
    expect(fs.existsSync(f2.path)).toBe(false);     // the temp copy is cleaned up
  });

  it("different bytes are a different share", async () => {
    await storeSharedFile({ file: temp("one"), userId: "u1", gridId: "g1", storeUploadedFile });
    await storeSharedFile({ file: temp("two"), userId: "u1", gridId: "g1", storeUploadedFile });
    expect(uploads).toHaveLength(2);
  });

  it("the same bytes on ANOTHER grid are that grid's own share", async () => {
    await storeSharedFile({ file: temp(), userId: "u1", gridId: "g1", storeUploadedFile });
    await storeSharedFile({ file: temp(), userId: "u1", gridId: "g2", storeUploadedFile });
    expect(uploads).toHaveLength(2);
  });
});

describe("upload limits (D14)", () => {
  it("shares take 500 MB; the artifact route keeps 50 MB", () => {
    expect(SHARE_MAX_BYTES).toBe(500 * 1024 * 1024);
    expect(ARTIFACT_MAX_BYTES).toBe(50 * 1024 * 1024);
  });
  it("a refusal names the size AND the limit", () => {
    const m = describeTooLarge(900 * 1024 * 1024);
    expect(m).toMatch(/900/);
    expect(m).toMatch(/500/);
  });
});
