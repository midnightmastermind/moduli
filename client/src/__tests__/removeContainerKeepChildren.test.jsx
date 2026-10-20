// Deleting a container that holds items asks first: keep them (they move up into the container's
// place) or delete them too (user, 2026-10-20).
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { _resetActionScope } from "../helpers/actionScope";
import * as CommitHelpers from "../helpers/CommitHelpers";
import { ChoiceDialogHost, askChoice } from "../ui/ChoiceDialog";

beforeEach(() => _resetActionScope());

function run() {
  const emitted = [];
  const socket = { connected: true, emit: (event, data) => emitted.push({ event, data }), on: vi.fn(), off: vi.fn(), io: { opts: {} } };
  const occs = {
    page: { id: "page", occurrences: ["a", "box", "b"] },
    box: { id: "box", parentId: "page", occurrences: ["k1", "k2", "shared"] },
    k1: { id: "k1", parentId: "box" }, k2: { id: "k2", parentId: "box" },
    shared: { id: "shared", parentId: "elsewhere" },
  };
  const ok = CommitHelpers.removeContainerKeepChildren({
    dispatch: () => {}, socket, containerOccurrence: occs.box, parentOccurrence: occs.page, getOccurrence: (id) => occs[id],
  });
  const updates = emitted.filter((e) => e.event === "update_occurrence").map((e) => e.data.occurrence);
  return { ok, emitted, updates };
}

describe("removeContainerKeepChildren", () => {
  it("puts the items where the container was, in order", () => {
    const { updates } = run();
    expect(updates.find((u) => u.id === "page").occurrences).toEqual(["a", "k1", "k2", "shared", "b"]);
  });
  it("re-parents only the items the container owned, so the delete cascade spares them", () => {
    const { updates } = run();
    expect(updates.find((u) => u.id === "k1").parentId).toBe("page");
    expect(updates.find((u) => u.id === "k2").parentId).toBe("page");
    expect(updates.find((u) => u.id === "shared")).toBeUndefined();
  });
  it("empties the container's list, then deletes it, as one undo step", () => {
    const { emitted, updates } = run();
    expect(updates.find((u) => u.id === "box").occurrences).toEqual([]);
    const del = emitted.find((e) => e.event === "delete_occurrence");
    expect(del.data.occurrenceId).toBe("box");
    const ids = new Set(emitted.map((e) => e.data.__actionId).filter(Boolean));
    expect(ids.size).toBe(1);
  });
  it("does nothing without a parent to move into", () => {
    const socket = { connected: true, emit: vi.fn() };
    expect(CommitHelpers.removeContainerKeepChildren({ dispatch: () => {}, socket, containerOccurrence: { id: "box", occurrences: ["k"] }, parentOccurrence: null })).toBe(false);
    expect(socket.emit).not.toHaveBeenCalled();
  });
});

describe("askChoice", () => {
  it("resolves with the picked value", async () => {
    render(<ChoiceDialogHost />);
    let p;
    act(() => { p = askChoice({ title: "Delete?", choices: [{ value: "keep", label: "Keep" }, { value: "all", label: "Delete all", danger: true }] }); });
    fireEvent.click(screen.getByText("Keep"));
    await expect(p).resolves.toBe("keep");
  });
  it("resolves null on Cancel and on Escape", async () => {
    render(<ChoiceDialogHost />);
    let p;
    act(() => { p = askChoice({ choices: [{ value: "x", label: "X" }] }); });
    fireEvent.click(screen.getByText("Cancel"));
    await expect(p).resolves.toBe(null);
    act(() => { p = askChoice({ choices: [{ value: "x", label: "X" }] }); });
    fireEvent.keyDown(document, { key: "Escape" });
    await expect(p).resolves.toBe(null);
  });
});
