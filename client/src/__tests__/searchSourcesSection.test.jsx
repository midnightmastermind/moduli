// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SearchSourcesSection from "../ui/commandCenter/SearchSourcesSection";

const rows = [
  { id: "tmdb", label: "TMDB API key (v3)", getUrl: "https://x", source: "none", providers: [{ id: "tmdb", label: "TMDB (films)" }, { id: "tmdb-tv", label: "TMDB (TV)" }] },
  { id: "usda", label: "USDA key", source: "demo", providers: [{ id: "usda", label: "USDA" }] },
];
afterEach(() => { vi.unstubAllGlobals(); });

describe("Search sources", () => {
  it("lists one row per key with where it comes from, and both TMDB providers on one row", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ ok: true, keys: rows }) })));
    render(<SearchSourcesSection />);
    expect(await screen.findByText("no key — search is off")).toBeTruthy();
    expect(screen.getByText("demo key (rate-limited)")).toBeTruthy();
    expect(screen.getByText("Used by: TMDB (films), TMDB (TV)")).toBeTruthy();
  });

  it("Save sends the key once with the session, and the box clears", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
      calls.push({ url, opts });
      return { ok: true, json: async () => (opts.method ? { ok: true } : { ok: true, keys: rows }) };
    }));
    render(<SearchSourcesSection />);
    const box = await screen.findByLabelText("TMDB API key (v3) value");
    fireEvent.change(box, { target: { value: "abc123" } });
    fireEvent.click(screen.getAllByText("Save")[0]);
    await waitFor(() => expect(calls.some((c) => c.opts.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.opts.method === "PUT");
    expect(put.url).toBe("/api/v1/search/keys/tmdb");
    expect(JSON.parse(put.opts.body)).toEqual({ key: "abc123" });
    await waitFor(() => expect(box.value).toBe(""));
  });
});
