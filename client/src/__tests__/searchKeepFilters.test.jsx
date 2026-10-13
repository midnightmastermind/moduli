// Search › "Keep filters": the checkbox is there, and when ticked the list asks the filter keeper.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";

const keep = vi.fn((id) => id !== "hidden");
vi.mock("../helpers/filterKeep", () => ({ makeFilterKeeper: () => keep }));
const entries = ["shown", "hidden"].map((id) => ({ occId: id, label: `Water ${id}`, role: "instance", ancestorIds: [], pathLabels: [], pageOccId: "p", haystacks: null }));
vi.mock("../helpers/occurrenceSearch", () => ({
  getSearchIndex: () => ({ entries }),
  searchOccurrences: (index, term, opts) => {
    const res = index.entries.filter((e) => !opts.keep || opts.keep(e.occId)).map((entry) => ({ entry, why: null }));
    return { results: res, total: res.length };
  },
}));
const store = { getOccMap: () => ({}), getModMap: () => ({}), fieldsById: {}, grid: { _id: "g" } };
vi.mock("../GridActionsContext.js", () => ({ useGridActionsSelector: (fn) => fn(store) }));

import OccurrenceSearch from "../ui/OccurrenceSearch";

beforeEach(() => { localStorage.clear(); keep.mockClear(); vi.useFakeTimers(); });

async function open(container) {
  fireEvent.click(container.querySelector(".occ-search-trigger"));
  fireEvent.change(container.querySelector(".occ-search-input"), { target: { value: "water" } });
  await act(async () => { vi.advanceTimersByTime(200); });
}

describe("Search › Keep filters", () => {
  it("lists everything until ticked, then only what the filters keep — and remembers it", async () => {
    const { container } = render(<OccurrenceSearch />);
    await open(container);
    expect(document.querySelectorAll(".occ-search-row")).toHaveLength(2);
    fireEvent.click(document.querySelector('input[aria-label="Keep filters"]'));
    expect([...document.querySelectorAll(".occ-search-row")].map((r) => r.textContent)).toEqual([expect.stringContaining("shown")]);
    expect(localStorage.getItem("moduli-search-keepFilters")).toBe("1");
    vi.useRealTimers();
  });
});
