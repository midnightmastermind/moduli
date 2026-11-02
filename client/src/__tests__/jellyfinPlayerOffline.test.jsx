// ui/JellyfinPlayer — a media 503 / network error means the PC is asleep: the offline copy, not "Could not play".
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

const updateOccurrence = vi.fn();
vi.mock("../helpers/CommitHelpers", () => ({ updateOccurrence: (...a) => updateOccurrence(...a) }));
const withActionLabels = [];
vi.mock("../helpers/actionScope", () => ({
  withAction: (label, fn) => { withActionLabels.push(label); return fn(); },
}));
const hlsState = vi.hoisted(() => ({ supported: false, instance: null }));
vi.mock("hls.js", () => {
  class Hls {
    static isSupported() { return hlsState.supported; }
    static Events = { ERROR: "hlsError" };
    constructor() { this.handlers = {}; hlsState.instance = this; }
    on(ev, fn) { this.handlers[ev] = fn; }
    loadSource() {} attachMedia() {} destroy() {}
  }
  return { default: Hls };
});
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

describe("JellyfinPlayer offline mid-play", () => {
  beforeEach(() => { hlsState.supported = false; hlsState.instance = null; });

  it("native playback: a media request answering 503 reads the offline copy", async () => {
    mockFetch([["/jellyfin/play/", PLAY], ["/jellyfin/media/", { status: 503, json: { code: "media_offline" } }]]);
    const { container } = render(<JellyfinPlayer {...props()} />);
    await waitFor(() => expect(container.querySelector("video")?.getAttribute("src")).toBeTruthy());
    await act(async () => { fireEvent.error(container.querySelector("video")); });
    expect(await screen.findByText("Media server is offline — the PC may be asleep.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open in Jellyfin" }).getAttribute("href")).toBe(PLAY.openUrl);
  });

  it("hls.js: a fatal 503 on a segment reads the offline copy", async () => {
    hlsState.supported = true;
    mockFetch([["/jellyfin/play/", PLAY]]);
    const { container } = render(<JellyfinPlayer {...props()} />);
    await waitFor(() => expect(hlsState.instance?.handlers?.hlsError).toBeTruthy());
    void container;
    await act(async () => { hlsState.instance.handlers.hlsError("hlsError", { fatal: true, type: "networkError", response: { code: 503 } }); });
    expect(await screen.findByText("Media server is offline — the PC may be asleep.")).toBeTruthy();
  });

  it("hls.js: a fatal network error with no response reads the offline copy", async () => {
    hlsState.supported = true;
    mockFetch([["/jellyfin/play/", PLAY]]);
    render(<JellyfinPlayer {...props()} />);
    await waitFor(() => expect(hlsState.instance?.handlers?.hlsError).toBeTruthy());
    await act(async () => { hlsState.instance.handlers.hlsError("hlsError", { fatal: true, type: "networkError", response: { code: 0 } }); });
    expect(await screen.findByText("Media server is offline — the PC may be asleep.")).toBeTruthy();
  });

  it("hls.js: a fatal MEDIA error (not network) still reads 'Could not play this file.'", async () => {
    hlsState.supported = true;
    mockFetch([["/jellyfin/play/", PLAY]]);
    render(<JellyfinPlayer {...props()} />);
    await waitFor(() => expect(hlsState.instance?.handlers?.hlsError).toBeTruthy());
    await act(async () => { hlsState.instance.handlers.hlsError("hlsError", { fatal: true, type: "mediaError" }); });
    expect(await screen.findByText("Could not play this file.")).toBeTruthy();
  });
});
