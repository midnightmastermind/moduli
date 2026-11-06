// @vitest-environment jsdom
// A search opened while the grid was still arriving kept the index it was opened with, so rows that landed later
// (the catalogue, imported articles) never showed until it was closed and reopened, and it said "No matches"
// (found by the UI sweep 2026-11-06: "Bonsai" empty for 60s after a reload).
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import OccurrenceSearch from "../ui/OccurrenceSearch.jsx";

const store = {
  modulesById: { mp: { id: "mp", role: "page", kind: "board", label: "Routines" } },
  occurrencesById: { page1: { id: "page1", gridId: "g1", moduleId: "mp", occurrences: [] } },
  awaiting: true,
};
vi.mock("../GridActionsContext.js", () => ({
  useGridActionsSelector: (sel) => sel({
    occurrencesById: store.occurrencesById, modulesById: store.modulesById, fieldsById: {},
    grid: { _id: "g1" }, state: { grid: { _id: "g1" }, awaitingDeferred: store.awaiting },
  }),
}));

describe("a search opened during the load", () => {
  it("says it is still loading, then finds what arrives without being reopened", async () => {
    const { rerender } = render(<OccurrenceSearch onPick={() => {}} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Bonsai" } });
    await waitFor(() => expect(screen.getByText(/still loading/i)).toBeTruthy());

    store.modulesById = { ...store.modulesById, mb: { id: "mb", role: "container", kind: "doc", label: "Bonsai" } };
    store.occurrencesById = { ...store.occurrencesById, b1: { id: "b1", gridId: "g1", moduleId: "mb", parentId: "page1" } };
    store.awaiting = false;
    rerender(<OccurrenceSearch onPick={() => {}} />);
    await waitFor(() => expect(screen.getAllByText("Bonsai").length).toBeGreaterThan(0));
    expect(screen.queryByText(/still loading/i)).toBeNull();
  });
});
