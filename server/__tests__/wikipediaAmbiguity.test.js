import { describe, it, expect, vi, afterEach } from "vitest";
import { optionsFromLinksResponse, summary } from "../services/wikipediaTools.js";

const linksJson = { query: { pages: [
  { ns: 0, title: "Pomodoro Technique", index: 6, description: "Time management method" },
  { ns: 0, title: "Arnaldo Pomodoro", index: 1, description: "Italian sculptor" },
  { ns: 0, title: "Pomodoro (disambiguation)", index: 2, pageprops: { disambiguation: "" } },
  { ns: 0, title: "Missing page", index: 3, missing: true },
  { ns: 14, title: "Category:Tomatoes", index: 4 },
] } };

afterEach(() => { vi.unstubAllGlobals(); });

describe("disambiguation choices", () => {
  it("lists real articles in the page's order, with descriptions", () => {
    expect(optionsFromLinksResponse(linksJson)).toEqual([
      { title: "Arnaldo Pomodoro", description: "Italian sculptor" },
      { title: "Pomodoro Technique", description: "Time management method" },
    ]);
  });
  it("caps the list", () => {
    expect(optionsFromLinksResponse(linksJson, 1)).toHaveLength(1);
  });
  it("an empty response is no choices, not a throw", () => {
    expect(optionsFromLinksResponse({})).toEqual([]);
  });
});

describe("summary of an ambiguous title", () => {
  it("returns the choices instead of the disambiguation page's text", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => ({
      ok: true, status: 200,
      json: async () => (String(url).includes("rest_v1")
        ? { type: "disambiguation", title: "Pomodoro", extract: "Pomodoro may refer to:" }
        : linksJson),
    })));
    const r = await summary("Pomodoro");
    expect(r.ambiguous).toBe(true);
    expect(r.title).toBe("Pomodoro");
    expect(r.options.map((o) => o.title)).toEqual(["Arnaldo Pomodoro", "Pomodoro Technique"]);
    expect(r.extract).toBeUndefined();
  });
  it("a normal article is answered as before", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ type: "standard", title: "Pomodoro Technique", extract: "A method." }),
    })));
    const r = await summary("Pomodoro Technique");
    expect(r.ambiguous).toBeUndefined();
    expect(r.extract).toBe("A method.");
  });
});

describe("ordering without positions", () => {
  it("falls back to alphabetical", () => {
    const j = { query: { pages: [{ ns: 0, title: "Tomato" }, { ns: 0, title: "Arnaldo Pomodoro" }, { ns: 0, title: "Pomodoro Technique" }] } };
    expect(optionsFromLinksResponse(j).map((o) => o.title)).toEqual(["Arnaldo Pomodoro", "Pomodoro Technique", "Tomato"]);
  });
});
