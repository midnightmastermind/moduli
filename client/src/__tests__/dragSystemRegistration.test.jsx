import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

const adapters = vi.hoisted(() => ({
  draggable: vi.fn(() => () => {}),
  dropTargetForElements: vi.fn(() => () => {}),
  dropTargetForExternal: vi.fn(() => () => {}),
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  draggable: adapters.draggable,
  dropTargetForElements: adapters.dropTargetForElements,
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop/external/adapter", () => ({
  dropTargetForExternal: adapters.dropTargetForExternal,
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop/combine", () => ({
  combine: (...fns) => () => fns.forEach((f) => typeof f === "function" && f()),
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop-auto-scroll/element", () => ({
  autoScrollForElements: () => () => {},
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview", () => ({
  setCustomNativeDragPreview: vi.fn(),
}));
vi.mock("@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge", () => ({
  attachClosestEdge: (d) => d,
  extractClosestEdge: () => null,
}));

beforeAll(() => {
  // jsdom has no matchMedia; force the DESKTOP path (_isTouch → false).
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});

import { useDragDrop, useDroppable } from "../helpers/dragSystem.js";

function DragProbe({ data, context, accepts = ["instance"] }) {
  // `accepts` gets a NEW array identity every render on purpose — the
  // stringified key must keep it registration-stable.
  const { ref } = useDragDrop({
    type: "instance", id: "m1", data, context, accepts,
  });
  return <div ref={ref} />;
}
function DropProbe({ context }) {
  const { ref } = useDroppable({ type: "container-list", id: "c1", context, accepts: ["instance"] });
  return <div ref={ref} />;
}

describe("dragSystem registration stability", () => {
  it("useDragDrop does NOT re-register when data/context identity changes", () => {
    const { rerender } = render(<DragProbe data={{ label: "a" }} context={{ containerId: "c1" }} />);
    const before = adapters.draggable.mock.calls.length;
    rerender(<DragProbe data={{ label: "b", big: { fields: { x: 1 } } }} context={{ containerId: "c1", panelId: "p" }} />);
    rerender(<DragProbe data={{ label: "c" }} context={{ containerId: "c2" }} />);
    expect(adapters.draggable.mock.calls.length).toBe(before);
  });

  it("getInitialData reads the LATEST data/context at drag time", () => {
    const { rerender } = render(<DragProbe data={{ label: "a" }} context={{ containerId: "c1" }} />);
    rerender(<DragProbe data={{ label: "b" }} context={{ containerId: "c9" }} />);
    const cfg = adapters.draggable.mock.calls.at(-1)[0];
    const payload = cfg.getInitialData();
    expect(payload.data.label).toBe("b");
    expect(payload.context.containerId).toBe("c9");
  });

  it("useDragDrop DOES re-register when accepts actually change", () => {
    // Same component type (no remount) — only the accepts CONTENT changes.
    const { rerender } = render(<DragProbe data={{ label: "a" }} context={{}} />);
    const before = adapters.draggable.mock.calls.length;
    rerender(<DragProbe data={{ label: "a" }} context={{}} accepts={["instance", "module"]} />);
    expect(adapters.draggable.mock.calls.length).toBeGreaterThan(before);
  });

  it("useDroppable does NOT re-register on context identity churn, and getData reads the latest context", () => {
    const { rerender } = render(<DropProbe context={{ containerId: "c1" }} />);
    const before = adapters.dropTargetForElements.mock.calls.length;
    rerender(<DropProbe context={{ containerId: "c1", extra: 1 }} />);
    expect(adapters.dropTargetForElements.mock.calls.length).toBe(before);
    const cfg = adapters.dropTargetForElements.mock.calls.at(-1)[0];
    expect(cfg.getData().context.extra).toBe(1);
  });
});
