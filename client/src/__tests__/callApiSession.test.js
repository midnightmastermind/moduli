// CALL_API sends the signed-in session to the app's OWN routes, never to
// another origin (2026-09-24: /api/research/wikipedia/import and the upload
// routes stopped trusting a body userId). And the XHR upload helper sends it.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { executeActionItem, isSameSiteUrl } from "../helpers/operationActions";

let calls;
beforeEach(() => {
  calls = [];
  localStorage.setItem("moduli-token", "sess-jwt");
  globalThis.fetch = vi.fn(async (url, init) => { calls.push([url, init]); return { ok: true, headers: { get: () => "application/json" }, json: async () => ({}) }; });
});
afterEach(() => localStorage.removeItem("moduli-token"));

const run = (cfg) => { executeActionItem("CALL_API", cfg, {}, {}, {}); return calls[0]?.[1]?.headers || {}; };

describe("CALL_API and the session", () => {
  it("a same-site /api URL carries the Bearer", () => {
    expect(run({ url: "/api/research/wikipedia/import", method: "POST", body: { q: 1 } }).Authorization).toBe("Bearer sess-jwt");
  });
  it("another origin NEVER does", () => {
    expect(run({ url: "https://api.example.com/x" }).Authorization).toBeUndefined();
    calls = [];
    expect(run({ url: "//evil.example/x" }).Authorization).toBeUndefined();
  });
  it("an op's own Authorization wins", () => {
    expect(run({ url: "/api/x", headers: { authorization: "Bearer mine" } }).authorization).toBe("Bearer mine");
    expect(run({ url: "/api/x", headers: { authorization: "Bearer mine" } }).Authorization).toBeUndefined();
  });
  it("isSameSiteUrl", () => {
    expect(isSameSiteUrl("/api/a")).toBe(true);
    expect(isSameSiteUrl("//x.com/a")).toBe(false);
    expect(isSameSiteUrl("https://viafluere.com/api")).toBe(false);
    expect(isSameSiteUrl(null)).toBe(false);
  });
});

describe("uploadFileWithProgress", () => {
  it("sends the session header", async () => {
    const set = vi.fn();
    class FakeXHR { constructor() { this.upload = { addEventListener() {} }; } open() {} setRequestHeader(k, v) { set(k, v); }
      send() { this.status = 200; this.responseText = "{}"; this.onload(); } abort() {} }
    globalThis.XMLHttpRequest = FakeXHR;
    const { uploadFileWithProgress } = await import("../helpers/uploadWithProgress");
    await uploadFileWithProgress({ url: "/api/artifacts/upload", formData: new FormData() });
    expect(set).toHaveBeenCalledWith("Authorization", "Bearer sess-jwt");
  });
});
