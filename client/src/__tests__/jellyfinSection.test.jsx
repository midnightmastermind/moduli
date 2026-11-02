// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { JellyfinSection } from "../ui/commandCenter/JellyfinSection";

afterEach(() => { vi.unstubAllGlobals(); });
const ok = (b) => ({ ok: true, json: async () => ({ ok: true, ...b }) });

describe("JellyfinSection", () => {
  it("shows Key saved and the server name when connected, with a write-only key box", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => url.endsWith("status")
      ? ok({ configured: true, online: true, serverName: "Home" })
      : ok({ configured: true, baseUrl: "http://127.0.0.1:8097", publicUrl: "https://m", jfUserId: "u" })));
    render(<JellyfinSection />);
    expect(await screen.findByText("Connected — Home")).toBeTruthy();
    expect(screen.getByTestId("jellyfin-key-saved")).toBeTruthy();
    const key = screen.getByLabelText("Jellyfin API key");
    expect(key.type).toBe("password");
    expect(key.value).toBe("");
  });
  it("a key Jellyfin rejects says so instead of 'Connected'", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url) => url.endsWith("status")
      ? ok({ configured: true, online: true, serverName: "Home", error: "bad_key" })
      : ok({ configured: true, baseUrl: "http://127.0.0.1:8097", publicUrl: "https://m", jfUserId: "u" })));
    render(<JellyfinSection />);
    expect(await screen.findByText("Jellyfin rejected the API key")).toBeTruthy();
  });
  it("Save PUTs the form once", async () => {
    const calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
      calls.push({ url, opts });
      return ok({ configured: false, baseUrl: "http://127.0.0.1:8097", publicUrl: "https://media.viafluere.com", jfUserId: "" });
    }));
    render(<JellyfinSection />);
    fireEvent.change(await screen.findByLabelText("Jellyfin API key"), { target: { value: "K" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(calls.some((c) => c.opts.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.opts.method === "PUT");
    expect(put.url).toBe("/api/v1/jellyfin/config");
    expect(JSON.parse(put.opts.body).apiKey).toBe("K");
  });
});
