// The Storage section of the Connections tab (plan 2026-09-24-connections-
// storage-gdrive, Tasks 4–5): lists connections, sets the default, starts the
// Google sign-in, and shows a revoked Drive as needing a reconnect.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

vi.mock("../helpers/authStorage", () => ({ sessionHeaders: () => ({ Authorization: "Bearer S" }) }));
import { StorageConnections } from "../ui/commandCenter/StorageConnections";

const listing = (defaultId = "server") => ({
  defaultConnectionId: defaultId,
  connections: [
    { id: "server", type: "server", name: "Server", status: "ok", removable: false, isDefault: defaultId === "server" },
    { id: "c1", type: "gdrive", name: "Google Drive (me@example.com)", status: "ok", removable: true, isDefault: defaultId === "c1" },
  ],
});
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });

let calls;
beforeEach(() => {
  calls = [];
  globalThis.fetch = vi.fn((url, init = {}) => {
    calls.push({ url, method: init.method || "GET", body: init.body, auth: init.headers?.Authorization });
    if (url === "/api/v1/connections") return ok(listing());
    if (url.endsWith("/health")) return ok({ ok: false, needsReconnect: true, message: "revoked" });
    if (url === "/api/v1/me/storage") return ok(listing(JSON.parse(init.body).defaultConnectionId));
    if (url === "/api/connections/google/start") return ok({ url: "https://accounts.google.com/o/oauth2/v2/auth?x=1" });
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
});
afterEach(cleanup);

describe("StorageConnections", () => {
  it("lists the Server and the Drive with the session, and flags a revoked Drive for reconnect", async () => {
    render(<StorageConnections />);
    expect(await screen.findByText(/Google Drive \(me@example.com\)/)).toBeTruthy();
    expect(screen.getByText(/this server's disk/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText("needs reconnect")).toBeTruthy());
    expect(screen.getByText("Reconnect")).toBeTruthy();
    expect(calls.every((c) => c.auth === "Bearer S")).toBe(true);
    expect(calls.some((c) => c.url === "/api/connections/server/health")).toBe(false);
  });

  it("choosing a connection makes it the default for new uploads", async () => {
    render(<StorageConnections />);
    const radio = (await screen.findByTestId("storage-conn-c1")).querySelector("input[type=radio]");
    fireEvent.click(radio);
    await waitFor(() => expect(calls.some((c) => c.url === "/api/v1/me/storage" && c.method === "PUT")).toBe(true));
    await waitFor(() => expect(screen.getByTestId("storage-conn-c1").querySelector("input").checked).toBe(true));
  });

  it("Connect Google Drive asks the server for the consent URL and goes there", async () => {
    const assign = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...orig, assign } });
    try {
      render(<StorageConnections />);
      fireEvent.click(await screen.findByText(/Connect Google Drive/));
      await waitFor(() => expect(assign).toHaveBeenCalledWith("https://accounts.google.com/o/oauth2/v2/auth?x=1"));
      expect(calls.find((c) => c.url === "/api/connections/google/start").method).toBe("POST");
    } finally { Object.defineProperty(window, "location", { configurable: true, value: orig }); }
  });
});
