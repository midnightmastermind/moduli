// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../ui/FeedSection.jsx", () => ({ default: () => <div data-testid="feed" /> }));
vi.mock("../PagePreviewApp.jsx", () => ({ PagePreviewBody: () => null }));

import NativeOffice, { NativePiece, nativeOfficeState, hasNativeBridge } from "../vr/NativeOffice.jsx";

const grid = { _id: "g1", meta: { vrOffice: {
  shelves: [{ id: "s1", title: "Books", asset: "book", feed: { conditions: [], scope: null } }],
  screens: [{ id: "sc1", source: "page", pageOccId: "p1" }],
} } };
const occurrencesById = { p1: { id: "p1", moduleId: "pm", label: "Routines" } };
const modulesById = { pm: { id: "pm", role: "page", label: "Routines" } };

afterEach(() => { delete window.ModuliNative; delete window.__moduliNative; });

describe("nativeOfficeState", () => {
  it("lists shelves (with an empty shelf holding nothing), screens with their page name, and decor", () => {
    const st = nativeOfficeState({ grid, occurrencesById, modulesById }, (id) => occurrencesById[id]?.label);
    expect(st.gridId).toBe("g1");
    expect(st.shelves).toEqual([{ id: "s1", title: "Books", asset: "book", items: [] }]);
    expect(st.screens[0]).toMatchObject({ id: "sc1", label: "Routines" });
    expect(st.decor.map((d) => d.key)).toContain("armchair");
  });
});

describe("NativeOffice", () => {
  it("is only used when the app's bridge is there", () => {
    expect(hasNativeBridge()).toBe(false);
    window.ModuliNative = { postMessage: () => {} };
    expect(hasNativeBridge()).toBe(true);
  });

  it("sends its state, and holds only room-wide controls (no piece settings)", () => {
    const sent = [];
    window.ModuliNative = { postMessage: (s) => sent.push(JSON.parse(s)) };
    render(<NativeOffice grid={grid} occurrencesById={occurrencesById} modulesById={modulesById} dispatch={() => {}} />);
    expect(sent.some((m) => m.type === "state")).toBe(true);
    expect(sent.some((m) => m.type === "ready")).toBe(true);
    expect(screen.queryByTestId("feed")).toBeNull();
    expect(screen.getByText("Mixed reality")).toBeTruthy();
  });

  it("Move furniture starts off, and its switch asks the headset to turn it on", () => {
    const sent = [];
    window.ModuliNative = { postMessage: (s) => sent.push(JSON.parse(s)) };
    render(<NativeOffice grid={grid} occurrencesById={occurrencesById} modulesById={modulesById} dispatch={() => {}} />);
    fireEvent.click(screen.getByText(/Move furniture: Off/));
    expect(sent.at(-1)).toEqual({ type: "moveMode", on: true });
  });
});

describe("NativePiece (one piece's own settings window)", () => {
  it("shows that shelf's settings, sends no state, and Done closes the window", () => {
    const sent = [];
    window.ModuliNative = { postMessage: (s) => sent.push(JSON.parse(s)) };
    render(<NativePiece pieceKey="shelf:s1" grid={grid} occurrencesById={occurrencesById} modulesById={modulesById} dispatch={() => {}} />);
    expect(screen.getByTestId("feed")).toBeTruthy();
    expect(sent.some((m) => m.type === "state")).toBe(false);
    fireEvent.click(screen.getByText("Done"));
    expect(sent.at(-1)).toEqual({ type: "closePiece", key: "shelf:s1" });
  });

  it("decor can be removed from its own window, with no confirm (it never shows in a headset)", () => {
    const sent = [];
    window.ModuliNative = { postMessage: (s) => sent.push(JSON.parse(s)) };
    render(<NativePiece pieceKey="decor:abc" grid={grid} occurrencesById={occurrencesById} modulesById={modulesById} dispatch={() => {}} />);
    fireEvent.click(screen.getByText("Remove"));
    expect(sent.at(-1)).toEqual({ type: "delete", key: "decor:abc" });
  });
});
