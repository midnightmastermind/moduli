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

// "File into": a calendar feed can name the container its events land in (2026-10-13, Holidays board).
// DestinationPicker is a Radix popover — stood in by a <select> so the test is about what the row WRITES.
vi.mock("../ui/DestinationPicker", () => ({
  default: ({ options, value, onChange, ariaLabel }) => (
    <select aria-label={ariaLabel} value={value || ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">none</option>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </select>
  ),
}));

describe("Imports › Feeds › File into", () => {
  it("a calendar feed's destination is PATCHed; a news feed offers none", async () => {
    localStorage.setItem(AUTH_KEYS.token, "t");
    const calls = [];
    const feeds = [
      { id: "f1", name: "Holidays", kind: "calendar", url: "webcal://x/a.ics", everyMinutes: 60, enabled: true, destinationId: null },
      { id: "f2", name: "Blog", kind: "news", url: "https://y/rss", everyMinutes: 60, enabled: true },
    ];
    const fetchImpl = vi.fn(async (url, opts = {}) => { calls.push([url, opts.method || "GET", opts.body]); return { ok: true, json: async () => ({ feeds }) }; });
    render(<FeedSubscriptions gridId="g1" fetchImpl={fetchImpl} containerOptions={[{ id: "ctr-h", label: "Holidays" }]} />);
    await screen.findByDisplayValue("Blog");
    const pickers = screen.getAllByLabelText("File events into");
    expect(pickers).toHaveLength(1);
    fireEvent.change(pickers[0], { target: { value: "ctr-h" } });
    await waitFor(() => expect(calls.some((c) => c[1] === "PATCH")).toBe(true));
    const patch = calls.find((c) => c[1] === "PATCH");
    expect(patch[0]).toBe("/api/v1/grids/g1/feeds/f1");
    expect(JSON.parse(patch[2])).toEqual({ destinationId: "ctr-h" });
  });
});
