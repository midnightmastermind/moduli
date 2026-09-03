// The drop-area outline must never claim a container the drop will not use.
//
// The bug (user, 2026-09-03): "i keep dropping stuff after a timeslot cause my
// finger is underneath the timeslot but the hover says its on it." The sticky
// rule kept the last LEAF box for as long as the pointer stayed anywhere inside
// the parent — so once the finger left a timeslot the outline still claimed it
// while the drop resolved the day column.
import { describe, it, expect } from "vitest";
import { resolveDropBox } from "../helpers/dropBoxTarget.js";

// Minimal element stand-ins: a tree of rects, `contains` by ancestry.
function el(name, rect, kids = []) {
  const e = { name, rect, kids, connected: true };
  for (const k of kids) k.parent = e;
  return e;
}
const ancestors = (n) => { const out = []; let c = n; while (c) { out.push(c); c = c.parent; } return out; };
const deps = {
  hasNestedContainer: (e) => e.kids.length > 0,
  contains: (a, b) => ancestors(b).includes(a),
  isConnected: (e) => e.connected,
  rectOf: (e) => e.rect,
};

// A day column holding two timeslots, with an 8px gap between them.
const slotA = el("2:00pm", { left: 0, right: 300, top: 100, bottom: 200 });
const slotB = el("2:30pm", { left: 0, right: 300, top: 208, bottom: 308 });
const column = el("day column", { left: 0, right: 300, top: 0, bottom: 600 }, [slotA, slotB]);

describe("resolveDropBox", () => {
  it("boxes a LEAF container outright and marks it sticky-worthy", () => {
    expect(resolveDropBox(slotA, null, 50, 150, deps)).toEqual({ el: slotA, box: true, leaf: true });
  });

  it("keeps the sticky leaf while the pointer is still INSIDE it", () => {
    // Hovering the PARENT (the pointer is over column chrome that overlaps the
    // slot) but geometrically still within slotA — the drop still resolves
    // slotA, so the outline is honest.
    const r = resolveDropBox(column, slotA, 50, 199, deps);
    expect(r).toEqual({ el: slotA, box: true, leaf: true });
  });

  // ── THE DEFECT ────────────────────────────────────────────────────────────
  it("DROPS the sticky leaf once the pointer leaves its rect", () => {
    // y=204 is in the 8px gap between the slots — below slotA, above slotB.
    const r = resolveDropBox(column, slotA, 50, 204, deps);
    expect(r.el).toBe(column);   // the honest container
    expect(r.box).toBe(false);   // line only — no outline claiming slotA
    expect(r.leaf).toBe(false);
  });

  it("never re-boxes the PARENT itself as its own sticky leaf", () => {
    // Node.contains is TRUE for self, so passing the parent back in as the
    // remembered leaf would hand the huge outline straight back.
    const r = resolveDropBox(column, column, 50, 204, deps);
    expect(r.box).toBe(false);
  });

  it("ignores a sticky leaf that has unmounted", () => {
    const gone = el("stale", { left: 0, right: 300, top: 100, bottom: 200 });
    gone.parent = column; gone.connected = false;
    expect(resolveDropBox(column, gone, 50, 150, deps).box).toBe(false);
  });

  it("ignores a sticky leaf belonging to a DIFFERENT parent", () => {
    const other = el("elsewhere", { left: 0, right: 300, top: 100, bottom: 200 });
    expect(resolveDropBox(column, other, 50, 150, deps).box).toBe(false);
  });

  it("hides everything when nothing is hovered", () => {
    expect(resolveDropBox(null, slotA, 50, 150, deps)).toEqual({ el: null, box: false, leaf: false });
  });

  // CONTROL: without this the "drops the sticky leaf" case would also be
  // satisfied by a rule that never keeps a sticky leaf at all — which is the
  // flicker the sticky rule was written to prevent.
  it("still keeps the leaf on the exact boundary pixel", () => {
    expect(resolveDropBox(column, slotA, 50, 200, deps).el).toBe(slotA);
    expect(resolveDropBox(column, slotA, 0, 150, deps).el).toBe(slotA);
    expect(resolveDropBox(column, slotA, 300, 150, deps).el).toBe(slotA);
  });
});

// ── THE OUTLINE AND THE DROP MUST ASK THE SAME QUESTION ────────────────────
//
// Reproduces the real stack measured on prod: the insert gap's 20px button
// (`.insert-gap-btn`, unregistered) overflows the 8px gap and sits ON TOP of
// the timeslot's shell. `useDroppable` registers only `.container-list` and
// `.container-header`, so the drop walks up from the button, straight past the
// slot's shell, to the DAY COLUMN's list — while the old indicator rule read
// the first `data-container-id` in the stack and answered "the timeslot".
import { resolveHoverContainerEl } from "../helpers/dropBoxTarget.js";

function node(cls, attrs = {}, parent = null) {
  const n = {
    classList: { contains: (c) => cls.split(" ").includes(c) },
    parentElement: parent,
    _attrs: attrs,
  };
  n.closest = (sel) => {
    const key = sel.replace(/[[\]]/g, "").split("=")[0];
    let c = n;
    while (c) { if (c._attrs && key in c._attrs) return c; c = c.parentElement; }
    return null;
  };
  return n;
}

describe("resolveHoverContainerEl — one algorithm for the outline and the drop", () => {
  // day column shell > its container-list > [ slot shell > slot list , insert gap > button ]
  const colShell  = node("container-shell", { "data-container-id": "col" });
  const colList   = node("container-list", {}, colShell);
  const slotShell = node("container-shell", { "data-container-id": "slot" }, colList);
  const slotList  = node("container-list", {}, slotShell);
  const gap       = node("insert-gap", {}, colList);
  const gapBtn    = node("insert-gap-btn", {}, gap);

  it("resolves a point inside the slot's LIST to the slot", () => {
    // stack: slot list, slot shell, column list, column shell
    const stack = () => [slotList, slotShell, colList, colShell];
    expect(resolveHoverContainerEl(0, 0, stack)._attrs["data-container-id"]).toBe("slot");
  });

  it("resolves the gap BUTTON overlapping the slot to the PARENT — where the drop lands", () => {
    // The button paints over the slot, so it is topmost; the slot's shell is
    // still in the stack underneath, which is what the old rule latched onto.
    const stack = () => [gapBtn, gap, slotShell, colList, colShell];
    expect(resolveHoverContainerEl(0, 0, stack)._attrs["data-container-id"]).toBe("col");
    // and the OLD rule (first data-container-id in the stack) said "slot":
    const oldAnswer = [gapBtn, gap, slotShell, colList, colShell]
      .find(e => e._attrs["data-container-id"]);
    expect(oldAnswer._attrs["data-container-id"]).toBe("slot");
  });

  it("resolves the slot's recess RING (its shell, unregistered) to the PARENT", () => {
    const stack = () => [slotShell, colList, colShell];
    expect(resolveHoverContainerEl(0, 0, stack)._attrs["data-container-id"]).toBe("col");
  });

  it("a container HEADER resolves to its own container", () => {
    const hdr = node("container-header", {}, slotShell);
    expect(resolveHoverContainerEl(0, 0, () => [hdr, slotShell, colList, colShell])._attrs["data-container-id"]).toBe("slot");
  });

  it("returns null when nothing registered is under the point", () => {
    expect(resolveHoverContainerEl(0, 0, () => [node("toolbar")])).toBeNull();
  });
});
