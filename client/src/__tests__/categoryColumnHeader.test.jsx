// A Command Center category column's header is where a category is NAMED. "+ Category" mints a
// folder called "New Category" in both the Fields and the Operations tab, but only the Fields tab
// could rename it — the Operations tab drew the name as a plain <span>, so every op category ever
// made in the UI stayed "New Category" (poms' 8 op categories were all seed-written).
import React from "react";
import fs from "fs";
import path from "path";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import CategoryColumnHeader from "../ui/commandCenter/CategoryColumnHeader.jsx";

describe("CategoryColumnHeader", () => {
  it("renames a category folder on blur", () => {
    const onRename = vi.fn();
    const { getByDisplayValue } = render(<CategoryColumnHeader label="New Category" folder={{ id: "f1" }} onRename={onRename} />);
    const input = getByDisplayValue("New Category");
    fireEvent.change(input, { target: { value: "  Trackers " } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith("Trackers");
  });

  it("writes nothing when the name is unchanged or blank", () => {
    const onRename = vi.fn();
    const { getByDisplayValue } = render(<CategoryColumnHeader label="Alarms" folder={{ id: "f1" }} onRename={onRename} />);
    const input = getByDisplayValue("Alarms");
    fireEvent.blur(input);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onRename).not.toHaveBeenCalled();
  });

  it("commits on Enter", () => {
    const onRename = vi.fn();
    const { getByDisplayValue } = render(<CategoryColumnHeader label="New Category" folder={{ id: "f1" }} onRename={onRename} />);
    const input = getByDisplayValue("New Category");
    fireEvent.change(input, { target: { value: "Alarms" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("Alarms");
  });

  it("the Uncategorized column (no folder) is not editable — control", () => {
    const { queryByRole, getByText } = render(<CategoryColumnHeader label="Uncategorized" folder={null} onRename={() => {}} />);
    expect(queryByRole("textbox")).toBeNull();
    expect(getByText("Uncategorized")).toBeTruthy();
  });

  it("both Command Center tabs draw their column headers with it", () => {
    for (const f of ["FieldsTab.jsx", "OperationsTab.jsx"]) {
      const src = fs.readFileSync(path.resolve(__dirname, "../ui/commandCenter", f), "utf8");
      expect(src, f).toMatch(/<CategoryColumnHeader\b/);
    }
  });
});
