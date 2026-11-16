// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { describeSelection } from "../ui/AssistantDrawer.jsx";

describe("describeSelection — what 'these' means, for Jonah", () => {
  const occ = {
    page: { id: "page", moduleId: "mp", occurrences: ["todo"] },
    todo: { id: "todo", moduleId: "mt", occurrences: ["a", "b"] },
    a: { id: "a", moduleId: "mi", label: "Clean" }, b: { id: "b", moduleId: "mi2" },
  };
  const mod = { mp: { label: "Tasks" }, mt: { label: "Todo" }, mi: { label: "Task" }, mi2: { label: "Book a massage" } };
  it("names each selected item and where it sits", () => {
    expect(describeSelection(new Set(["a", "b"]), occ, mod)).toEqual([
      { id: "a", label: "Clean", path: "Tasks › Todo" },
      { id: "b", label: "Book a massage", path: "Tasks › Todo" },
    ]);
  });
  it("skips ids the grid no longer has; nothing selected is an empty list", () => {
    expect(describeSelection(new Set(["gone"]), occ, mod)).toEqual([]);
    expect(describeSelection(new Set(), occ, mod)).toEqual([]);
  });
});
