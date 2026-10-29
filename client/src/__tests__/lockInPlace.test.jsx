// A placement locked in place (user, 2026-10-29): *"you cant move it from the
// position but you can copy/copylink it. the lock would go in the radial menu …
// have tooltips up to know what each button does. also the lock should
// autoswitch from and block moving from grabbing the radial handle"*.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import RadialMenu from "../ui/RadialMenu";
import {
  isLockedInPlace, effectiveDragMode, dragModeOfData, allowedDragModesFor,
  planLockToggle, INSTANCE_DRAG_MODES,
} from "../helpers/dragModes";
import { dragModeOf } from "../helpers/dragSystem";

const locked = { id: "a", meta: { lockedInPlace: true } };
const free = { id: "b", meta: {} };

describe("the lock rule", () => {
  it("a locked placement never moves: a move becomes a copy", () => {
    expect(effectiveDragMode("move", locked)).toBe("copy");
    expect(effectiveDragMode(undefined, locked)).toBe("copy");
  });

  it("copy and copy-link still work on a locked placement", () => {
    expect(effectiveDragMode("copy", locked)).toBe("copy");
    expect(effectiveDragMode("copylink", locked)).toBe("copylink");
  });

  it("an unlocked placement keeps its mode (control)", () => {
    expect(effectiveDragMode("move", free)).toBe("move");
    expect(isLockedInPlace(free)).toBe(false);
    expect(isLockedInPlace({ locked: true })).toBe(false); // a doc's read-only switch is a different key
  });

  it("every drag path's mode reader applies it", () => {
    expect(dragModeOfData({ occurrence: { ...locked, dragMode: "move" } })).toBe("copy");
    expect(dragModeOfData({ occurrence: { dragMode: "move" } })).toBe("move");
    expect(dragModeOf({ data: { occurrence: { ...locked, dragMode: "move" } } })).toBe("copy");
  });

  it("while locked the menu offers no Move", () => {
    expect(allowedDragModesFor(INSTANCE_DRAG_MODES, true)).toEqual(["copy", "copylink"]);
    expect(allowedDragModesFor(["move"], true)).toEqual(["copy"]);
    expect(allowedDragModesFor(INSTANCE_DRAG_MODES, false)).toEqual(INSTANCE_DRAG_MODES);
  });

  it("locking a Move row switches it to Copy, and unlocking puts Move back", () => {
    const lock = planLockToggle({ id: "x", meta: { keep: 1 } }, "move");
    expect(lock).toMatchObject({ locked: true, dragMode: "copy" });
    expect(lock.meta).toMatchObject({ keep: 1, lockedInPlace: true });
    const unlock = planLockToggle({ id: "x", meta: lock.meta, dragMode: "copy" }, "copy");
    expect(unlock.locked).toBe(false);
    expect(unlock.dragMode).toBe("move");
    expect(unlock.meta).toEqual({ keep: 1 });
  });

  it("a mode the user picked is kept across lock and unlock", () => {
    const lock = planLockToggle({ id: "x", meta: {} }, "copylink");
    expect(lock.dragMode).toBeUndefined();
    const unlock = planLockToggle({ id: "x", meta: lock.meta }, "copylink");
    expect(unlock.dragMode).toBeUndefined();
  });
});

describe("the radial menu", () => {
  it("offers Lock, and Unlock once locked", () => {
    const onToggleLock = vi.fn();
    const { rerender } = render(<RadialMenu onSettings={() => {}} onToggleLock={onToggleLock} />);
    fireEvent.click(screen.getByTestId("radial-handle"));
    fireEvent.click(screen.getByTitle("Lock position (copy only)"));
    expect(onToggleLock).toHaveBeenCalledTimes(1);
    rerender(<RadialMenu onSettings={() => {}} onToggleLock={onToggleLock} locked dragMode="copy" />);
    fireEvent.click(screen.getByTestId("radial-handle"));
    expect(screen.getByTitle("Unlock position")).toBeTruthy();
  });

  it("a locked row's drag-mode submenu has no Move", () => {
    render(<RadialMenu onSettings={() => {}} onToggleLock={() => {}} locked dragMode="copy"
      allowedDragModes={INSTANCE_DRAG_MODES} onToggleDragMode={() => {}} />);
    fireEvent.click(screen.getByTestId("radial-handle"));
    fireEvent.click(screen.getByTitle("Drag mode: Copy ›"));
    expect(screen.queryByTitle("Move")).toBeNull();
    expect(screen.getByTitle("Copy (current)")).toBeTruthy();
    expect(screen.getByTitle("Copy-link")).toBeTruthy();
  });

  it("a custom item list carries the lock too", () => {
    render(<RadialMenu items={[{ label: "A", onClick: () => {} }]} onToggleLock={() => {}} />);
    fireEvent.click(screen.getByTestId("radial-handle"));
    expect(screen.getByTitle("Lock position (copy only)")).toBeTruthy();
  });

  it("no lock item where the caller gives no toggle (control)", () => {
    render(<RadialMenu onSettings={() => {}} />);
    fireEvent.click(screen.getByTestId("radial-handle"));
    expect(screen.queryByTitle("Lock position (copy only)")).toBeNull();
  });

  it("hovering an item shows its name as a tooltip", async () => {
    render(<RadialMenu items={[{ label: "Alpha", onClick: () => {} }, { label: "Beta", onClick: () => {} }]} />);
    fireEvent.click(screen.getByTestId("radial-handle"));
    const beta = screen.getByTitle("Beta");
    await waitFor(() => expect(beta.className).toContain("pointer-events-auto"));
    expect(screen.queryByRole("tooltip")).toBeNull();
    fireEvent.pointerEnter(beta);
    expect(screen.getByRole("tooltip").textContent).toBe("Beta");
    fireEvent.pointerLeave(beta);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("wiring", () => {
  const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const read = (f) => fs.readFileSync(path.join(SRC, f), "utf8");

  it("no drag path reads the raw mode expression any more", () => {
    const raw = /occurrence\?\.dragMode \?\? (?:liveData|data)\?\.defaultDragMode/;
    expect(read("helpers/dragSystem.js")).not.toMatch(raw);
    expect(read("ui/Editor.jsx")).not.toMatch(raw);
    expect(read("helpers/dragSystem.js")).toMatch(/dragModeOfData\(liveData\)/); // control: the sites still exist
  });

  it("the drop pipeline re-checks the source, and each surface offers the lock", () => {
    expect(read("helpers/DragProvider.jsx")).toMatch(/effectiveDragMode\(s\.mode/);
    for (const f of ["modules/ModuleInstance.jsx", "modules/ModuleContainer.jsx", "modules/PreviewNode.jsx", "docs/pills/InstanceTextblockNode.jsx"]) {
      expect(read(f), f).toMatch(/onToggleLock=/);
    }
  });
});
