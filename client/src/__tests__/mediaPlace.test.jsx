// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { makePlaybackPosition, resumeTimeFor, movedEnough } from "../helpers/mediaPlace";

const updates = [];
vi.mock("../helpers/CommitHelpers", () => ({ updateModule: (a) => updates.push(a) }));
const mods = { m1: { id: "m1", label: "Clip", meta: { cover: "x", playbackPosition: { time: 42, duration: 300 } } } };
vi.mock("../GridActionsContext", () => ({
  useGridActionsSelector: (sel) => sel({ dispatch: () => {}, socket: null, getModMap: () => mods }),
}));
import useMediaPlace from "../hooks/useMediaPlace";

function fakeMedia({ duration = 300 } = {}) {
  const el = new EventTarget();
  el.readyState = 0; el.duration = duration; el.currentTime = 0;
  return el;
}

describe("mediaPlace (pure)", () => {
  it("resumes a saved place, not a barely-started or finished one", () => {
    expect(resumeTimeFor({ time: 42 }, 300)).toBe(42);
    expect(resumeTimeFor({ time: 2 }, 300)).toBe(null);
    expect(resumeTimeFor({ time: 297 }, 300)).toBe(null);
    expect(resumeTimeFor({ time: 297, duration: 300 }, NaN)).toBe(null);
    expect(resumeTimeFor(null, 300)).toBe(null);
  });
  it("writes again only after the playhead moved enough", () => {
    expect(movedEnough(NaN, 3)).toBe(true);
    expect(movedEnough(10, 12)).toBe(false);
    expect(movedEnough(10, 15)).toBe(true);
    expect(makePlaybackPosition({ time: 12.345, duration: 99.99, now: 0 })).toEqual({ time: 12.3, duration: 100, at: new Date(0).toISOString() });
  });
});

describe("useMediaPlace", () => {
  beforeEach(() => { updates.length = 0; });
  it("seeks to the saved place on load, then saves where it was left, keeping the rest of meta", () => {
    const { result } = renderHook(() => useMediaPlace("m1"));
    const el = fakeMedia();
    result.current(el);
    el.dispatchEvent(new Event("loadedmetadata"));
    expect(el.currentTime).toBe(42);
    el.currentTime = 44; el.dispatchEvent(new Event("timeupdate"));
    expect(updates).toHaveLength(0); // moved 2s: not yet
    el.currentTime = 60; el.dispatchEvent(new Event("timeupdate"));
    expect(updates).toHaveLength(1);
    expect(updates[0].module).toMatchObject({ id: "m1", meta: { cover: "x", playbackPosition: { time: 60, duration: 300 } } });
    el.currentTime = 61; el.dispatchEvent(new Event("pause"));
    expect(updates.at(-1).module.meta.playbackPosition.time).toBe(61);
  });
  it("saves nothing before the place was restored, and nothing without a module", () => {
    const { result } = renderHook(() => useMediaPlace(null));
    const el = fakeMedia();
    result.current(el);
    el.dispatchEvent(new Event("loadedmetadata"));
    el.currentTime = 80; el.dispatchEvent(new Event("pause"));
    expect(updates).toHaveLength(0);
    expect(el.currentTime).toBe(80);
  });
});
