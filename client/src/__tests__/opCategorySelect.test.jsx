// A scheduled operation's category was unreachable: scheduled ops appear in no category column and an
// alarm's editor is read-only, so poms' "Alarms" category was seed-written and shown nowhere.
import React from "react";
import fs from "fs";
import path from "path";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import OpCategorySelect, { groupOpsByCategory } from "../ui/commandCenter/OpCategorySelect.jsx";

const cats = [{ id: "c1", name: "Schedule Ops" }, { id: "c2", name: "Alarms" }];

describe("groupOpsByCategory", () => {
  it("groups in category order, Uncategorized last, empty groups dropped", () => {
    const ops = [{ id: "a", folderId: "c2" }, { id: "b" }, { id: "c", folderId: "c2" }];
    expect(groupOpsByCategory(ops, cats).map((g) => [g.label, g.ops.map((o) => o.id)]))
      .toEqual([["Alarms", ["a", "c"]], ["Uncategorized", ["b"]]]);
  });
  it("a folderId naming no known category reads as Uncategorized", () => {
    expect(groupOpsByCategory([{ id: "x", folderId: "gone" }], cats)[0].label).toBe("Uncategorized");
  });
});

describe("OpCategorySelect", () => {
  it("writes the picked category id, and null for Uncategorized", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(<OpCategorySelect value="c1" onChange={onChange} categoryFolders={cats} />);
    fireEvent.change(getByLabelText("Operation category"), { target: { value: "c2" } });
    fireEvent.change(getByLabelText("Operation category"), { target: { value: "" } });
    expect(onChange.mock.calls).toEqual([["c2"], [null]]);
  });
});

describe("OperationsTab wiring", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../ui/commandCenter/OperationsTab.jsx"), "utf8");
  const alarmBranch = src.slice(src.indexOf("Managed by the Alarms tab"), src.indexOf("<OperationEditor"));
  it("control: the alarm read-only branch is still there", () => {
    expect(alarmBranch.length).toBeGreaterThan(50);
  });
  it("the read-only alarm panel offers the category picker", () => {
    expect(alarmBranch).toMatch(/<OpCategorySelect\b/);
  });
  it("the Schedules list is grouped by category", () => {
    expect(src).toMatch(/groupOpsByCategory\(scheduledOps/);
  });
  it("the op editor uses the same picker", () => {
    expect(src.match(/<OpCategorySelect\b/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
