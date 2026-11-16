import { describe, it, expect } from "vitest";
import { shapeResults, webSearch, readingText, readPage } from "../services/webTools.js";

describe("Jonah's web lookups", () => {
  it("search results: one per address, http only, trimmed", () => {
    const out = shapeResults({ results: [
      { title: " Canberra - Wikipedia ", url: "https://en.wikipedia.org/wiki/Canberra", content: "Canberra is the capital\n of Australia." },
      { title: "dup", url: "https://en.wikipedia.org/wiki/Canberra", content: "x" },
      { title: "bad", url: "javascript:alert(1)", content: "x" },
      { title: "Visit", url: "https://visitcanberra.com.au/", content: "" },
    ] });
    expect(out).toEqual([
      { title: "Canberra - Wikipedia", url: "https://en.wikipedia.org/wiki/Canberra", snippet: "Canberra is the capital of Australia." },
      { title: "Visit", url: "https://visitcanberra.com.au/", snippet: "" },
    ]);
  });
  it("asks SearXNG for JSON and says why when it cannot", async () => {
    let asked = "";
    const ok = await webSearch("capital of australia", { base: "http://s", fetchImpl: async (u) => { asked = u; return { ok: true, json: async () => ({ results: [] }) }; } });
    expect(asked).toBe("http://s/search?q=capital%20of%20australia&format=json&safesearch=0");
    expect(ok).toMatchObject({ ok: true, results: [], note: "no results" });
    expect(await webSearch("x", { fetchImpl: async () => ({ ok: false, status: 429 }) })).toMatchObject({ ok: false, error: "the search answered 429" });
    expect(await webSearch("x", { fetchImpl: async () => { throw new Error("ECONNREFUSED"); } })).toMatchObject({ ok: false, error: expect.stringMatching(/not reachable/) });
    expect(await webSearch("  ")).toMatchObject({ ok: false });
  });
  it("a page is read as plain text, capped at a word", () => {
    expect(readingText("# Title\n\n![pic](a.png)\nSee [the city](https://x) **now**.")).toEqual({ text: "Title\n\nSee the city now.", cut: false });
    const long = readingText("word ".repeat(100), 22);
    expect(long.cut).toBe(true);
    expect(long.text).toBe("word word word word …");
  });
  it("a page the guarded fetch refuses is reported, not read", async () => {
    const r = await readPage("http://169.254.169.254/", { fetchPage: async () => ({ ok: false, reason: "that address is not allowed" }) });
    expect(r).toEqual({ ok: false, url: "http://169.254.169.254/", error: "that address is not allowed" });
    const good = await readPage("https://x", { fetchPage: async () => ({ ok: true, html: "<html><body><main><p>" + "Canberra is the capital. ".repeat(20) + "</p></main></body></html>" }) });
    expect(good.ok).toBe(true);
    expect(good.text).toMatch(/^Canberra is the capital\./);
  });
});
