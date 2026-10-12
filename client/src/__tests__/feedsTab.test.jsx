// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FeedSubscriptions } from "../ui/commandCenter/ImportsTab.jsx";
import { AUTH_KEYS } from "../helpers/authStorage";

describe("Imports › Feeds", () => {
  it("lists feeds and subscribes a new one", async () => {
    localStorage.setItem(AUTH_KEYS.token, "t");
    const calls = [];
    const feeds = [{ id: "f1", name: "Work", url: "webcal://x/a.ics", everyMinutes: 60, enabled: true, lastEventCount: 3, lastStatus: "ok", lastFetchedAt: new Date().toISOString() }];
    const fetchImpl = vi.fn(async (url, opts = {}) => {
      calls.push([url, opts.method || "GET", opts.body]);
      if (opts.method === "POST") return { ok: true, json: async () => ({ feeds: [...feeds, { id: "f2", name: "Home", url: "https://y/b.ics", everyMinutes: 30, enabled: true, lastEventCount: 1 }] }) };
      return { ok: true, json: async () => ({ feeds }) };
    });
    render(<FeedSubscriptions gridId="g1" fetchImpl={fetchImpl} />);
    await screen.findByDisplayValue("Work");
    expect(screen.getByText(/3 events/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Feed link"), { target: { value: "https://y/b.ics" } });
    fireEvent.click(screen.getByText("Subscribe"));
    await screen.findByDisplayValue("Home");
    const post = calls.find(c => c[1] === "POST");
    expect(post[0]).toBe("/api/v1/grids/g1/feeds");
    expect(JSON.parse(post[2])).toMatchObject({ url: "https://y/b.ics", everyMinutes: 60 });
  });
});
