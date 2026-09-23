// PASTING N ROWS IS ONE UNDO STEP.
//
// Found rebuilding poms grid through the UI (2026-09-22), first pass over
// multi-select: shift-select two rows, "Copy 2 selected", click the
// destination. Both rows land correctly — and the transactions collection says
// it was TWO gestures:
//
//   seq 2256  action b52c615a  "Created item"  17901252[create] 3dd9f1d9[update]
//   seq 2257  action 9ea65562  "Created item"  17901252[create] 3dd9f1d9[update]
//
// So one Ctrl+Z takes back HALF a paste and leaves the other row behind. Each
// row's own create IS grouped with the parent's list write (the 2026-09-22 (8)
// fix); what was missing is the gesture around the pair.
//
// `withAction` nests — an outer scope keeps one id for every write inside it —
// so wrapping the loop is the whole fix. Same shape as (8), (10), (12) and (13).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { _resetActionScope } from "../helpers/actionScope";
import { runPasteClipboard } from "../helpers/pasteClipboard";

beforeEach(() => _resetActionScope());

function run(mode, ids, occurrencesById) {
  const emitted = [];
  const socket = {
    connected: true,
    emit: (event, data) => emitted.push({ event, actionId: data?.__actionId }),
    on: vi.fn(), off: vi.fn(), io: { opts: {} },
  };
  const res = runPasteClipboard({
    mode, ids,
    destinationOccurrence: { id: "dest", moduleId: "destmod", occurrences: [] },
    destinationModule: { id: "destmod", role: "container", kind: "board", gridId: "g1", userId: "u1" },
    occurrencesById,
    dispatch: vi.fn(), socket, gridId: "g1", userId: "u1",
  });
  // EVERY write, not just the ones that happen to carry an id: an unstamped
  // write is recorded `derived` server-side and is not undoable at all.
  const writes = emitted.filter((e) => /create_occurrence|update_occurrence|create_module/.test(e.event));
  return { res, writes, ids: [...new Set(writes.map((w) => w.actionId ?? null))] };
}

const leaf = (id) => ({ id, moduleId: `mod-${id}`, occurrences: [], fields: {}, iteration: {} });
const two = { a: leaf("a"), b: leaf("b") };

describe("one paste, one undo step", () => {
  it("copying two rows groups every write under ONE action", () => {
    const { res, writes, ids } = run("copy", ["a", "b"], two);
    expect(res.pasted).toBe(2);
    expect(writes.length).toBeGreaterThan(1);
    expect(ids, `writes span ${ids.length} actions (null = not undoable)`).toHaveLength(1);
    expect(ids[0], "the writes carry no action id at all").toBeTruthy();
  });

  it("copy-linking two rows does too", () => {
    const { res, writes, ids } = run("copylink", ["a", "b"], two);
    expect(res.pasted).toBe(2);
    expect(writes.length).toBeGreaterThan(1);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBeTruthy();
  });

  // A paste that writes nothing must not open an empty action — an undo step
  // that restores nothing is worse than no undo step, because it spends a press.
  it("a paste with no resolvable sources writes nothing", () => {
    const { res, writes } = run("copy", ["missing"], {});
    expect(res.pasted).toBe(0);
    expect(writes).toHaveLength(0);
  });
});
