// helpers/jellyfinPlay — the pure half of the Jellyfin player (Task 8, media streaming).
import { describe, it, expect, vi } from "vitest";
import {
  isPlayableRow, FINISHED_FRACTION, shouldMarkFinished, localDateString, withMediaToken,
  findWatchFields, buildWatchedFields, jellyfinRadialItems,
} from "../helpers/jellyfinPlay";

describe("shouldMarkFinished", () => {
  it("90% of the runtime is finished; one second short is not", () => {
    expect(FINISHED_FRACTION).toBe(0.9);
    expect(shouldMarkFinished(5400, 6000)).toBe(true);
    expect(shouldMarkFinished(5399, 6000)).toBe(false);
  });
  it("an unknown runtime never counts as finished", () => {
    expect(shouldMarkFinished(5400, 0)).toBe(false);
    expect(shouldMarkFinished(5400, NaN)).toBe(false);
  });
});

describe("isPlayableRow", () => {
  it("is a row the sync linked (meta.jellyfinId)", () => {
    expect(isPlayableRow({ meta: { jellyfinId: "abc" } })).toBe(true);
    expect(isPlayableRow({ meta: {} })).toBe(false);
    expect(isPlayableRow(null)).toBe(false);
  });
});

describe("localDateString", () => {
  it("is the browser's LOCAL day, not the UTC one", () => {
    expect(localDateString(new Date(2026, 10, 1, 23, 30))).toBe("2026-11-01");
    expect(localDateString(new Date(2026, 0, 5, 0, 5))).toBe("2026-01-05");
  });
});

describe("withMediaToken", () => {
  it("appends t= so a <video>/hls.js request carries the session", () => {
    expect(withMediaToken("/api/v1/jellyfin/media/Videos/x/master.m3u8?a=1", "tok"))
      .toBe("/api/v1/jellyfin/media/Videos/x/master.m3u8?a=1&t=tok");
    expect(withMediaToken("/api/v1/jellyfin/media/Videos/x/stream", "a b"))
      .toBe("/api/v1/jellyfin/media/Videos/x/stream?t=a%20b");
  });
  it("leaves the url alone with no token", () => {
    expect(withMediaToken("/x?a=1", null)).toBe("/x?a=1");
  });
});

describe("findWatchFields / buildWatchedFields", () => {
  const fieldsById = {
    f1: { id: "f1", name: "Last Watched", type: "date" },
    f2: { id: "f2", name: "Watched At", type: "text" },
    f3: { id: "f3", name: "Title", type: "text" },
  };
  it("finds both fields by NAME", () => {
    const { lastWatched, watchedAt } = findWatchFields(fieldsById);
    expect(lastWatched.id).toBe("f1");
    expect(watchedAt.id).toBe("f2");
  });
  it("writes the local date into Last Watched and the ISO instant into Watched At, keeping other fields", () => {
    const now = new Date(2026, 10, 1, 21, 15);
    const out = buildWatchedFields({ f3: { value: "x" }, f1: { value: "2026-01-01", flow: "in" } }, findWatchFields(fieldsById), now);
    expect(out.f3).toEqual({ value: "x" });
    expect(out.f1).toEqual({ value: "2026-11-01", flow: "in" });
    expect(out.f2.value).toBe(now.toISOString());
  });
  it("without Watched At writes Last Watched only", () => {
    const only = findWatchFields({ f1: fieldsById.f1 });
    expect(only.watchedAt).toBeNull();
    const out = buildWatchedFields({}, only, new Date(2026, 10, 1));
    expect(Object.keys(out)).toEqual(["f1"]);
  });
});

describe("jellyfinRadialItems", () => {
  it("offers nothing on an instance without jellyfinId", () => {
    expect(jellyfinRadialItems({ occurrence: { id: "o", meta: {} }, onPlay: vi.fn() })).toEqual([]);
  });
  it("offers Play and Open in Jellyfin on a linked instance", () => {
    const onPlay = vi.fn();
    const items = jellyfinRadialItems({ occurrence: { id: "o", meta: { jellyfinId: "j" } }, onPlay });
    expect(items.map((i) => i.label)).toEqual(["Play", "Open in Jellyfin"]);
    items[0].onClick();
    expect(onPlay).toHaveBeenCalled();
  });
});
