import { describe, it, expect, vi } from "vitest";
vi.mock("../models/Occurrence.js", () => ({ default: {} }));
const { importDedupeKey, runDeduped } = await import("../utils/importDedupe.js");

const base = { userId: "u", gridId: "g", parentId: "p", shape: "magic", title: "The Daily Stoic", content: "# Oct 26\ntext" };

describe("an operation's import of the same thing into the same place happens once", () => {
  it("three runs at once make one import", async () => {
    const key = importDedupeKey(base);
    let made = 0;
    const work = async () => { made++; await new Promise((r) => setTimeout(r, 20)); return { ok: true, rootOccurrenceId: "root1" }; };
    const find = async () => null;
    const outs = await Promise.all([1, 2, 3].map(() => runDeduped(key, base, work, { find })));
    expect(made).toBe(1);
    expect(outs.map((o) => o.rootOccurrenceId)).toEqual(["root1", "root1", "root1"]);
  });
  it("a later run reuses the root the first one left", async () => {
    let made = 0;
    const out = await runDeduped(importDedupeKey(base), base, async () => { made++; return { ok: true, rootOccurrenceId: "x" }; }, { find: async () => "root1" });
    expect(made).toBe(0);
    expect(out).toMatchObject({ ok: true, rootOccurrenceId: "root1", reused: true });
  });
  it("different books (or another place) are different imports", () => {
    expect(importDedupeKey(base)).not.toBe(importDedupeKey({ ...base, title: "The Tao Te Ching" }));
    expect(importDedupeKey(base)).not.toBe(importDedupeKey({ ...base, parentId: "q" }));
    expect(importDedupeKey(base)).toBe(importDedupeKey({ ...base }));
  });
});
