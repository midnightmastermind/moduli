// The address picker auto-searches the row's name when it opens. A search typed while that one is still
// running must run, and its results must win even when the older response lands later
// (deep UI sweep 2026-11-03: typing "Madison" + Enter left the "Sweep Row" results on screen).
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, act, screen } from "@testing-library/react";
import AddressPickerMenu from "../ui/AddressPickerMenu";

const place = (label) => ({ label, address: `${label} street`, lat: 43, lon: -89, osmId: label });
afterEach(() => vi.unstubAllGlobals());

describe("address picker: the newest search wins", () => {
  it("a search typed during the opening search runs, and an older response cannot overwrite it", async () => {
    const pending = {};
    vi.stubGlobal("fetch", vi.fn((url) => new Promise((res) => {
      const q = new URL(url, "http://x").searchParams.get("q");
      pending[q] = () => res({ ok: true, json: async () => ({ results: [place(`${q} result`)], source: "test" }) });
    })));
    render(<AddressPickerMenu open initialQuery="Sweep Row" onPick={() => {}} onClose={() => {}} />);
    expect(pending["Sweep Row"]).toBeTruthy();                 // opening search started, still running

    const input = screen.getByPlaceholderText(/A place/);
    fireEvent.change(input, { target: { value: "Madison" } });
    fireEvent.submit(input.closest("form"));
    expect(pending["Madison"]).toBeTruthy();                   // the typed search ran

    await act(async () => { pending["Madison"](); });
    await act(async () => { pending["Sweep Row"](); });        // the older one lands LAST
    expect(screen.queryByText("Madison result")).toBeTruthy();
    expect(screen.queryByText("Sweep Row result")).toBeNull();
  });

  it("Enter is not blocked while a search runs (the submit button stays enabled)", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    render(<AddressPickerMenu open initialQuery="Sweep Row" onPick={() => {}} onClose={() => {}} />);
    const submit = screen.getByPlaceholderText(/A place/).closest("form").querySelector('button[type="submit"]');
    expect(submit.disabled).toBe(false);
  });
});

describe("address picker is a named, dismissible dialog", () => {
  it("has role=dialog named by its title, and Escape closes it", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const onClose = vi.fn();
    render(<AddressPickerMenu open title="Address" onPick={() => {}} onClose={onClose} />);
    expect(screen.getByRole("dialog", { name: "Address" })).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
