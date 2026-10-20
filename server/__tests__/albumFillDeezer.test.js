// 0424 — saved albums still missing tracks are filled from Deezer.
import { describe, it, expect } from "vitest";
import { pickDeezerAlbumId, needsFill, deezerTracks, tracksToAdd } from "../migrations/0424-saved-album-tracks-deezer.mjs";

describe("pickDeezerAlbumId", () => {
  const data = [
    { id: 1, title: "sink or swim", artist: { name: "Someone Else" } },
    { id: 2, title: "Sink or Swim", artist: { name: "Ouse" } },
  ];
  it("takes the first hit whose title AND artist match", () => {
    expect(pickDeezerAlbumId(data, "sink or swim", "Ouse")).toBe(2);
  });
  it("refuses a title-only match", () => {
    expect(pickDeezerAlbumId(data, "sink or swim", "Nobody")).toBe(null);
  });
});

describe("needsFill", () => {
  it("an empty album needs filling", () => {
    expect(needsFill({ meta: { tracklistCount: 5 } }, 0)).toBe(true);
  });
  it("a partial album needs filling", () => {
    expect(needsFill({ meta: { tracklistCount: 2 } }, 1)).toBe(true);
  });
  it("an album that never got a count needs filling", () => {
    expect(needsFill({ meta: {} }, 3)).toBe(true);
  });
  it("a full album does not", () => {
    expect(needsFill({ meta: { tracklistCount: 4 } }, 4)).toBe(false);
  });
  it("an album already asked of Deezer is never asked again", () => {
    expect(needsFill({ meta: { tracklistCount: 4, deezerTracklistAt: "2026-10-20" } }, 0)).toBe(false);
  });
});

describe("deezerTracks", () => {
  const ok = (body) => async () => ({ ok: true, json: async () => body });
  it("returns title + position for each track", async () => {
    const t = await deezerTracks(9, ok({ data: [{ title: "A", track_position: 1 }, { title: "B", track_position: 2 }] }));
    expect(t).toEqual([{ title: "A", position: 1 }, { title: "B", position: 2 }]);
  });
  it("THROWS on a refused request, so throttling cannot look like an empty album", async () => {
    await expect(deezerTracks(9, async () => ({ ok: false, status: 429 }))).rejects.toThrow(/429/);
  });
  it("THROWS on Deezer's error payload", async () => {
    await expect(deezerTracks(9, ok({ error: { code: 4 } }))).rejects.toThrow();
  });
});

describe("tracksToAdd", () => {
  const cat = [{ title: "One" }, { title: "Two (Remastered)" }, { title: "Three" }];
  it("an album holding as many songs as the catalogue gains nothing (spelling twins)", () => {
    expect(tracksToAdd(cat, ["One", "Two", "Three"])).toEqual([]);
  });
  it("a short album gains only the titles it lacks", () => {
    expect(tracksToAdd(cat, ["one"]).map((t) => t.title)).toEqual(["Two (Remastered)", "Three"]);
  });
});
