// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("../ui/FeedSection.jsx", () => ({ default: () => <div data-testid="feed" /> }));
vi.mock("../PagePreviewApp.jsx", () => ({ PagePreviewBody: () => null }));

import NativeOffice, { nativeOfficeState, hasNativeBridge } from "../vr/NativeOffice.jsx";

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

  it("sends its state, and a select from the headset opens that shelf's settings", () => {
    const sent = [];
    window.ModuliNative = { postMessage: (s) => sent.push(JSON.parse(s)) };
    render(<NativeOffice grid={grid} occurrencesById={occurrencesById} modulesById={modulesById} dispatch={() => {}} />);
    expect(sent.some((m) => m.type === "state")).toBe(true);
    expect(sent.some((m) => m.type === "ready")).toBe(true);
    act(() => window.__moduliNative.onEvent({ type: "select", key: "shelf:s1" }));
    expect(screen.getByTestId("feed")).toBeTruthy();
    fireEvent.click(screen.getByText("Turn ⟳"));
    expect(sent.at(-1)).toEqual({ type: "turn", key: "shelf:s1", deg: 45 });
  });
});
