// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

const editors = [];
vi.mock("../ui/StyleEditor", () => ({ default: (p) => { editors.push(p); return null; } }));
vi.mock("../ui/GraphSection", () => ({ default: () => null }));
vi.mock("../ui/EditorBindingSection.jsx", () => ({ default: () => null }));
vi.mock("../ui/FieldBindingsEditor.jsx", () => ({ default: () => null }));
vi.mock("../ui/LayoutCascadeSection", () => ({ default: () => null }));
vi.mock("../GridActionsContext", () => ({ useGridActions: () => ({ occurrencesById: {}, modulesById: {}, fieldsById: {}, state: {} }) }));
// Tabs render every panel so the Style tab's editors mount.
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }) => <div>{children}</div>, TabsList: ({ children }) => <div>{children}</div>,
  TabsTrigger: ({ children }) => <button>{children}</button>, TabsContent: ({ children }) => <div>{children}</div>,
}));
import ContainerForm from "../ui/ContainerForm.jsx";

const byLabel = (l) => editors.filter((e) => e.label === l).at(-1);

describe("ContainerForm › Style — Own starts a rule where none exists", () => {
  it("Child Instance Defaults: Own writes an empty childInstanceStyle", () => {
    editors.length = 0;
    const onContainerUpdate = vi.fn();
    render(<ContainerForm container={{ id: "c1", label: "C" }} occurrence={{ id: "o1" }} containerId="c1" onContainerUpdate={onContainerUpdate} onOccurrenceStyleChange={() => {}} />);
    byLabel("Child Instance Defaults (pushed down)").onStyleModeChange("own");
    expect(onContainerUpdate).toHaveBeenCalledWith({ childInstanceStyle: {} });
  });
  it("This Placement: Own writes an empty occurrence style", () => {
    editors.length = 0;
    const onOcc = vi.fn();
    render(<ContainerForm container={{ id: "c1", label: "C" }} occurrence={{ id: "o1" }} containerId="c1" onContainerUpdate={() => {}} onOccurrenceStyleChange={onOcc} />);
    byLabel("This Placement (overrides module)").onStyleModeChange("own");
    expect(onOcc).toHaveBeenCalledWith({});
  });
  it("an existing rule is kept when Own is picked again (control)", () => {
    editors.length = 0;
    const onContainerUpdate = vi.fn();
    render(<ContainerForm container={{ id: "c1", label: "C", childInstanceStyle: { bg: "#123456" } }} occurrence={{ id: "o1" }} containerId="c1" onContainerUpdate={onContainerUpdate} onOccurrenceStyleChange={() => {}} />);
    byLabel("Child Instance Defaults (pushed down)").onStyleModeChange("own");
    expect(onContainerUpdate).not.toHaveBeenCalled();
  });
});
