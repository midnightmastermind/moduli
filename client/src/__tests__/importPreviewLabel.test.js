// Intake audit finding 1, the pill half: the drag preview used to ANNOUNCE a
// decision ("Convert HTML → modules") and offer no choice. Intake asks now, so
// that wording announced an outcome the user has not chosen yet.
import { describe, it, expect } from "vitest";
import { importPreviewLabel } from "../helpers/DragProvider";

describe("importPreviewLabel", () => {
  it("always says a choice is coming", () => {
    for (const f of ["file", "html", "text"]) {
      expect(importPreviewLabel(f, null).hint).toMatch(/pick what it becomes/);
    }
  });

  it("no longer asserts the outcome", () => {
    // The old strings promised a specific conversion before anything was known.
    for (const f of ["file", "html", "text"]) {
      const { action } = importPreviewLabel(f, null);
      expect(action).not.toMatch(/Convert|→ modules|Upload file/);
    }
  });

  it("names the destination, which IS known at dragover", () => {
    expect(importPreviewLabel("file", { kind: "container", label: "Notes" }).dest)
      .toBe("→ into Notes");
    expect(importPreviewLabel("file", { kind: "cell" }).dest)
      .toBe("→ new panel in this cell");
  });

  it("omits the destination when the pointer is over nothing droppable", () => {
    expect(importPreviewLabel("text", null).dest).toBeNull();
  });

  it("does NOT name a shape — dataTransfer.files is unreadable during dragover", () => {
    // Naming ".csv → table" here would be a guess presented as fact, which is
    // the thing this change fixes. The sheet names it from the real payload.
    const { action, dest, hint } = importPreviewLabel("file", { kind: "container", label: "Notes" });
    for (const s of [action, dest, hint]) {
      expect(s).not.toMatch(/csv|table|canvas|chip|markdown/i);
    }
  });
});
