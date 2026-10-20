// UI sweep 2026-10-19 (row 2): the toolbar date picker ignored Escape — only an outside click
// closed it. It closes on Escape now, before any dropdown it sits inside.
import React from "react";
import { describe, it, expect } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import NavPickerPopover from "../ui/NavPickerPopover";

describe("NavPickerPopover", () => {
  it("closes on Escape, and the key goes no further", () => {
    const { getByTitle, container } = render(<NavPickerPopover value="2026-10-19" onCommit={() => {}} />);
    const trigger = getByTitle(/Pick date/);
    act(() => { fireEvent.click(trigger); });
    const opened = document.body.querySelectorAll(".rmdp-wrapper, .rmdp-calendar").length;
    expect(opened).toBeGreaterThan(0);
    let reachedDocument = false;
    const spy = () => { reachedDocument = true; };
    document.addEventListener("keydown", spy);
    act(() => { fireEvent.keyDown(container, { key: "Escape" }); });
    document.removeEventListener("keydown", spy);
    expect(document.body.querySelectorAll(".rmdp-wrapper, .rmdp-calendar").length).toBe(0);
    expect(reachedDocument).toBe(false);
  });
});
