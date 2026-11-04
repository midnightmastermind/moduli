// On a phone the notification stack is a bare count, so a message raised there ("nothing listens to this button",
// "could not play this file") never reached the screen (deep UI sweep 2026-11-04). A NEW notification flashes its
// text under the toolbar for a few seconds; the ones already there when the stack mounts do not.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act, screen } from "@testing-library/react";
import TransactionNotificationStack from "../ui/TransactionNotificationStack";
import { toast } from "../state/notificationStore";

afterEach(() => vi.useRealTimers());

describe("compact notification stack flashes a new message", () => {
  it("shows a new message as a status line, then hides it", () => {
    vi.useFakeTimers();
    act(() => { toast("already here"); });
    render(<TransactionNotificationStack compact />);
    expect(screen.queryByRole("status")).toBeNull();           // the backlog is not replayed
    act(() => { toast("Press: nothing listens to this button yet"); });
    expect(screen.getByRole("status").textContent).toMatch(/nothing listens/);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("the full stack (desktop) shows no extra line", () => {
    render(<TransactionNotificationStack />);
    act(() => { toast("desktop message"); });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

import { pushTxNotification } from "../state/notificationStore";
describe("only messages flash, not edit or operation pills", () => {
  it("a gesture pill or an op-run pill does not flash; an error does", () => {
    render(<TransactionNotificationStack compact />);
    act(() => { pushTxNotification({ kind: "success", label: "Schedule: Mark Passed Slots — update item" }); });
    expect(screen.queryByRole("status")).toBeNull();
    act(() => { pushTxNotification({ kind: "error", label: "Op failed: boom" }); });
    expect(screen.getByRole("status").textContent).toMatch(/boom/);
  });
});
