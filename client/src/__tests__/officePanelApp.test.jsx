// The headset's control panel without the grid: the shelves come from the server, and the headset gets them.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

vi.mock("../socket", () => ({ socket: { connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn() } }));

const serverState = {
  type: "state", gridId: "g1", origin: "", shelves: [{ id: "s1", title: "Bookshelf", asset: "book", items: [{ id: "b1", title: "A book" }], path: [], canUp: false }],
  screens: [], decor: [{ key: "lamp", title: "Lamp" }], layout: null, bookmarks: [],
  dayPageId: "dp", notesFolderId: "nf", bookmarksBoardId: "bb",
  grid: { id: "g1", _id: "g1", userId: "u1", meta: { vrOffice: { shelves: [{ id: "s1", title: "Bookshelf", asset: "book" }], screens: [] } } },
  folders: [{ id: "nf", name: "Notes" }], hash: "h1",
};

describe("OfficePanelApp", () => {
  beforeEach(() => {
    localStorage.setItem("moduli-gridId", "g1");
    window.ModuliNative = { postMessage: vi.fn() };
  });
  it("asks the server for the office and hands the headset its state, not the grid", async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, opts) => {
      calls.push([url, JSON.parse(opts?.body || "{}")]);
      return { ok: true, json: async () => (calls.length > 1 ? { unchanged: true, hash: "h1" } : serverState) };
    });
    const { default: OfficePanelApp } = await import("../vr/OfficePanelApp.jsx");
    const { findByText } = render(<OfficePanelApp />);
    await findByText("+ Lamp", {}, { timeout: 20000 });
    const posted = () => window.ModuliNative.postMessage.mock.calls.map((c) => JSON.parse(c[0]));
    await waitFor(() => expect(posted().some((m) => m.type === "state")).toBe(true));
    const st = posted().find((m) => m.type === "state");
    expect(st.shelves[0].items[0].title).toBe("A book");
    expect(st).not.toHaveProperty("folders");
    expect(st).not.toHaveProperty("hash");
    expect(calls[0][0]).toBe("/api/v1/vr/office/state");
    // Asked again, it sends what it has: an unchanged answer is not a new state for the headset.
    expect(calls.every(([u]) => !String(u).includes("full_state"))).toBe(true);
  }, 30000);   // the panel's imports (the office menu) load slowly under the full suite's load
});
