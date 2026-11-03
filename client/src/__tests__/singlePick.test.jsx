// __tests__/singlePick.test.jsx — the ONE single-choice picker (deep UI sweep, Task 6b; user 2026-11-03 14:10:
// "if we have a custom multiselect picker or select picker … reuse it as much as possible").
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SinglePick from "../ui/pickers/SinglePick.jsx";

const OPTIONS = [{ value: "a", label: "Alpha" }, { value: "b", label: "Beta" }, { value: "c", label: "Gamma", hint: "3rd" }];
const open = (name = /choose/i) => fireEvent.click(screen.getByRole("button", { name }));

describe("SinglePick", () => {
  it("shows the chosen label on its trigger, the placeholder when none", () => {
    const { rerender } = render(<SinglePick options={OPTIONS} value={null} onChange={() => {}} placeholder="Pick one" ariaLabel="Choose letter" />);
    expect(screen.getByRole("button", { name: /choose letter/i }).textContent).toMatch(/Pick one/);
    rerender(<SinglePick options={OPTIONS} value="b" onChange={() => {}} ariaLabel="Choose letter" />);
    expect(screen.getByRole("button", { name: /choose letter/i }).textContent).toMatch(/Beta/);
  });

  it("picking hands back the value and closes", () => {
    const onChange = vi.fn();
    render(<SinglePick options={OPTIONS} value={null} onChange={onChange} ariaLabel="Choose letter" />);
    open();
    fireEvent.click(screen.getByText("Beta"));
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByText("Gamma")).toBeNull();
  });

  it("picking the chosen option again clears it", () => {
    const onChange = vi.fn();
    render(<SinglePick options={OPTIONS} value="b" onChange={onChange} ariaLabel="Choose letter" />);
    open();
    fireEvent.click(screen.getByRole("option", { name: /Beta/ }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("clearable={false} keeps the choice when it is picked again", () => {
    const onChange = vi.fn();
    render(<SinglePick options={OPTIONS} value="b" onChange={onChange} clearable={false} ariaLabel="Choose letter" />);
    open();
    fireEvent.click(screen.getByRole("option", { name: /Beta/ }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("marks only the chosen option, with a check", () => {
    render(<SinglePick options={OPTIONS} value="c" onChange={() => {}} ariaLabel="Choose letter" />);
    open();
    const opts = screen.getAllByRole("option");
    expect(opts.map((o) => o.getAttribute("aria-selected"))).toEqual(["false", "false", "true"]);
    expect(opts[2].querySelector("svg")).not.toBeNull();
    expect(opts[0].querySelector("svg")).toBeNull();
  });

  it("a custom trigger is used and still opens the list", () => {
    render(<SinglePick options={OPTIONS} value="a" onChange={() => {}} renderTrigger={(label) => <button type="button" aria-label="Pill">P:{label}</button>} />);
    expect(screen.getByRole("button", { name: "Pill" }).textContent).toBe("P:Alpha");
    open("Pill");
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });

  it("search appears for a long list and Enter takes the top match", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ value: `v${i}`, label: `Item ${i}` }));
    const onChange = vi.fn();
    render(<SinglePick options={many} value={null} onChange={onChange} ariaLabel="Choose item" />);
    open();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: "item 11" } });
    fireEvent.keyDown(screen.getByPlaceholderText(/search/i), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("v11");
  });
});
