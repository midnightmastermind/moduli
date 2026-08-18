import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// A tiny fake socket standing in for the real one, so no connection is opened.
const handlers = {};
const emitted = [];
const fakeSocket = {
  on: (ev, fn) => { (handlers[ev] ||= []).push(fn); },
  off: (ev, fn) => { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); },
  emit: (ev, payload) => emitted.push([ev, payload]),
};
const fire = (ev, payload) => (handlers[ev] || []).forEach((f) => f(payload));

vi.mock("../../socket.js", () => ({ socket: fakeSocket, emit: fakeSocket.emit }));

import LoginRoute from "../pages/LoginRoute.jsx";
import { readToken } from "../../helpers/authStorage.js";

const assign = vi.fn();

beforeEach(() => {
  localStorage.clear();
  emitted.length = 0;
  for (const k of Object.keys(handlers)) delete handlers[k];
  assign.mockClear();
  vi.stubGlobal("location", { ...window.location, assign, pathname: "/login" });
});

const mount = () =>
  render(<MemoryRouter initialEntries={["/login"]}><LoginRoute /></MemoryRouter>);

const fill = async () => {
  await waitFor(() => screen.getByLabelText(/email/i));
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "a@b.c" } });
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: "pw" } });
};

describe("LoginRoute", () => {
  it("emits login with the credentials", async () => {
    mount();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));
    expect(emitted).toContainEqual(["login", { email: "a@b.c", password: "pw" }]);
  });

  it("emits register when creating an account", async () => {
    mount();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    expect(emitted).toContainEqual(["register", { email: "a@b.c", password: "pw" }]);
  });

  // THE REGRESSION THIS ROUTE EXISTS TO AVOID. bindSocketToStore is the only
  // other writer of the token and it is bound from App.jsx, which is NOT
  // mounted here. Without this, a successful login stores nothing and the user
  // is returned to this same form forever.
  it("stores the session on auth_success", async () => {
    mount();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));
    fire("auth_success", { token: "tok-1", userId: "u-1" });
    expect(readToken()).toBe("tok-1");
  });

  it("navigates to the app on auth_success", async () => {
    mount();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));
    fire("auth_success", { token: "tok-1", userId: "u-1" });
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
  });

  it("shows the server's error and stores nothing", async () => {
    mount();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));
    fire("auth_error", "Invalid email or password");
    await waitFor(() => screen.getByText("Invalid email or password"));
    expect(readToken()).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  // Registering seeds a default workspace server-side — measured at ~51s
  // against Atlas. A button reading "Working…" for a minute is indistinguishable
  // from a hang, so the register path must say what is taking the time. Logging
  // in must NOT show it: it returns immediately, and the note would be a lie.
  it("says what the wait is for while registering, and only then", async () => {
    const { unmount } = mount();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /create account/i }));
    expect(screen.getByRole("status").textContent).toMatch(/takes up to a minute/i);
    unmount();

    mount();
    await fill();
    fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("refuses to submit with an empty field", async () => {
    mount();
    await waitFor(() => screen.getByLabelText(/email/i));
    fireEvent.click(screen.getByRole("button", { name: /^log in$/i }));
    expect(emitted).toEqual([]);
    expect(screen.getByText(/required/i)).toBeTruthy();
  });
});
