// __tests__/searchIndexPerOpen.test.jsx
// An open search keeps the index it built for its first query. Measured 2026-11-02 on a phone (4x CPU): while the
// app's load sweep was writing, every write gave the occurrence map a new identity and EVERY debounced keystroke
// rebuilt the whole-grid index (seconds each). One build per open; closing and reopening sees new rows.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const modulesById = { m: { id: "m", role: "instance", label: "Drink Water" }, mp: { id: "mp", role: "page", kind: "board", label: "Routines" } };
let occurrencesById = {
  page1: { id: "page1", moduleId: "mp", occurrences: ["a"] },
  a: { id: "a", moduleId: "m", label: "Drink Water" },
};
vi.mock("../GridActionsContext.js", () => ({
  useGridActionsSelector: (sel) => sel({
    getOccMap: () => occurrencesById,
    getModMap: () => modulesById,
    fieldsById: {}, grid: { _id: "g1" }, state: { grid: { _id: "g1" } },
  }),
}));
const spy = vi.hoisted(() => ({ n: 0 }));
vi.mock("../helpers/occurrenceSearch", async (orig) => {
  const real = await orig();
  return { ...real, getSearchIndex: (args) => { spy.n++; return real.buildSearchIndex(args); } };
});
import OccurrenceSearch from "../ui/OccurrenceSearch.jsx";

afterEach(() => { spy.n = 0; });

describe("search index per open", () => {
  it("typing more after the grid changed does not rebuild the index", async () => {
    render(<OccurrenceSearch onPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "dri" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    const afterFirst = spy.n;
    occurrencesById = { ...occurrencesById }; // a write: new identity
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "drink" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    expect(afterFirst).toBe(1);
    expect(spy.n).toBe(1);
  });

  it("closing and opening again searches the current grid (a new row is found)", async () => {
    render(<OccurrenceSearch onPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "drink" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(1));
    occurrencesById = { ...occurrencesById, b: { id: "b", moduleId: "m", label: "Drink Tea" }, page1: { ...occurrencesById.page1, occurrences: ["a", "b"] } };
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "drink" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
  });
});
