// Planning the cover pass. The three things worth pinning are the ones that
// decide whether 437 outbound requests are spent well: what gets fetched at
// all, in what order, and when to stop.
import { describe, it, expect } from "vitest";
import { hostOf, interleaveByHost, planCoverPass, shouldAbortEarly } from "../utils/coverPass.js";

const plan = (rows) => planCoverPass(rows, { coverOf: (r) => r.cover, urlOf: (r) => r.url });

describe("hostOf", () => {
  it("lowercases the host and ignores the path", () => {
    expect(hostOf("https://EN.wikipedia.org/wiki/X?a=1")).toBe("en.wikipedia.org");
  });
  it("is empty for junk, so junk groups together instead of throwing", () => {
    expect(hostOf("not a url")).toBe("");
    expect(hostOf(null)).toBe("");
  });
});

describe("interleaveByHost", () => {
  it("round-robins across hosts so a pool never doubles up on one site", () => {
    const rows = [
      { url: "https://a.com/1" }, { url: "https://a.com/2" }, { url: "https://a.com/3" },
      { url: "https://b.com/1" }, { url: "https://c.com/1" },
    ];
    expect(interleaveByHost(rows).map(r => r.url)).toEqual([
      "https://a.com/1", "https://b.com/1", "https://c.com/1",
      "https://a.com/2", "https://a.com/3",
    ]);
  });

  it("loses nothing — every row comes out exactly once", () => {
    // The control that matters: an interleave that drops rows would look fine
    // in the order assertion above and quietly skip bookmarks.
    const rows = Array.from({ length: 50 }, (_, i) => ({ url: `https://h${i % 7}.com/${i}` }));
    const out = interleaveByHost(rows);
    expect(out).toHaveLength(50);
    expect(new Set(out.map(r => r.url)).size).toBe(50);
  });

  it("is STABLE — the same input yields the same order, so a re-run resumes the same walk", () => {
    const rows = [{ url: "https://b.com/1" }, { url: "https://a.com/1" }, { url: "https://b.com/2" }];
    expect(interleaveByHost(rows)).toEqual(interleaveByHost(rows));
    // and first-seen host order is kept, not sorted
    expect(interleaveByHost(rows).map(r => r.url)[0]).toBe("https://b.com/1");
  });

  it("handles a single host and an empty list", () => {
    expect(interleaveByHost([{ url: "https://a.com/1" }]).map(r => r.url)).toEqual(["https://a.com/1"]);
    expect(interleaveByHost([])).toEqual([]);
  });
});

describe("planCoverPass", () => {
  const rows = [
    { id: "has",  cover: "https://cdn/a.png", url: "https://a.com/1" },
    { id: "need", cover: "",                  url: "https://b.com/1" },
    { id: "blank",cover: "   ",               url: "https://c.com/1" },
    { id: "nourl",cover: "",                  url: "" },
  ];

  it("NEVER re-fetches a row that already has a cover", () => {
    // This is what makes the pass resumable and what stops it overwriting a
    // cover a person set by hand.
    const p = plan(rows);
    expect(p.covered.map(c => c.row.id)).toEqual(["has"]);
    expect(p.needsFetch.map(e => e.row.id).sort()).toEqual(["blank", "need"]);
  });

  it("treats a whitespace-only cover as absent", () => {
    expect(plan(rows).needsFetch.some(e => e.row.id === "blank")).toBe(true);
  });

  it("counts a row with no URL rather than silently dropping it", () => {
    // The totals have to add up to the input, or "437 done" means nothing.
    const p = plan(rows);
    expect(p.unfetchable.map(r => r.id)).toEqual(["nourl"]);
    expect(p.covered.length + p.needsFetch.length + p.unfetchable.length).toBe(rows.length);
  });

  it("returns the fetch list already interleaved", () => {
    const many = [
      { id: 1, cover: "", url: "https://a.com/1" }, { id: 2, cover: "", url: "https://a.com/2" },
      { id: 3, cover: "", url: "https://b.com/1" },
    ];
    expect(plan(many).needsFetch.map(e => e.row.id)).toEqual([1, 3, 2]);
  });
});

describe("shouldAbortEarly", () => {
  it("does NOT abort on ordinary dead links", () => {
    // A five-year-old export has dead bookmarks. Half of them failing is a fact
    // about the web, not a reason to stop.
    expect(shouldAbortEarly(20, 10)).toBe(false);
    expect(shouldAbortEarly(100, 60)).toBe(false);
  });
  it("aborts when EVERY one of the first 20 failed — that is no network", () => {
    expect(shouldAbortEarly(20, 20)).toBe(true);
  });
  it("waits for the full probe before judging", () => {
    // Three-for-three is a coincidence; twenty-for-twenty is not.
    expect(shouldAbortEarly(3, 3)).toBe(false);
  });
});
