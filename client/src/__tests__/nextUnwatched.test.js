// @vitest-environment jsdom
// "Play next unwatched" on a TV Series / Season row (media streaming plan, Task 9): the pure choice.
import { describe, it, expect } from "vitest";
import { nextUnwatched, episodesForRow, isShowOrSeasonRow } from "../helpers/nextUnwatched";

const ep = (id, season, number, { jf = true, watched = false } = {}) =>
  ({ id, label: `S${season}E${number}`, season, number, jellyfinId: jf ? `jf-${id}` : "", watched });

describe("nextUnwatched", () => {
  it("picks the first unwatched episode by (season, number), whatever order they arrive in", () => {
    const episodes = [ep("e4", 2, 1), ep("e2", 1, 2), ep("e1", 1, 1, { watched: true }), ep("e3", 1, 10)];
    const r = nextUnwatched({ showOrSeasonRow: { id: "show" }, episodes });
    expect(r.episode.id).toBe("e2");
    expect(r.skipped).toEqual([]);
  });

  it("skips an unwatched episode without a file and reports it", () => {
    const episodes = [ep("e1", 1, 1, { watched: true }), ep("e2", 1, 2, { jf: false }), ep("e3", 1, 3)];
    const r = nextUnwatched({ showOrSeasonRow: { id: "show" }, episodes });
    expect(r.episode.id).toBe("e3");
    expect(r.skipped).toEqual(["S1E2"]);
  });

  it("returns null when every episode is watched", () => {
    const episodes = [ep("e1", 1, 1, { watched: true }), ep("e2", 1, 2, { watched: true })];
    expect(nextUnwatched({ showOrSeasonRow: { id: "show" }, episodes })).toBeNull();
  });

  it("returns null when the only unwatched episodes have no file", () => {
    expect(nextUnwatched({ showOrSeasonRow: { id: "s" }, episodes: [ep("e1", 1, 1, { jf: false })] })).toBeNull();
  });
});

describe("episodesForRow", () => {
  const F = { show: "fShow", seasonLink: "fSeasonLink", season: "fSeason", number: "fNum", lastWatched: "fLW", watchedAt: "fWA" };
  const cell = (v) => ({ value: v, flow: "in" });
  const occs = [
    { id: "a", label: "A", meta: { jellyfinId: "jA" }, fields: { fShow: cell("show1"), fSeasonLink: cell("seas1"), fSeason: cell(1), fNum: cell(1), fLW: cell("2026-10-01") } },
    { id: "b", label: "B", meta: {}, fields: { fShow: cell("show1"), fSeasonLink: cell("seas1"), fSeason: cell(1), fNum: cell(2) } },
    { id: "c", label: "C", meta: { jellyfinId: "jC" }, fields: { fShow: cell("show1"), fSeasonLink: cell("seas2"), fSeason: cell(2), fNum: cell(1), fWA: cell("2026-10-02T01:00:00Z") } },
    { id: "copy", label: "A", meta: { feedSourceId: "a", jellyfinId: "jA" }, fields: { fShow: cell("show1"), fSeason: cell(1), fNum: cell(1) } },
    { id: "other", label: "X", meta: {}, fields: { fShow: cell("show2"), fSeason: cell(1), fNum: cell(1) } },
  ];
  it("a show's episodes: every row naming it, feed copies left out, watched from Last Watched or Watched At", () => {
    const eps = episodesForRow({ id: "show1" }, occs, F);
    expect(eps.map((e) => [e.id, e.season, e.number, e.jellyfinId, e.watched])).toEqual([
      ["a", 1, 1, "jA", true], ["b", 1, 2, "", false], ["c", 2, 1, "jC", true],
    ]);
  });
  it("a season's episodes: only the rows linking that season", () => {
    expect(episodesForRow({ id: "seas1" }, occs, F).map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("isShowOrSeasonRow", () => {
  it("a row the sync linked that is not itself playable (a Series / Season)", () => {
    expect(isShowOrSeasonRow({ meta: { jellyfinId: "x" } })).toBe(true);
    expect(isShowOrSeasonRow({ meta: { jellyfinId: "x", jellyfinPlayable: true } })).toBe(false);
    expect(isShowOrSeasonRow({ meta: {} })).toBe(false);
  });
});

describe("Play next unwatched (wiring)", async () => {
  const { vi } = await import("vitest");
  vi.mock("../state/notificationStore", () => ({ toast: vi.fn() }));
  const { toast } = await import("../state/notificationStore");
  const { playNextUnwatched, jellyfinRadialItems, registerJellyfinPlayerHost } = await import("../helpers/jellyfinPlay");
  const fieldsById = {
    fShow: { id: "fShow", name: "TV Show", type: "occurrence" }, fSL: { id: "fSL", name: "TV Season", type: "occurrence" },
    fS: { id: "fS", name: "Season", type: "number" }, fN: { id: "fN", name: "Episode #", type: "number" },
    fLW: { id: "fLW", name: "Last Watched", type: "date" }, fWA: { id: "fWA", name: "Watched At", type: "text" },
  };
  const c = (v) => ({ value: v, flow: "in" });
  const show = { id: "show", label: "Dark", meta: { jellyfinId: "jShow" } };
  const occ = (id, s, n, extra = {}) => ({ id, label: `S${s}E${n}`, meta: extra.jf === false ? {} : { jellyfinId: `j${id}`, jellyfinPlayable: true },
    fields: { fShow: c("show"), fS: c(s), fN: c(n), ...(extra.watched ? { fLW: c("2026-10-01") } : {}) } });

  it("opens the player on the chosen episode and says which were skipped", () => {
    const occs = { show, a: occ("a", 1, 1, { watched: true }), b: occ("b", 1, 2, { jf: false }), c: occ("c", 1, 3) };
    const host = vi.fn();
    const off = registerJellyfinPlayerHost(host);
    expect(playNextUnwatched({ occurrence: show, getOccMap: () => occs, getFieldMap: () => fieldsById })).toBe(true);
    off();
    expect(host).toHaveBeenCalledWith(expect.objectContaining({ occurrenceId: "c", label: "S1E3" }));
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("S1E2"));
  });

  it("says so when everything is watched, and opens nothing", () => {
    toast.mockClear();
    const host = vi.fn();
    const off = registerJellyfinPlayerHost(host);
    expect(playNextUnwatched({ occurrence: show, getOccMap: () => ({ show, a: occ("a", 1, 1, { watched: true }) }), getFieldMap: () => fieldsById })).toBe(false);
    off();
    expect(host).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalled();
  });

  it("the radial offers Play next unwatched on a show / season row, Play on an episode", () => {
    const next = vi.fn();
    expect(jellyfinRadialItems({ occurrence: show, onPlay: vi.fn(), onPlayNext: next }).map((i) => i.label))
      .toEqual(["Play next unwatched", "Open in Jellyfin"]);
    expect(jellyfinRadialItems({ occurrence: occ("c", 1, 3), onPlay: vi.fn(), onPlayNext: next }).map((i) => i.label))
      .toEqual(["Play", "Open in Jellyfin"]);
  });
});

describe("the Play button on a show row", async () => {
  const React = (await import("react")).default;
  const { render, screen, fireEvent } = await import("@testing-library/react");
  const { JellyfinPlayButton } = await import("../ui/JellyfinPlayButton.jsx");
  it("reads Play next on a Series / Season row and runs onPlayNext; Play on a playable row", async () => {
    const { vi } = await import("vitest");
    const onPlay = vi.fn(), onPlayNext = vi.fn();
    const { rerender } = render(React.createElement(JellyfinPlayButton, { occurrence: { id: "s", meta: { jellyfinId: "j" } }, onPlay, onPlayNext }));
    fireEvent.click(screen.getByRole("button", { name: "Play next unwatched" }));
    expect(onPlayNext).toHaveBeenCalled();
    rerender(React.createElement(JellyfinPlayButton, { occurrence: { id: "e", meta: { jellyfinId: "j", jellyfinPlayable: true } }, onPlay, onPlayNext }));
    fireEvent.click(screen.getByRole("button", { name: "Play" }));
    expect(onPlay).toHaveBeenCalled();
  });
});
