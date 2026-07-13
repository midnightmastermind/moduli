// __tests__/contextMenuSeparators.test.js
// ============================================================
// normalizeMenuItems — callers build item arrays with conditional
// entries ([cond && {...}].filter(Boolean)), so a filtered-out item
// can strand a separator at the top/bottom or double one up. Those
// rendered as blank rows (user: "empty space before Insert field").
// ============================================================

import { describe, it, expect } from "vitest";
import { normalizeMenuItems } from "../ui/ContextMenu.jsx";

const sep = { separator: true };
const item = (label) => ({ label, onClick: () => {} });

describe("normalizeMenuItems", () => {
  it("drops a leading separator", () => {
    expect(normalizeMenuItems([sep, item("Insert field (@)")])).toEqual([
      item("Insert field (@)"),
    ].map(({ label }) => expect.objectContaining({ label })));
  });

  it("drops a trailing separator", () => {
    const out = normalizeMenuItems([item("A"), sep]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe("A");
  });

  it("collapses consecutive separators to one", () => {
    const out = normalizeMenuItems([item("A"), sep, sep, item("B")]);
    expect(out.map((i) => i.separator ? "|" : i.label)).toEqual(["A", "|", "B"]);
  });

  it("keeps a valid single separator between items", () => {
    const out = normalizeMenuItems([item("A"), sep, item("B")]);
    expect(out.map((i) => i.separator ? "|" : i.label)).toEqual(["A", "|", "B"]);
  });

  it("handles empty and all-separator arrays", () => {
    expect(normalizeMenuItems([])).toEqual([]);
    expect(normalizeMenuItems([sep, sep])).toEqual([]);
  });
});
