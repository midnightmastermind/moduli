// What the extension needs to know, and how it fails when it does not.
// The failure being guarded is a clip that silently goes nowhere.
import { describe, it, expect } from "vitest";
import {
  validateSettings, fieldIdsFrom, clipOutcomeMessage, DEFAULT_BASE_URL,
} from "../../extension/settings.js";

describe("validateSettings", () => {
  it("accepts a complete setup", () => {
    const r = validateSettings({ token: "t", gridId: "g" });
    expect(r.ok).toBe(true);
    expect(r.settings.baseUrl).toBe(DEFAULT_BASE_URL);
  });

  it("NAMES what is missing instead of failing silently", () => {
    // Half-configured is the common state. A worker that just returns leaves
    // the user right-clicking into a void with nothing to correct.
    const r = validateSettings({ token: "t" });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["gridId"]);
    expect(r.message).toMatch(/gridId/);
  });

  it("treats whitespace as absent", () => {
    expect(validateSettings({ token: "   ", gridId: "g" }).ok).toBe(false);
  });

  it("does NOT require parentId — a clip with no home still lands", () => {
    // Requiring it would block the common case to prevent a recoverable one:
    // an unfiled clip can be moved, an unmade clip cannot.
    const r = validateSettings({ token: "t", gridId: "g" });
    expect(r.ok).toBe(true);
    expect(r.settings.parentId).toBeNull();
  });

  it("strips a trailing slash so the URL never doubles up", () => {
    expect(validateSettings({ token: "t", gridId: "g", baseUrl: "https://x.com//" }).settings.baseUrl)
      .toBe("https://x.com");
  });
});

describe("fieldIdsFrom", () => {
  it("maps name to id", () => {
    expect(fieldIdsFrom([{ name: "URL", id: "a" }, { name: "Excerpt", id: "b" }]))
      .toEqual({ URL: "a", Excerpt: "b" });
  });

  it("keeps the FIRST of a duplicated name rather than the last", () => {
    // This grid has carried duplicate field names before (2026-07-14 swept 11).
    // Last-wins would make which field a clip writes depend on query order.
    expect(fieldIdsFrom([{ name: "URL", id: "first" }, { name: "URL", id: "second" }]))
      .toEqual({ URL: "first" });
  });

  it("survives junk — the control", () => {
    expect(fieldIdsFrom(null)).toEqual({});
    expect(fieldIdsFrom([null, { name: "X" }, { id: "y" }])).toEqual({});
  });
});

describe("clipOutcomeMessage", () => {
  it("distinguishes created, updated and already-there", () => {
    expect(clipOutcomeMessage({ results: [{ status: "created" }] })).toMatch(/Clipped/);
    expect(clipOutcomeMessage({ results: [{ status: "updated" }] })).toMatch(/updated/);
    expect(clipOutcomeMessage({ results: [{ status: "skipped" }] })).toMatch(/Already/);
  });

  it("reports a 200 whose RECORD failed as a failure", () => {
    // The request worked and the clip did not. "Clipped" would hide exactly the
    // case the user needs to know about.
    expect(clipOutcomeMessage({ results: [{ ok: false, error: "parentId not found" }] }))
      .toMatch(/failed: parentId not found/);
  });

  it("reports a transport failure", () => {
    expect(clipOutcomeMessage({ ok: false, error: "HTTP 401" })).toMatch(/failed: HTTP 401/);
  });

  it("never claims success when it has no result at all", () => {
    expect(clipOutcomeMessage(null)).toMatch(/failed/);
    expect(clipOutcomeMessage({ results: [] })).toMatch(/failed/);
  });
});
