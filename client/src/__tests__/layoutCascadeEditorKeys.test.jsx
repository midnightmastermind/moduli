// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import LayoutCascadeEditor from "../ui/LayoutCascadeEditor.jsx";

const rowControl = (label) => {
  const span = screen.getAllByText(label).find((el) => el.tagName === "SPAN");
  return span.parentElement.querySelector("input, button");
};

describe("LayoutCascadeEditor — keys poms' layouts carry", () => {
  it("a wrap surface can set its tiles' max width", () => {
    const onChange = vi.fn();
    render(<LayoutCascadeEditor value={{ mode: "wrap" }} onChange={onChange} />);
    const input = rowControl("Max width");
    fireEvent.change(input, { target: { value: "184" } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ mode: "wrap", childMaxWidth: 184 }));
  });

  it("hideFilterPill can be switched on", () => {
    const onChange = vi.fn();
    render(<LayoutCascadeEditor value={{ mode: "flex-row" }} onChange={onChange} />);
    fireEvent.click(rowControl("Hide filter pill"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ hideFilterPill: true }));
  });

  it("a stack surface still offers no max width (control)", () => {
    render(<LayoutCascadeEditor value={{ mode: "stack" }} onChange={() => {}} />);
    expect(screen.queryAllByText("Max width")).toHaveLength(0);
  });
});

describe("LayoutCascadeEditor — square size", () => {
  it("stores 184, not the 99 default cap", () => {
    const onChange = vi.fn();
    render(<LayoutCascadeEditor value={{ mode: "wrap" }} onChange={onChange} />);
    fireEvent.change(rowControl("Square size"), { target: { value: "184" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ childMinWidth: 184 }));
  });
});

describe("LayoutCascadeEditor — typing a number keystroke by keystroke", () => {
  it("typing 1, 18, 184 into a min-40 field ends at 184, never 40", () => {
    const calls = [];
    const Harness = () => {
      const [v, setV] = React.useState({ mode: "wrap" });
      return <LayoutCascadeEditor value={v} onChange={(n) => { calls.push(n?.childMinWidth); setV(n); }} />;
    };
    render(<Harness />);
    const input = rowControl("Square size");
    fireEvent.focus(input);
    for (const t of ["1", "18", "184"]) fireEvent.change(input, { target: { value: t } });
    fireEvent.blur(input);
    expect(calls).not.toContain(40);
    expect(calls.at(-1)).toBe(184);
    expect(input.value).toBe("184");
  });

  it("an out-of-range value is clamped on blur", () => {
    const onChange = vi.fn();
    render(<LayoutCascadeEditor value={{ mode: "wrap" }} onChange={onChange} />);
    const input = rowControl("Square size");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "5" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ childMinWidth: 40 }));
  });
});
