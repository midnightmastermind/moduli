// ADDING A ROW IS ONE UNDO STEP.
//
// Found rebuilding poms grid through the UI (2026-09-22): "+ Item" on a
// container, then Ctrl+Z. The row LEFT THE BOARD and the occurrence stayed in
// the database, parented to the container and listed by nobody — invisible,
// exactly the shape of the 22 unreachable rows on poms grid.
//
// Measured in the transactions collection: ONE gesture wrote TWO transactions
// with DIFFERENT action ids —
//
//   seq 2062  action f2a85827  "Created item"       occurrence:9c9216c8 (create)
//   seq 2063  action 21d2bb50  "Updated occurrence" occurrence:fff9474f (the parent list)
//
// so undo took the newest (the parent's list) and left the create applied. A
// second Ctrl+Z would have deleted the row. `withAction` nests — an outer scope
// keeps one id for every write inside it — so grouping the pair is the fix.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { _resetActionScope } from "../helpers/actionScope";
import * as CommitHelpers from "../helpers/CommitHelpers";

beforeEach(() => _resetActionScope());

function run(fn) {
  const emitted = [];
  const socket = { connected: true, emit: (event, data) => emitted.push({ event, actionId: data?.__actionId }), on: vi.fn(), off: vi.fn(), io: { opts: {} } };
  fn({ dispatch: vi.fn(), socket });
  const writes = emitted.filter((e) => /create_occurrence|update_occurrence|create_module|create_instance_in_container/.test(e.event));
  // EVERY write in one gesture, not just the ones that happen to carry an id:
  // a write with no `__actionId` is recorded `derived` server-side and is not
  // undoable at all, which is the other half of the same defect.
  return { writes, ids: [...new Set(writes.map((w) => w.actionId ?? null))] };
}

const parent = { id: "c1", moduleId: "cm", occurrences: ["existing"] };

describe("one gesture, one undo step", () => {
  it("createLeafInstanceInParent groups the create and the parent's list write", () => {
    const { writes, ids } = run(({ dispatch, socket }) =>
      CommitHelpers.createLeafInstanceInParent({ dispatch, socket, gridId: "g1", userId: "u1", parentOccurrence: parent, label: "Row" }));
    expect(writes.length).toBeGreaterThan(1);
    expect(ids, `writes span ${ids.length} actions (null = not undoable)`).toHaveLength(1);
    expect(ids[0], "writes carry no action id at all").toBeTruthy();
  });

  it("createLeafInstanceAtIndex does too (the insert-gap path)", () => {
    const { writes, ids } = run(({ dispatch, socket }) =>
      CommitHelpers.createLeafInstanceAtIndex({ dispatch, socket, gridId: "g1", userId: "u1", parentOccurrence: parent, index: 0, label: "Row" }));
    expect(writes.length).toBeGreaterThan(1);
    expect(ids, `writes span ${ids.length} actions (null = not undoable)`).toHaveLength(1);
    expect(ids[0]).toBeTruthy();
  });

  it("addBookmarkOccurrence does too (Browser tile / Save bookmark / paste)", () => {
    const { writes, ids } = run(({ dispatch, socket }) =>
      CommitHelpers.addBookmarkOccurrence({ dispatch, socket, gridId: "g1", userId: "u1", containerOccurrence: parent, url: "https://x.test/p" }));
    expect(writes.length).toBeGreaterThan(1);
    expect(ids, `writes span ${ids.length} actions (null = not undoable)`).toHaveLength(1);
    expect(ids[0]).toBeTruthy();
  });

  it("createPageInContainer does too", () => {
    const { writes, ids } = run(({ dispatch, socket }) =>
      CommitHelpers.createPageInContainer({ dispatch, socket, gridId: "g1", userId: "u1", containerOccurrence: parent, containerModule: { id: "cm", meta: {} }, kind: "doc", label: "P" }));
    expect(writes.length).toBeGreaterThan(1);
    expect(ids, `writes span ${ids.length} actions (null = not undoable)`).toHaveLength(1);
    expect(ids[0]).toBeTruthy();
  });

  it("createInstanceInContainer carries an action id (canvas double-click, pool add, Duplicate)", () => {
    const { writes, ids } = run(({ dispatch, socket }) =>
      CommitHelpers.createInstanceInContainer({
        dispatch, socket, containerId: "cm",
        instance: { id: "i1", role: "instance", label: "New card", userId: "u1", gridId: "g1" },
        initialMeta: { x: 10, y: 20 },
      }));
    // One atomic server event, so the count is 1 — what matters is the STAMP:
    // unstamped, the server records it `derived` and no number of presses undoes it.
    expect(writes.length).toBe(1);
    expect(ids[0], "the write carries no action id — recorded derived, never undoable").toBeTruthy();
  });

  // WIRING. The canvas double-click lives in a component whose mount needs the
  // whole grid store, so the gesture itself is pinned at the source: it must go
  // through the one-undo-step helper, not hand-roll create + list (which is how
  // it wrote three docs under TWO action ids and left an orphan behind).
  it("the canvas double-click calls createLeafInstanceInParent, not a hand-rolled create + list", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = (await import("node:path")).default;
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(path.join(here, "..", "modules", "pages", "PageCanvas.jsx"), "utf8");
    const gesture = src.slice(src.indexOf("const handleDoubleClick"));
    // CONTROL — the handler still exists and still stamps where you clicked, or
    // "no hand-rolled create" also passes against a file with the feature gone.
    expect(gesture, "the double-click handler is gone").toContain("getBoundingClientRect");
    expect(gesture).toMatch(/occMeta:\s*\{\s*x,\s*y\s*\}/);
    expect(gesture).toContain("createLeafInstanceInParent");
    expect(gesture, "hand-rolled occurrence create is back").not.toContain("CommitHelpers.createOccurrence");
    expect(gesture, "hand-rolled parent-list write is back").not.toContain("CommitHelpers.updateOccurrence");
  });

  // CONTROL — the grouping must not swallow a SEPARATE later gesture.
  it("two separate calls are two actions", () => {
    const emitted = [];
    const socket = { connected: true, emit: (event, data) => emitted.push({ event, actionId: data?.__actionId }), on: vi.fn(), off: vi.fn(), io: { opts: {} } };
    const dispatch = vi.fn();
    CommitHelpers.createLeafInstanceInParent({ dispatch, socket, gridId: "g1", userId: "u1", parentOccurrence: parent, label: "A" });
    CommitHelpers.createLeafInstanceInParent({ dispatch, socket, gridId: "g1", userId: "u1", parentOccurrence: parent, label: "B" });
    const ids = [...new Set(emitted.map((e) => e.actionId).filter(Boolean))];
    expect(ids).toHaveLength(2);
  });
});
