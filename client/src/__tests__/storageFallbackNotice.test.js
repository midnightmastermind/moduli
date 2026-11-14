// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
const warn = vi.fn();
vi.mock("../state/notificationStore", () => ({ toast: { warning: (...a) => warn(...a), loading: vi.fn(), success: vi.fn(), error: vi.fn(), message: vi.fn() } }));
const { noteStorageFallback, storageFallbackMessage, __resetFallbackNotice } = await import("../helpers/artifactUpload.js");

describe("an upload kept on the server says so", () => {
  beforeEach(() => { warn.mockClear(); __resetFallbackNotice(); });
  it("names Drive when the token needs reconnecting", () => {
    expect(storageFallbackMessage({ needsReconnect: true })).toMatch(/Google Drive needs reconnecting/);
    expect(storageFallbackMessage(null)).toBe(null);
  });
  it("warns once for a whole drop, not once per file", () => {
    const fb = { needsReconnect: true };
    expect(noteStorageFallback(fb, 1000)).toBe(true);
    expect(noteStorageFallback(fb, 2000)).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(noteStorageFallback(fb, 1000 + 11 * 60 * 1000)).toBe(true);
  });
  it("says nothing when the upload went where it should", () => {
    expect(noteStorageFallback(undefined, 1000)).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});
