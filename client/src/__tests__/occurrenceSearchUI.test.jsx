// __tests__/occurrenceSearchUI.test.jsx
import { describe, it, expect, vi, beforeEach } from "vitest";
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
