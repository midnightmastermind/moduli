// __tests__/destinationPicker.test.jsx
//
// User, 2026-09-16: *"theres got to be a search for choosing where to put the
// magic page (when i press the button) or anywhere else we choose where to place
// something. we need to use our components that allows search"*.
//
// The picker is `OptionSearchList` (the occurrence dropdown's own body) in its
// search-only mode. These pin the four things a destination list must do that a
// native <select> over hundreds of containers could not.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DestinationPicker from "../ui/DestinationPicker";
import { filterLocalOptions } from "../helpers/mergedOptionSearch";

const OPTIONS = [
  { id: "a", label: "Schedule › Wednesday › 9:00pm" },
  { id: "b", label: "Schedule › Wednesday › 9:30pm" },
  { id: "c", label: "Trackers › Stats" },
  { id: "d", label: "Tasks › Physical", hint: "container" },
];

const open = () => fireEvent.click(screen.getByRole("button", { name: /choose destination/i }));
const search = (q) => fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: q } });
const rows = () => OPTIONS.map(o => o.label).filter(l => screen.queryByText(l));

describe("DestinationPicker", () => {
  it("opens onto a search box, with every destination listed", () => {
    render(<DestinationPicker options={OPTIONS} value={null} onChange={() => {}} />);
    open();
    expect(screen.getByPlaceholderText(/search/i)).toBeTruthy();
    expect(rows()).toHaveLength(4);
  });

  it("narrows as you type, and matches words across the crumb chain in any order", () => {
    render(<DestinationPicker options={OPTIONS} value={null} onChange={() => {}} />);
    open();
    search("9:30pm schedule");
    expect(rows()).toEqual(["Schedule › Wednesday › 9:30pm"]);
  });

  it("picking hands back the id and closes", () => {
    const onChange = vi.fn();
    render(<DestinationPicker options={OPTIONS} value={null} onChange={onChange} />);
    open();
    fireEvent.click(screen.getByText("Trackers › Stats"));
    expect(onChange).toHaveBeenCalledWith("c");
    expect(screen.queryByPlaceholderText(/search/i)).toBeNull();
  });

  it("Enter takes the top match", () => {
    const onChange = vi.fn();
    render(<DestinationPicker options={OPTIONS} value={null} onChange={onChange} />);
    open();
    search("physical");
    fireEvent.keyDown(screen.getByPlaceholderText(/search/i), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("d");
  });

  it("an explicit none row hands back null, not a sentinel string", () => {
    const onChange = vi.fn();
    render(<DestinationPicker options={OPTIONS} value="a" onChange={onChange} noneLabel="None" />);
    open();
    fireEvent.click(screen.getByText("None"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("the trigger names the chosen destination", () => {
    render(<DestinationPicker options={OPTIONS} value="c" onChange={() => {}} />);
    expect(screen.getByRole("button", { name: /choose destination/i }).textContent).toContain("Trackers › Stats");
  });
});

describe("filterLocalOptions — every word, any order", () => {
  it("a single word is the old substring behaviour", () => {
    expect(filterLocalOptions(OPTIONS.map(o => ({ value: o.id, label: o.label })), "stats").map(o => o.value)).toEqual(["c"]);
  });
  it("two words must BOTH appear", () => {
    const opts = OPTIONS.map(o => ({ value: o.id, label: o.label }));
    expect(filterLocalOptions(opts, "wednesday 9:00").map(o => o.value)).toEqual(["a"]);
    expect(filterLocalOptions(opts, "trackers physical")).toEqual([]);
  });
});
