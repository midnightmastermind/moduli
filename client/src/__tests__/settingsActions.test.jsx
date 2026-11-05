// @vitest-environment jsdom
// Convert, Export to Markdown and Add a button live in Settings, not on the radial arc (user, 2026-11-05).
import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import fs from "node:fs";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import SettingsActions, { splitConvertItems } from "../ui/SettingsActions";

afterEach(cleanup);

describe("SettingsActions", () => {
  it("draws nothing when there is nothing to do", () => {
    const { container } = render(<SettingsActions items={[null]} />);
    expect(container.innerHTML).toBe("");
  });
  it("a container's Convert submenu and an embed's To pill land in one Convert row, named by the target", () => {
    render(<SettingsActions items={[
      { label: "To pill", group: "Convert", onClick: () => {} },
      { label: "Convert", submenu: [{ label: "Doc", onClick: () => {} }, { label: "Table", onClick: () => {} }] },
      { label: "Export to Markdown", onClick: () => {} },
    ]} />);
    expect(screen.getByText("Convert to")).toBeTruthy();
    for (const name of ["Pill", "Doc", "Table", "Export to Markdown"]) expect(screen.getByRole("button", { name })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Convert" })).toBeNull();
  });
  it("closes Settings, then runs the item", () => {
    const order = [];
    render(<SettingsActions items={[{ label: "Add a button…", onClick: () => order.push("run") }]} onClose={() => order.push("close")} />);
    fireEvent.click(screen.getByRole("button", { name: "Add a button…" }));
    expect(order).toEqual(["close", "run"]);
  });
  it("splits an embed's Convert entries from the rest of its arc", () => {
    const pill = { label: "To pill", group: "Convert" }; const pos = { label: "Position" };
    expect(splitConvertItems([pill, pos, null])).toEqual({ arc: [pos], convert: [pill] });
  });
});

describe("the arc", () => {
  const src = fs.readFileSync(`${process.cwd()}/src/ui/RadialMenu.jsx`, "utf8");
  it("carries no Filter Override, Apply Template or History", () => {
    for (const label of ["Filter Override", "Apply Template", '"History"']) expect(src.includes(`label: ${label.startsWith('"') ? label : `"${label}"`}`)).toBe(false);
  });
  it("a row's eye says Label, a container's Header", () => {
    expect(fs.readFileSync(`${process.cwd()}/src/modules/ModuleInstance.jsx`, "utf8")).toMatch(/headerNoun="Label"/);
    expect(src).toMatch(/headerNoun = "Header"/);
  });
});

describe("wiring", () => {
  const read = (f) => fs.readFileSync(`${process.cwd()}/src/${f}`, "utf8");
  const arcs = ["modules/ModuleContainer.jsx", "modules/ModuleInstance.jsx", "modules/ModulePage.jsx", "modules/ModulePanel.jsx", "docs/pills/InstanceTextblockNode.jsx"];
  it.each(arcs)("%s no longer puts them on the arc, and hands them to Settings", (f) => {
    const src = read(f);
    for (const line of src.split("\n").filter((l) => /extraItems=\{/.test(l))) expect(line).not.toMatch(/exportMarkdownItem|buttonItem|convertRadialItems|convertLeafItems/);
    expect(src).toMatch(/settingsActions|SettingsActions|actions=\{\[buttonItem/);
    expect(src).toMatch(/buttonItem\(/); // still built
    expect(src).toMatch(/historyItem\(/); // every occurrence offers its history
    expect(src).not.toMatch(/onHistory=|onTemplate=|onFilter=/);
  });
  it.each(["ui/InstanceForm.jsx", "ui/ContainerForm.jsx", "ui/LayoutForm.jsx"])("%s draws them", (f) => {
    expect(read(f)).toMatch(/<SettingsActions/);
  });
});
