// __tests__/confirmList.test.jsx
//
// The multi-select confirmation behind `link-follow`. What matters here is that
// it cannot commit something the user did not tick, and that the SCALE of what
// the button is about to do is on the button.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ConfirmList, { openConfirmList, registerConfirmListHost } from "../ui/ConfirmListHost";

afterEach(cleanup);

const items = [
  { id: "u1", label: "Page A", sub: "https://example.com/a" },
  { id: "u2", label: "Page B", sub: "https://example.com/b" },
  { id: "u3", label: "Page C", sub: "https://example.com/c" },
];

describe("ConfirmList", () => {
  it("starts with everything ticked and states the count on the button", () => {
    // A scope control, not a recommendation: the user already asked for this.
    render(<ConfirmList title="Import which pages?" items={items} onConfirm={vi.fn()} />);
    expect(screen.getByTestId("confirm-list-go")).toHaveTextContent("Import 3");
  });

  it("confirms ONLY the ticked ids", () => {
    const onConfirm = vi.fn();
    render(<ConfirmList title="t" items={items} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByTestId("confirm-item-u2"));
    expect(screen.getByTestId("confirm-list-go")).toHaveTextContent("Import 2");
    fireEvent.click(screen.getByTestId("confirm-list-go"));
    expect(onConfirm).toHaveBeenCalledWith(["u1", "u3"]);
  });

  it("keeps the ORIGINAL order regardless of the order they were ticked in", () => {
    const onConfirm = vi.fn();
    render(<ConfirmList title="t" items={items} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByTestId("confirm-list-cancel"));           // no-op, no handler
    fireEvent.click(screen.getByText("Select none"));
    fireEvent.click(screen.getByTestId("confirm-item-u3"));
    fireEvent.click(screen.getByTestId("confirm-item-u1"));
    fireEvent.click(screen.getByTestId("confirm-list-go"));
    expect(onConfirm).toHaveBeenCalledWith(["u1", "u3"]);
  });

  it("cannot confirm nothing", () => {
    const onConfirm = vi.fn();
    render(<ConfirmList title="t" items={items} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("Select none"));
    const go = screen.getByTestId("confirm-list-go");
    expect(go).toBeDisabled();
    fireEvent.click(go);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Select all re-ticks everything", () => {
    const onConfirm = vi.fn();
    render(<ConfirmList title="t" items={items} onConfirm={onConfirm} />);
    fireEvent.click(screen.getByText("Select none"));
    fireEvent.click(screen.getByText("Select all"));
    fireEvent.click(screen.getByTestId("confirm-list-go"));
    expect(onConfirm).toHaveBeenCalledWith(["u1", "u2", "u3"]);
  });

  it("Escape cancels and confirms NOTHING", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmList title="t" items={items} onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows each item's sub-line so a bare 'Read more' link is still identifiable", () => {
    render(<ConfirmList title="t" items={items} onConfirm={vi.fn()} />);
    expect(screen.getByText("https://example.com/b")).toBeInTheDocument();
  });
});

describe("openConfirmList", () => {
  it("REFUSES when no host is mounted, so the caller can decline to act", () => {
    // The whole point of this surface is that the heavy action does not happen
    // without a confirmation — "nowhere to ask" has to mean "do not do it".
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(openConfirmList({ title: "t", items, onConfirm: vi.fn() })).toBe(false);
    warn.mockRestore();
  });

  it("refuses an empty list rather than opening a dialog with nothing in it", () => {
    const unregister = registerConfirmListHost(vi.fn());
    expect(openConfirmList({ title: "t", items: [], onConfirm: vi.fn() })).toBe(false);
    unregister();
  });

  it("hands the request to the mounted host", () => {
    const host = vi.fn();
    const unregister = registerConfirmListHost(host);
    expect(openConfirmList({ title: "t", items, onConfirm: vi.fn() })).toBe(true);
    expect(host).toHaveBeenCalledWith(expect.objectContaining({ title: "t" }));
    unregister();
    expect(openConfirmList({ title: "t", items, onConfirm: vi.fn() })).toBe(false);
  });
});
