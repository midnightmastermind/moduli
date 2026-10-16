// "Apply to all" writes each placement's layout, keeps its other meta, as ONE undo step.
import { describe, it, expect, vi } from "vitest";
import * as CommitHelpers from "../helpers/CommitHelpers";

describe("applyInstanceLayout", () => {
  it("writes every target under one action id and keeps the rest of meta", () => {
    const sent = [];
    const socket = { connected: true, emit: (ev, p) => sent.push({ ev, p }) };
    const layout = { tree: { dir: "row", items: ["label"] } };
    const n = CommitHelpers.applyInstanceLayout({ dispatch: vi.fn(), socket, layout,
      occurrenceIds: ["a", "b", "gone"], occurrencesById: { a: { id: "a", meta: { keep: 1 } }, b: { id: "b" } } });
    expect(n).toBe(2);
    const ups = sent.filter((s) => s.ev === "update_occurrence");
    expect(ups.map((u) => u.p.id ?? u.p.occurrence?.id)).toEqual(["a", "b"]);
    const meta = (u) => u.p.meta ?? u.p.occurrence?.meta;
    expect(meta(ups[0])).toEqual({ keep: 1, instanceLayout: layout });
    const ids = new Set(ups.map((u) => u.p.__actionId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBeTruthy();
  });
});
