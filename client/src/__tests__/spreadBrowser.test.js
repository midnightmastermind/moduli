// The viewer's url tile. What is pinned here is the DECISION — when a browser
// belongs in a spread, and when adding one would be the same thing twice.
import { describe, it, expect } from "vitest";
import { planSpreadBrowser, hostOf } from "../helpers/spreadBrowser";

const F = { url: { id: "url", name: "URL" } };

// A bookmark: a row whose URL field points at an article.
const bookmark = {
  id: "bm1", moduleId: "m1",
  fields: { url: { value: "https://washingtonpost.com/opinions/house-of-cards" } },
};
const bookmarkModule = { id: "m1", role: "artifact", kind: "bookmark", fileRef: "" };

// An image stored BY URL: its `fileRef` IS the picture.
const image = { id: "img1", moduleId: "m2", fields: {} };
const imageModule = { id: "m2", role: "artifact", kind: "image", fileRef: "https://image.tmdb.org/x.jpg" };

const ctx = (over = {}) => ({
  owner: bookmark, module: bookmarkModule, fieldsById: F,
  spreadOcc: { id: "sp1", meta: {} },
  occurrencesById: {}, modulesById: {},
  ...over,
});

describe("planSpreadBrowser", () => {
  it("wants a browser for a row that points somewhere", () => {
    const plan = planSpreadBrowser(ctx());
    expect(plan?.mint).toBe(true);
    expect(plan.url).toBe("https://washingtonpost.com/opinions/house-of-cards");
    expect(plan.label).toBe("washingtonpost.com");
  });

  // THE CONTROL FOR THE ONE ABOVE. Without it "wants a browser" is also
  // satisfied by a planner that wants one for everything — which is the
  // 1,509-row duplicate this measurement was taken to prevent.
  it("wants NOTHING when the url IS the file", () => {
    expect(planSpreadBrowser(ctx({ owner: image, module: imageModule }))).toBeNull();
  });

  it("wants nothing for a row with no url at all", () => {
    expect(planSpreadBrowser(ctx({
      owner: { id: "x", moduleId: "m3", fields: {} },
      module: { id: "m3", role: "instance" },
    }))).toBeNull();
  });

  // ── THE LOOP INVARIANT ────────────────────────────────────────────────
  // Feed the result back in and it must say "nothing left to do". An effect
  // that cannot do that is an unbounded row factory; the sibling planner
  // `planSpreadSync` exists because that exact shape blanked the app once.
  it("is DONE once its own mint has landed", () => {
    const plan = planSpreadBrowser(ctx());
    const minted = { id: "b1", moduleId: "bm", meta: { url: plan.url } };
    const again = planSpreadBrowser(ctx({
      spreadOcc: { id: "sp1", meta: { browserOccId: "b1" } },
      occurrencesById: { b1: minted },
    }));
    expect(again).toBeNull();
  });

  it("retargets rather than minting a second one when the url is edited", () => {
    const plan = planSpreadBrowser(ctx({
      spreadOcc: { id: "sp1", meta: { browserOccId: "b1" } },
      occurrencesById: { b1: { id: "b1", moduleId: "bm", meta: { url: "https://old.test/" } } },
    }));
    expect(plan?.retargetId).toBe("b1");
    expect(plan.mint).toBeUndefined();
    expect(plan.url).toBe("https://washingtonpost.com/opinions/house-of-cards");
  });

  it("reads the url off the MODULE's fileRef too, the other place the mint writes it", () => {
    const plan = planSpreadBrowser(ctx({
      spreadOcc: { id: "sp1", meta: { browserOccId: "b1" } },
      occurrencesById: { b1: { id: "b1", moduleId: "bm", meta: {} } },
      modulesById: { bm: { id: "bm", fileRef: "https://washingtonpost.com/opinions/house-of-cards" } },
    }));
    expect(plan).toBeNull();
  });

  // A recorded id whose occurrence is gone must be NAMED, or minting a
  // replacement leaves the dead id listed in the page — the dangling-child-ref
  // class this repo has swept five times.
  it("names a dead recorded id so the caller can drop it", () => {
    const plan = planSpreadBrowser(ctx({
      spreadOcc: { id: "sp1", meta: { browserOccId: "gone" } },
      occurrencesById: {},
    }));
    expect(plan?.mint).toBe(true);
    expect(plan.dropId).toBe("gone");
  });

  it("survives being asked about nothing", () => {
    expect(planSpreadBrowser()).toBeNull();
    expect(planSpreadBrowser({ owner: null })).toBeNull();
  });
});

describe("hostOf", () => {
  it("names the tile by host, without the www", () => {
    expect(hostOf("https://www.washingtonpost.com/a/b")).toBe("washingtonpost.com");
    expect(hostOf("https://open.spotify.com/track/1")).toBe("open.spotify.com");
  });
  it("falls back to the whole string rather than throwing", () => {
    expect(hostOf("not a url")).toBe("not a url");
    expect(hostOf("")).toBe("");
  });
});
