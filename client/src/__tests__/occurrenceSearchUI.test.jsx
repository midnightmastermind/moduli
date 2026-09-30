// __tests__/occurrenceSearchUI.test.jsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import OccurrenceSearch from "../ui/OccurrenceSearch.jsx";

const modulesById = {
  mp: { id: "mp", role: "page", kind: "board", label: "Routines" },
  m: { id: "m", role: "instance", kind: "list", label: "Drink Water" },
};
const occurrencesById = {
  page1: { id: "page1", gridId: "g1", moduleId: "mp", occurrences: ["a", "b"] },
  a: { id: "a", gridId: "g1", moduleId: "m", label: "Drink Water" },
  b: { id: "b", gridId: "g1", moduleId: "m", label: "Water Bottle" },
};

vi.mock("../GridActionsContext.js", () => ({
  useGridActionsSelector: (sel) => sel({
    occurrencesById,
    modulesById,
    fieldsById: {},
    grid: { _id: "g1" },
    state: { grid: { _id: "g1" } },
  }),
}));

beforeEach(() => vi.clearAllMocks());
// A test that fails BEFORE its own useRealTimers() leaves fake timers armed, and
// the next test's waitFor then hangs to its 5s timeout — a cascade that reads as
// two broken tests instead of one wrong expectation.
afterEach(() => vi.useRealTimers());

describe("OccurrenceSearch", () => {
  it("starts collapsed and expands to an input on click", () => {
    render(<OccurrenceSearch onPick={() => {}} />);
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("lists matches with their location once you type", async () => {
    render(<OccurrenceSearch onPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "water" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    expect(screen.getAllByText("Routines").length).toBeGreaterThan(0);
  });

  it("picks the highlighted row on Enter", async () => {
    const onPick = vi.fn();
    render(<OccurrenceSearch onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "water" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(typeof onPick.mock.calls[0][0]).toBe("string");
  });

  it("collapses and clears on Escape", async () => {
    render(<OccurrenceSearch onPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "water" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("says so when nothing matches", async () => {
    render(<OccurrenceSearch onPick={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "zzzzz" } });
    await waitFor(() => expect(screen.getByText("No matches")).toBeTruthy());
  });
});

// ── ENTER, BEFORE THE DEBOUNCE ──────────────────────────────────────────────
//
// User, 2026-09-30: *"the first time i do a search and press enter, it doesnt
// work, after that it works fine"*. The list waits 120ms before searching, and
// Enter inside that window read the results of a query that had not run — an
// empty list — so it picked nothing, silently. Measured on prod: Enter at 0ms
// and 60ms after the last keystroke did nothing; at 130ms it navigated. By the
// second try the results are already on screen, which is why it "works after".
describe("OccurrenceSearch — Enter while the query is still settling", () => {
  const typeThenEnter = (onPick, waitMs) => {
    render(<OccurrenceSearch onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "water" } });
    if (waitMs) vi.advanceTimersByTime(waitMs);
    fireEvent.keyDown(box, { key: "Enter" });
  };

  it("picks the first match even when Enter beats the debounce", () => {
    vi.useFakeTimers();
    const onPick = vi.fn();
    typeThenEnter(onPick, 0);                 // no results on screen yet
    expect(onPick).toHaveBeenCalledTimes(1);
    // "Water Bottle" — the search ranks a label match at the START first, which
    // is the same row the list would have shown 120ms later.
    expect(onPick.mock.calls[0][0]).toBe("b");
  });

  it("still picks the highlighted row once the list has caught up", async () => {
    const onPick = vi.fn();
    render(<OccurrenceSearch onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "water" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    fireEvent.keyDown(box, { key: "ArrowDown" });   // second row of the list on screen
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("a", expect.anything());
  });

  // The control: Enter on an empty box must still do nothing, or closing the
  // search with a stray Enter would open whatever happened to be first.
  it("does nothing on an empty query", () => {
    vi.useFakeTimers();
    const onPick = vi.fn();
    render(<OccurrenceSearch onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onPick).not.toHaveBeenCalled();
  });

  // A stale query runs fresh, so a row highlighted in the PREVIOUS list must not
  // decide which row of the NEW one is picked.
  it("ignores a stale highlight when it runs the query fresh", async () => {
    const onPick = vi.fn();
    render(<OccurrenceSearch onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /search/i }));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "water" } });
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    fireEvent.keyDown(box, { key: "ArrowDown" });          // second row of THIS list
    vi.useFakeTimers();
    fireEvent.change(box, { target: { value: "bottle" } }); // a different query, not yet run
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith("b", expect.anything());   // "Water Bottle", its only hit
  });
});

