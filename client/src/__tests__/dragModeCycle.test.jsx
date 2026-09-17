/**
 * dragModeCycle.test.jsx
 *
 * COPY-LINK IS THE THIRD RADIAL OPTION — and only where the drop path can
 * honour it.
 *
 * The radial handle used to toggle two ways (`move ? "copy" : "move"`), so
 * copy-link was unreachable from it, and it drew the MOVE icon for a
 * copylink-mode row. Both are fixed here.
 *
 * The load-bearing half is the NARROWING, not the widening: only
 * `handleOccurrenceMove` runs `copylinkInstanceToContainer`, so only an
 * instance may offer the mode. A container/panel/doc-embed offering it would
 * write `dragMode:"copylink"` that its own drop path ignores — a control that
 * looks like it works and does nothing.
 */
import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  DRAG_MODES,
  DEFAULT_DRAG_MODES,
  INSTANCE_DRAG_MODES,
  nextDragMode,
  dragModeMeta,
  dragModeItem,
} from "../helpers/dragModes";
import RadialMenu from "../ui/RadialMenu";

afterEach(() => cleanup());

describe("nextDragMode — the cycle is over an ALLOWED list", () => {
  test("an instance cycles all three: move → copy → copylink → move", () => {
    expect(nextDragMode("move", INSTANCE_DRAG_MODES)).toBe("copy");
    expect(nextDragMode("copy", INSTANCE_DRAG_MODES)).toBe("copylink");
    expect(nextDragMode("copylink", INSTANCE_DRAG_MODES)).toBe("move");
  });

  // THE CONTROL. Without this, "copy-link is reachable" is also satisfied by a
  // build that offers it on every surface, which is the inert-control bug.
  test("the default list stays TWO-WAY and can never reach copylink", () => {
    expect(nextDragMode("move", DEFAULT_DRAG_MODES)).toBe("copy");
    expect(nextDragMode("copy", DEFAULT_DRAG_MODES)).toBe("move");
    expect(DEFAULT_DRAG_MODES).not.toContain("copylink");
  });

  test("no argument is the default list, not the full one", () => {
    expect(nextDragMode("copy")).toBe("move");
  });

  test("a mode the list no longer allows cycles to the first allowed one", () => {
    // e.g. an instance set to copylink, then converted to a container.
    expect(nextDragMode("copylink", DEFAULT_DRAG_MODES)).toBe("move");
    expect(nextDragMode("nonsense", INSTANCE_DRAG_MODES)).toBe("move");
  });

  test("an empty or malformed allowed list falls back rather than throwing", () => {
    expect(nextDragMode("move", [])).toBe("copy");
    expect(nextDragMode("move", null)).toBe("copy");
  });
});

describe("dragModeMeta", () => {
  test("every known mode has its own icon, name and colour", () => {
    const seen = DRAG_MODES.map(dragModeMeta);
    expect(new Set(seen.map(m => m.name)).size).toBe(3);
    expect(new Set(seen.map(m => m.Icon)).size).toBe(3);
    expect(new Set(seen.map(m => m.color)).size).toBe(3);
    expect(dragModeMeta("copylink").name).toBe("Copy-link");
  });

  test("an unknown mode still draws a handle rather than nothing", () => {
    expect(dragModeMeta("from-a-newer-build").Icon).toBe(dragModeMeta("move").Icon);
  });
});

describe("dragModeItem — one definition for both call sites", () => {
  test("the item is labelled for the NEXT mode and carries the click", () => {
    const onClick = vi.fn();
    const item = dragModeItem({ dragMode: "copy", allowed: INSTANCE_DRAG_MODES, onClick });
    expect(item.label).toBe("Set to Copy-link");
    expect(item.icon).toBe(dragModeMeta("copylink").Icon);
    expect(item.color).toBe(dragModeMeta("copylink").color);
    item.onClick();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("on a two-way surface the item never offers copy-link", () => {
    expect(dragModeItem({ dragMode: "copy" }).label).toBe("Set to Move");
  });
});

describe("RadialMenu — the handle names the CURRENT mode", () => {
  const renderMenu = (dragMode, allowed = INSTANCE_DRAG_MODES) =>
    render(
      <RadialMenu
        dragMode={dragMode}
        allowedDragModes={allowed}
        onToggleDragMode={() => {}}
        onSettings={() => {}}
      />
    );

  test.each(DRAG_MODES)("%s mode reads as itself, not as Move", (mode) => {
    renderMenu(mode);
    const handle = screen.getByTestId("radial-handle");
    expect(handle.getAttribute("title")).toContain(dragModeMeta(mode).name);
  });

  // The defect this replaces: a copylink row drew the Move icon and said
  // "Move mode", which is a lie about what the drag will do.
  test("a copylink row does NOT claim to be in Move mode", () => {
    renderMenu("copylink");
    expect(screen.getByTestId("radial-handle").getAttribute("title")).not.toContain("Move mode");
  });

  test("opening an instance's menu in copy mode offers Copy-link", () => {
    renderMenu("copy");
    fireEvent.click(screen.getByTestId("radial-handle"));
    expect(screen.getByTitle("Set to Copy-link")).toBeTruthy();
  });

  test("opening a two-way surface's menu offers Move, never Copy-link", () => {
    renderMenu("copy", DEFAULT_DRAG_MODES);
    fireEvent.click(screen.getByTestId("radial-handle"));
    expect(screen.getByTitle("Set to Move")).toBeTruthy();
    expect(screen.queryByTitle("Set to Copy-link")).toBeNull();
  });
});

describe("only the surface whose drop path runs copylink may offer it", () => {
  const read = (p) => readFileSync(resolve(__dirname, p), "utf-8");

  // POSITIVE CONTROL — without it, "nobody offers copylink" passes against a
  // build where the feature was never wired at all.
  test("ModuleInstance offers the three-mode list", () => {
    expect(read("../modules/ModuleInstance.jsx")).toContain("INSTANCE_DRAG_MODES");
  });

  test.each([
    ["ModuleContainer.jsx", "../modules/ModuleContainer.jsx"],
    ["ModulePanel.jsx", "../modules/ModulePanel.jsx"],
    ["InstanceTextblockNode.jsx", "../docs/pills/InstanceTextblockNode.jsx"],
  ])("%s does not — its drop path ignores copylink", (_name, path) => {
    expect(read(path)).not.toContain("INSTANCE_DRAG_MODES");
  });
});
