// @vitest-environment jsdom
// Three looks only the seed could set (2026-10-14 rebuild audit): mediaInline
// (187 poms rows), headerBand:false (489 slot containers), cardChrome (4).
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../ui/StyleEditor", () => ({ default: () => null }));
vi.mock("../ui/GraphSection", () => ({ default: () => null }));
vi.mock("../ui/EditorBindingSection.jsx", () => ({ default: () => null }));
vi.mock("../ui/FieldBindingsEditor.jsx", () => ({ default: () => null }));
vi.mock("../ui/LayoutCascadeSection", () => ({ default: () => null }));
vi.mock("../ui/FieldVisibilitySection", () => ({ default: () => null }));
vi.mock("../GridActionsContext", () => ({ useGridActions: () => ({ occurrencesById: {}, modulesById: {}, fieldsById: {}, state: {}, fields: [] }) }));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }) => <div>{children}</div>, TabsList: ({ children }) => <div>{children}</div>,
  TabsTrigger: ({ children }) => <button>{children}</button>, TabsContent: ({ children }) => <div>{children}</div>,
}));
const updateModule = vi.fn();
vi.mock("../helpers/CommitHelpers", () => ({ updateModule: (a) => updateModule(a), updateOccurrence: vi.fn() }));
import ContainerForm from "../ui/ContainerForm.jsx";
import InstanceForm from "../ui/InstanceForm.jsx";

describe("container looks", () => {
  it("unticking Header band writes headerBand:false and keeps other meta", () => {
    const onContainerUpdate = vi.fn();
    render(<ContainerForm container={{ id: "c", meta: { keep: 1 } }} occurrence={{ id: "o" }} containerId="c" onContainerUpdate={onContainerUpdate} />);
    const box = screen.getByLabelText("Header band");
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(onContainerUpdate).toHaveBeenCalledWith({ meta: { keep: 1, headerBand: false } });
  });
  it("ticking Header band back removes the key", () => {
    const onContainerUpdate = vi.fn();
    render(<ContainerForm container={{ id: "c", meta: { headerBand: false } }} occurrence={{ id: "o" }} containerId="c" onContainerUpdate={onContainerUpdate} />);
    fireEvent.click(screen.getByLabelText("Header band"));
    expect(onContainerUpdate).toHaveBeenCalledWith({ meta: {} });
  });
  it("Card frame when nested writes cardChrome:true", () => {
    const onContainerUpdate = vi.fn();
    render(<ContainerForm container={{ id: "c", meta: {} }} occurrence={{ id: "o" }} containerId="c" onContainerUpdate={onContainerUpdate} />);
    fireEvent.click(screen.getByLabelText("Card frame when nested"));
    expect(onContainerUpdate).toHaveBeenCalledWith({ meta: { cardChrome: true } });
  });
});

describe("instance look", () => {
  it("Picture inline with label writes module meta.mediaInline", () => {
    updateModule.mockClear();
    render(<InstanceForm instance={{ id: "m", role: "instance", meta: { keep: 1 } }} occurrence={{ id: "o" }} value={{ label: "x" }} onChange={() => {}} />);
    fireEvent.click(screen.getByLabelText("Picture inline with label"));
    expect(updateModule.mock.calls.at(-1)[0].module.meta).toEqual({ keep: 1, mediaInline: true });
  });
});
