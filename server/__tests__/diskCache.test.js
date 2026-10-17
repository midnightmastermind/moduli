import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { withDiskCache, planEviction, cacheKey } from "../services/storage/diskCache.js";

const read = async (stream) => { const out = []; for await (const c of stream) out.push(c); return Buffer.concat(out).toString(); };

function fakeBackend(files) {
  const calls = [];
  return {
    type: "gdrive", calls,
    async open(ref, { start, end } = {}) {
      calls.push({ ref, start, end });
      const f = files[ref]; if (!f) return null;
      const s = start ?? 0; const e = end ?? f.body.length - 1;
      return { stream: Readable.from([Buffer.from(f.body.slice(s, e + 1))]), size: f.body.length, length: e - s + 1, mime: f.mime,
        contentRange: start != null ? `bytes ${s}-${e}/${f.body.length}` : null, status: start != null ? 206 : 200 };
    },
  };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "dcache-"));

describe("withDiskCache", () => {
  it("serves the first open from the backend, then later ranges from disk", async () => {
    const b = fakeBackend({ v: { body: "0123456789", mime: "video/mp4" } });
    const c = withDiskCache(b, { dir: tmp() });
    const first = await c.open("v", { start: 0, end: 3 });
    expect(await read(first.stream)).toBe("0123");
    await Promise.all([...c._filling.values()]);
    const callsAfterFill = b.calls.length;               // the range + one full background download
    expect(callsAfterFill).toBe(2);
    const again = await c.open("v", { start: 6, end: 9 });
    expect(await read(again.stream)).toBe("6789");
    expect(again.contentRange).toBe("bytes 6-9/10");
    expect(again.status).toBe(206);
    expect(b.calls.length).toBe(callsAfterFill);          // disk, not Drive
  });

  it("does not cache images or books", async () => {
    const b = fakeBackend({ p: { body: "abc", mime: "application/pdf" } });
    const c = withDiskCache(b, { dir: tmp() });
    await read((await c.open("p")).stream);
    expect(c._filling.size).toBe(0);
    await read((await c.open("p")).stream);
    expect(b.calls.length).toBe(2);
  });

  it("does not cache a file over maxFileBytes", async () => {
    const b = fakeBackend({ v: { body: "0123456789", mime: "audio/mpeg" } });
    const c = withDiskCache(b, { dir: tmp(), maxFileBytes: 5 });
    await read((await c.open("v")).stream);
    expect(c._filling.size).toBe(0);
  });

  it("evicts the least recently used copy past maxBytes", async () => {
    const dir = tmp(); let t = 0;
    const b = fakeBackend({ a: { body: "aaaa", mime: "audio/mpeg" }, b: { body: "bbbb", mime: "audio/mpeg" } });
    const c = withDiskCache(b, { dir, maxBytes: 6, now: () => ++t });
    await read((await c.open("a")).stream); await Promise.all([...c._filling.values()]);
    await read((await c.open("b")).stream); await Promise.all([...c._filling.values()]);
    expect(fs.existsSync(path.join(dir, `${cacheKey("a")}.bin`))).toBe(false);
    expect(fs.existsSync(path.join(dir, `${cacheKey("b")}.bin`))).toBe(true);
  });

  it("planEviction drops oldest first until it fits", () => {
    expect(planEviction([{ key: "x", size: 4, atime: 2 }, { key: "y", size: 4, atime: 1 }], 5)).toEqual(["y"]);
    expect(planEviction([{ key: "x", size: 4, atime: 2 }], 5)).toEqual([]);
  });
});
