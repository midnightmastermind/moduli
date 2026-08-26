// The control must repaint BEFORE the write runs (user, 2026-08-25: "even if it
// does, it should mark the toggle as complete before running the ops").
//
// Field.handleChange sets the control's LOCAL state, but React batches that with
// FieldRenderer.handleCommit's store dispatch — so until this deferral the
// browser could not paint the tick until an app-wide re-render finished
// (measured ~2333ms on poms grid; ~30ms after).
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";

const updates = [];
vi.mock("../helpers/CommitHelpers", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, updateOccurrence: (args) => { updates.push(args); } };
});

import FieldRenderer from "../ui/FieldRenderer";

const field = { id: "f-done", type: "boolean", name: "Completed", inputEnabled: true, meta: {} };
const occurrence = { id: "o1", moduleId: "m1", fields: {} };

function mount() {
  const ctx = {
    dispatch: vi.fn(), socket: { emit: vi.fn() }, gridId: "g1", userId: "u1",
    occurrencesById: { o1: occurrence }, modulesById: {}, fieldsById: { "f-done": field },
    foldersById: {}, operationsById: {}, state: { grid: {} },
    getOccMap: () => ({ o1: occurrence }),
  };
  return render(
    <GridActionsContext.Provider value={ctx}>
      <FieldRenderer field={field} occurrence={occurrence} compact />
    </GridActionsContext.Provider>
  );
}

describe("a field commit happens AFTER the paint", () => {
  beforeEach(() => { updates.length = 0; });

  it("does not write synchronously, and does write a frame later", async () => {
    const { container } = mount();
    const sw = container.querySelector('button[role="switch"]');
    expect(sw).toBeTruthy();              // positive control: the switch rendered
    fireEvent.click(sw);
    // The click handler has returned — the browser must be free to paint.
    expect(updates).toEqual([]);
    await new Promise((r) => setTimeout(r, 80));
    expect(updates.length).toBeGreaterThan(0);           // nothing is skipped
    expect(updates[0]?.occurrence?.id).toBe("o1");       // …and it is the right write
  });
});
