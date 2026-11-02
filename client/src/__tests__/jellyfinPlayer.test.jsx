// ui/JellyfinPlayer — the in-app Jellyfin player (Task 8, media streaming).
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const updateOccurrence = vi.fn();
vi.mock("../helpers/CommitHelpers", () => ({ updateOccurrence: (...a) => updateOccurrence(...a) }));
const withActionLabels = [];
vi.mock("../helpers/actionScope", () => ({
  withAction: (label, fn) => { withActionLabels.push(label); return fn(); },
}));
vi.mock("hls.js", () => ({ default: { isSupported: () => false } }));
vi.mock("../helpers/authStorage", () => ({
  readToken: () => "tok",
  sessionHeaders: () => ({ Authorization: "Bearer tok" }),
}));

const GA = {
  dispatch: vi.fn(), socket: {}, getOcc: (id) => ({ id }), getOccMap: () => ({}), getModMap: () => ({}),
  getState: () => ({ grid: {} }), getViewMap: () => ({}), getFieldMap: () => ({}), foldersById: {},
  occurrencesById: {}, occurrencesByModuleId: {}, fieldsById: {}, state: { grid: {} },
};
vi.mock("../GridActionsContext.js", () => ({
  useGridActionsSelector: (sel) => sel(GA),
  useGridActionsSelectorShallow: (sel) => sel(GA),
}));
vi.mock("../ui/ArtifactSpreadHost", () => ({ openArtifactSpread: vi.fn() }));

import JellyfinPlayer from "../ui/JellyfinPlayer";

const PLAY = {
  playable: true, playSessionId: "s1",
  hlsUrl: "/api/v1/jellyfin/media/Videos/j/master.m3u8?PlaySessionId=s1",
  directUrl: "/api/v1/jellyfin/media/Videos/j/stream?static=true",
  resumeSeconds: 0, runtimeSeconds: 6000, openUrl: "https://jf.example/web/#/details?id=j",
};
const FIELDS = {
  lw: { id: "lw", name: "Last Watched", type: "date" },
  wa: { id: "wa", name: "Watched At", type: "text" },
};
const OCC = { id: "o1", moduleId: "m1", meta: { jellyfinId: "j" }, fields: {} };

let calls;
function mockFetch(routes) {
  calls = [];
  global.fetch = vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    for (const [match, body] of routes) {
      if (String(url).includes(match)) {
        const b = typeof body === "function" ? body(url, opts) : body;
        return { ok: (b.status || 200) < 400, status: b.status || 200, json: async () => b.json ?? b };
      }
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  });
}
const props = () => ({
  occurrenceId: "o1", label: "John Wick", onClose: vi.fn(),
  getOcc: () => OCC, getFieldMap: () => FIELDS, dispatch: vi.fn(), socket: {},
});

beforeEach(() => { updateOccurrence.mockClear(); withActionLabels.length = 0; });
afterEach(() => { vi.restoreAllMocks(); });

describe("JellyfinPlayer", () => {
  it("an unreachable server reads the exact offline copy with an Open in Jellyfin link", async () => {
    mockFetch([["/jellyfin/play/", { offline: true, playable: true, openUrl: PLAY.openUrl }]]);
    render(<JellyfinPlayer {...props()} />);
    expect(await screen.findByText("Media server is offline — the PC may be asleep.")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Open in Jellyfin" });
    expect(link.getAttribute("href")).toBe(PLAY.openUrl);
  });

  it("plays the direct stream with the session token in the url", async () => {
    mockFetch([["/jellyfin/play/", PLAY]]);
    const { container } = render(<JellyfinPlayer {...props()} />);
    await waitFor(() => expect(container.querySelector("video")?.getAttribute("src")).toContain("t=tok"));
    expect(calls[0].opts.headers.Authorization).toBe("Bearer tok");
  });

  it("writes Last Watched + Watched At ONCE, in one 'Watched' action, even as timeupdate keeps firing past 90%", async () => {
    mockFetch([["/jellyfin/play/", PLAY], ["/jellyfin/played", { ok: true }]]);
    const { container } = render(<JellyfinPlayer {...props()} />);
    await waitFor(() => expect(container.querySelector("video")?.getAttribute("src")).toBeTruthy());
    const video = container.querySelector("video");
    for (const t of [5300, 5450, 5600, 5900]) {
      Object.defineProperty(video, "currentTime", { configurable: true, get: () => t, set: () => {} });
      await act(async () => { fireEvent.timeUpdate(video); });
    }
    await waitFor(() => expect(calls.filter((c) => c.url.includes("/jellyfin/played")).length).toBe(1));
    expect(updateOccurrence).toHaveBeenCalledTimes(1);
    expect(withActionLabels).toEqual(["Watched"]);
    const fields = updateOccurrence.mock.calls[0][0].occurrence.fields;
    expect(fields.lw.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fields.wa.value).toMatch(/T.*Z$/);
    const played = calls.find((c) => c.url.includes("/jellyfin/played"));
    expect(JSON.parse(played.opts.body)).toEqual({ occId: "o1", playSessionId: "s1" });
  });

  it("a 401 on the media reads 'Sign in again'", async () => {
    mockFetch([["/jellyfin/play/", PLAY], ["/jellyfin/media/", { status: 401, json: {} }]]);
    const { container } = render(<JellyfinPlayer {...props()} />);
    await waitFor(() => expect(container.querySelector("video")?.getAttribute("src")).toBeTruthy());
    await act(async () => { fireEvent.error(container.querySelector("video")); });
    expect(await screen.findByText(/Sign in again/)).toBeTruthy();
  });

  it("a progress refused for an unknown session gets a fresh session and retries", async () => {
    let n = 0;
    mockFetch([
      ["/jellyfin/play/", () => ({ ...PLAY, playSessionId: `s${++n}` })],
      ["/jellyfin/progress", (_u, o) => (JSON.parse(o.body).playSessionId === "s1" ? { status: 400, json: { error: "validation_error", message: "unknown playSessionId (call GET /jellyfin/play first)" } } : { ok: true })],
    ]);
    const { container } = render(<JellyfinPlayer {...props()} />);
    await waitFor(() => expect(container.querySelector("video")?.getAttribute("src")).toBeTruthy());
    const video = container.querySelector("video");
    Object.defineProperty(video, "currentTime", { configurable: true, get: () => 100, set: () => {} });
    await act(async () => { fireEvent.timeUpdate(video); });
    await act(async () => { fireEvent.pause(video); });
    await waitFor(() => {
      const progress = calls.filter((c) => c.url.includes("/jellyfin/progress")).map((c) => JSON.parse(c.opts.body).playSessionId);
      expect(progress).toEqual(["s1", "s2"]);
    });
  });

  it("closing mid-film sends a final paused progress with keepalive", async () => {
    mockFetch([["/jellyfin/play/", PLAY]]);
    const { container, unmount } = render(<JellyfinPlayer {...props()} />);
    await waitFor(() => expect(container.querySelector("video")?.getAttribute("src")).toBeTruthy());
    const video = container.querySelector("video");
    Object.defineProperty(video, "currentTime", { configurable: true, get: () => 1234, set: () => {} });
    await act(async () => { fireEvent.timeUpdate(video); });
    unmount();
    const last = calls.filter((c) => c.url.includes("/jellyfin/progress")).pop();
    expect(last.opts.keepalive).toBe(true);
    expect(JSON.parse(last.opts.body)).toMatchObject({ occId: "o1", seconds: 1234, paused: true, playSessionId: "s1" });
  });

  it("closing before playback started posts NO progress (the resume point is kept)", async () => {
    mockFetch([["/jellyfin/play/", { ...PLAY, resumeSeconds: 3000 }]]);
    const { container, unmount } = render(<JellyfinPlayer {...props()} />);
    await waitFor(() => expect(container.querySelector("video")?.getAttribute("src")).toBeTruthy());
    unmount();
    expect(calls.filter((c) => c.url.includes("/jellyfin/progress"))).toEqual([]);
  });

  it("closing after a media error posts NO progress", async () => {
    mockFetch([["/jellyfin/play/", PLAY], ["/jellyfin/media/", { status: 500, json: {} }]]);
    const { container, unmount } = render(<JellyfinPlayer {...props()} />);
    await waitFor(() => expect(container.querySelector("video")?.getAttribute("src")).toBeTruthy());
    const video = container.querySelector("video");
    Object.defineProperty(video, "currentTime", { configurable: true, get: () => 50, set: () => {} });
    await act(async () => { fireEvent.timeUpdate(video); });
    await act(async () => { fireEvent.error(video); });
    await screen.findByText("Could not play this file.");
    unmount();
    expect(calls.filter((c) => c.url.includes("/jellyfin/progress"))).toEqual([]);
  });

  it("seeks to the resume point, and only then counts as started", async () => {
    mockFetch([["/jellyfin/play/", { ...PLAY, resumeSeconds: 3000 }]]);
    const { container, unmount } = render(<JellyfinPlayer {...props()} />);
    await waitFor(() => expect(container.querySelector("video")?.getAttribute("src")).toBeTruthy());
    const video = container.querySelector("video");
    let t = 0;
    Object.defineProperty(video, "currentTime", { configurable: true, get: () => t, set: (v) => { t = v; } });
    await act(async () => { fireEvent.loadedMetadata(video); });
    expect(t).toBe(3000);
    unmount();
    const last = calls.filter((c) => c.url.includes("/jellyfin/progress")).pop();
    expect(JSON.parse(last.opts.body).seconds).toBe(3000);
  });

  it("a 400 that is NOT an unknown session does not re-fetch /play", async () => {
    mockFetch([
      ["/jellyfin/play/", PLAY],
      ["/jellyfin/progress", { status: 400, json: { error: "validation_error", message: "seconds must be a non-negative number" } }],
    ]);
    const { container } = render(<JellyfinPlayer {...props()} />);
    await waitFor(() => expect(container.querySelector("video")?.getAttribute("src")).toBeTruthy());
    const video = container.querySelector("video");
    Object.defineProperty(video, "currentTime", { configurable: true, get: () => 100, set: () => {} });
    await act(async () => { fireEvent.timeUpdate(video); });
    await act(async () => { fireEvent.pause(video); });
    await waitFor(() => expect(calls.filter((c) => c.url.includes("/jellyfin/progress")).length).toBe(1));
    expect(calls.filter((c) => c.url.includes("/jellyfin/play/")).length).toBe(1);
  });

  it("concurrent unknown-session reports share ONE /play re-fetch", async () => {
    let n = 0;
    mockFetch([
      ["/jellyfin/play/", () => ({ ...PLAY, playSessionId: `s${++n}` })],
      ["/jellyfin/progress", (_u, o) => (JSON.parse(o.body).playSessionId === "s1" ? { status: 400, json: { error: "validation_error", message: "unknown playSessionId (call GET /jellyfin/play first)" } } : { ok: true })],
    ]);
    const { container } = render(<JellyfinPlayer {...props()} />);
    await waitFor(() => expect(container.querySelector("video")?.getAttribute("src")).toBeTruthy());
    const video = container.querySelector("video");
    Object.defineProperty(video, "currentTime", { configurable: true, get: () => 100, set: () => {} });
    await act(async () => { fireEvent.timeUpdate(video); });
    await act(async () => { fireEvent.pause(video); fireEvent.pause(video); });
    await waitFor(() => expect(calls.filter((c) => c.url.includes("/jellyfin/progress") && JSON.parse(c.opts.body).playSessionId === "s2").length).toBe(2));
    expect(calls.filter((c) => c.url.includes("/jellyfin/play/")).length).toBe(2);
  });

  it("after the finish, pause and close report nothing (the server dropped the session)", async () => {
    mockFetch([["/jellyfin/play/", PLAY], ["/jellyfin/played", { ok: true }]]);
    const { container, unmount } = render(<JellyfinPlayer {...props()} />);
    await waitFor(() => expect(container.querySelector("video")?.getAttribute("src")).toBeTruthy());
    const video = container.querySelector("video");
    Object.defineProperty(video, "currentTime", { configurable: true, get: () => 5500, set: () => {} });
    await act(async () => { fireEvent.timeUpdate(video); });
    await act(async () => { fireEvent.pause(video); });
    unmount();
    expect(calls.filter((c) => c.url.includes("/jellyfin/progress"))).toEqual([]);
  });
});

describe("Play button", () => {
  it("is absent on an instance without jellyfinId and present on a linked one", async () => {
    const { JellyfinPlayButton } = await import("../ui/JellyfinPlayButton");
    const { container, rerender } = render(<JellyfinPlayButton occurrence={{ id: "x", meta: {} }} />);
    expect(container.querySelector("button")).toBeNull();
    rerender(<JellyfinPlayButton occurrence={{ id: "x", meta: { jellyfinId: "j" } }} />);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("an ArtifactCard movie card shows Play only when linked", async () => {
    const { default: ArtifactCard } = await import("../modules/ArtifactCard");
    const mod = { id: "m", role: "artifact", kind: "movie", label: "Movie", fileRef: "" };
    const { rerender } = render(<ArtifactCard module={mod} occurrence={{ id: "a", moduleId: "m", label: "John Wick", meta: { cover: "https://x/p.jpg" } }} />);
    expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
    rerender(<ArtifactCard module={mod} occurrence={{ id: "a", moduleId: "m", label: "John Wick", meta: { cover: "https://x/p.jpg", jellyfinId: "j" } }} />);
    expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  });

  it("ArtifactCard renders the Play button (wiring)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const read = (rel) => fs.readFileSync(path.resolve(process.cwd(), "src", rel), "utf8");
    const src = read("modules/ArtifactCard.jsx");
    expect(src).toMatch(/<JellyfinPlayButton\b/);
    const mi = read("modules/ModuleInstance.jsx");
    expect(mi).toMatch(/jellyfinRadialItems\(/);
    // the live field map, not a snapshot frozen when the menu was built
    expect(mi).not.toMatch(/getFieldMap:\s*\(\)\s*=>\s*fieldsById/);
    expect(read("App.jsx")).toMatch(/<JellyfinPlayerHost\b/);
  });
});
