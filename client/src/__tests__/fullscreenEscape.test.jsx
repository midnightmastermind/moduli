// @vitest-environment jsdom
// Escape closes every popup in the app and did not leave a full-screen panel.
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";

vi.mock("../modules/ModulePanel", () => ({ default: () => <div data-testid="panel" /> }));
vi.mock("../ui/FormInput", () => ({ default: () => null }));
const { default: FullscreenOverlay } = await import("../ui/FullscreenOverlay");

afterEach(() => { cleanup(); document.body.innerHTML = ""; });
const mount = (extra) => { const close = vi.fn(); render(<>{extra}<FullscreenOverlay fullscreenPanelId="p" setFullscreenPanelId={close} panelsById={{ p: { id: "p" } }} panelProps={{}} cols={1} rows={1} /></>); return close; };

describe("Escape on a full-screen panel", () => {
  it("leaves full screen", () => {
    const close = mount();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(close).toHaveBeenCalledWith(null);
  });
  it("another key does nothing", () => {
    const close = mount();
    fireEvent.keyDown(document.body, { key: "a" });
    expect(close).not.toHaveBeenCalled();
  });
  it("not while typing", () => {
    const close = mount(<input data-testid="i" />);
    const i = document.querySelector("input"); i.focus();
    fireEvent.keyDown(i, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
  });
  it("not while typing in a document", () => {
    const close = mount(<div contentEditable suppressContentEditableWarning data-testid="d" />);
    fireEvent.keyDown(document.querySelector("[contenteditable]"), { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
  });
  it.each([".menu-surface", '[role="dialog"]', ".radial-menu-items", "[data-radix-popper-content-wrapper]"])("a popup on top goes first: %s", (sel) => {
    const el = document.createElement("div");
    if (sel.startsWith(".")) el.className = sel.slice(1);
    else { const m = /\[([a-z-]+)(?:="(.+)")?\]/.exec(sel); el.setAttribute(m[1], m[2] || ""); }
    document.body.appendChild(el);
    const close = mount();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(close).not.toHaveBeenCalled();
  });
  it("a handler that already used the key wins", () => {
    const close = mount();
    const e = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    e.preventDefault();
    document.body.dispatchEvent(e);
    expect(close).not.toHaveBeenCalled();
  });
});
