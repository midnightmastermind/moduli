// @vitest-environment jsdom
// `occurrence.hidden` (a row hidden by hand; selectors.isOccurrenceVisible) had no
// control: only an operation could set it, and nothing could clear it. poms hides
// 5 Trackers tiles that way (2026-10-14 rebuild audit).
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../ui/StyleEditor", () => ({ default: () => null }));
vi.mock("../ui/GraphSection", () => ({ default: () => null }));
vi.mock("../ui/EditorBindingSection.jsx", () => ({ default: () => null }));
vi.mock("../ui/FieldBindingsEditor.jsx", () => ({ default: () => null }));
vi.mock("../ui/LayoutCascadeSection", () => ({ default: () => null }));
vi.mock("../ui/FieldVisibilitySection", () => ({ default: () => null }));
const occs = {
  o: { id: "o", occurrences: ["a", "b"] },
  a: { id: "a", moduleId: "ma", label: "Cash", hidden: true },
  b: { id: "b", moduleId: "mb", label: "Steps" },
};
vi.mock("../GridActionsContext", () => ({ useGridActions: () => ({ occurrencesById: occs, modulesById: { ma: { id: "ma", label: "Cash" }, mb: { id: "mb" } }, fieldsById: {}, state: {}, fields: [], dispatch: () => {}, socket: {} }) }));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }) => <div>{children}</div>, TabsList: ({ children }) => <div>{children}</div>,
  TabsTrigger: ({ children }) => <button>{children}</button>, TabsContent: ({ children }) => <div>{children}</div>,
}));
const updateOccurrence = vi.fn();
vi.mock("../helpers/CommitHelpers", () => ({ updateModule: vi.fn(), updateOccurrence: (a) => updateOccurrence(a) }));
import ContainerForm from "../ui/ContainerForm.jsx";
import InstanceForm from "../ui/InstanceForm.jsx";
beforeEach(() => updateOccurrence.mockClear());

describe("hiding a row", () => {
  it("a row's Settings hides it (occurrence.hidden)", () => {
    render(<InstanceForm instance={{ id: "mb", role: "instance" }} occurrence={occs.b} value={{ label: "x" }} onChange={() => {}} />);
    const box = screen.getByLabelText("Hide this row");
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(updateOccurrence.mock.calls.at(-1)[0].occurrence).toEqual({ id: "b", hidden: true });
  });
  it("its container's Settings lists the hidden rows and shows one again", () => {
    render(<ContainerForm container={{ id: "c", meta: {} }} occurrence={occs.o} containerId="c" onContainerUpdate={() => {}} />);
    expect(screen.getByText("Cash")).toBeTruthy();
    expect(screen.queryByText("Steps")).toBeNull(); // CONTROL: a visible row is not listed
    fireEvent.click(screen.getByLabelText("Show Cash"));
    expect(updateOccurrence.mock.calls.at(-1)[0].occurrence).toEqual({ id: "a", hidden: false });
  });
});
