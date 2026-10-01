import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { floatCountOf, wrapRoleAt, afterRemoval, afterAddingFloat, storedFloatCount } from "../docs/wrapRoles";
import { hostNotchBand } from "../docs/wrapAnchor";

// A WRAP GROUP'S TEXT SIDE CAN HOLD SEVERAL BLOCKS, AND ONLY THE LAST WRAPS.
//
// User 2026-10-01: "if i have a short textblock thats supposed to wrap the image
// … it stops short cause the image is taller than the textblock. i want to see
// if we can have multiple textblocks on that side with the last one wrapping."
// Before this a group was floats + ONE host, so a short host ended beside the
// picture and the next paragraph started below it.

const roles = (attrs, n) => Array.from({ length: n }, (_, i) => wrapRoleAt(i, n, floatCountOf(attrs, n)));

describe("wrapRoles — which child does what", () => {
  it("an existing group (no floatCount) keeps its meaning: every child but the last floats", () => {
    expect(roles({}, 2)).toEqual(["float", "host"]);
    expect(roles({ floatCount: null }, 4)).toEqual(["float", "float", "float", "host"]);
  });

  it("a stored floatCount turns the children between the floats and the host into LEADS", () => {
    expect(roles({ floatCount: 1 }, 4)).toEqual(["float", "lead", "lead", "host"]);
    expect(roles({ floatCount: 2 }, 4)).toEqual(["float", "float", "lead", "host"]);
  });

  it("a nonsense count is clamped — there is always a float and always a host", () => {
    expect(roles({ floatCount: 0 }, 3)).toEqual(["float", "lead", "host"]);
    expect(roles({ floatCount: 9 }, 3)).toEqual(["float", "float", "host"]);
  });

  it("storing the count is only needed while there are leads", () => {
    expect(storedFloatCount(2, 3)).toBe(null);
    expect(storedFloatCount(1, 3)).toBe(1);
  });
});

describe("wrapRoles — the group after a member leaves", () => {
  it("losing a lead keeps the floats and the host", () => {
    expect(afterRemoval({ floatCount: 1 }, 4, [1])).toEqual({ floatCount: 1 });
  });

  it("losing the last lead goes back to the stored-nothing shape", () => {
    expect(afterRemoval({ floatCount: 1 }, 3, [1])).toEqual({ floatCount: null });
  });

  it("losing the host makes the last lead the host", () => {
    const plan = afterRemoval({ floatCount: 1 }, 4, [3]);
    expect(plan).toEqual({ floatCount: 1 });
    expect(roles(plan, 3)).toEqual(["float", "lead", "host"]);
  });

  it("losing a float shifts the split, it does not promote a lead to a float", () => {
    const plan = afterRemoval({ floatCount: 2 }, 4, [0]);
    expect(roles(plan, 3)).toEqual(["float", "lead", "host"]);
  });

  it("losing the ONLY float flattens — there is nothing left to wrap around", () => {
    expect(afterRemoval({ floatCount: 1 }, 4, [0])).toEqual({ flatten: true });
  });

  it("one survivor flattens, as it always has", () => {
    expect(afterRemoval({}, 2, [0])).toEqual({ flatten: true });
  });

  // CONTROL: a legacy group stays legacy, so nothing that existed before this
  // change starts carrying a count it never had.
  it("a group with no stored count keeps none", () => {
    expect(afterRemoval({}, 4, [1])).toEqual({ floatCount: null });
  });

  it("adding a float bumps a stored count and leaves a legacy group alone", () => {
    expect(afterAddingFloat({ floatCount: 1 }, 4)).toBe(2);
    expect(afterAddingFloat({}, 3)).toBe(null);
  });
});

describe("hostNotchBand — the part of the host the float cuts", () => {
  const base = { floatTop: 100, floatBottom: 500, hostBottom: 900, bottomGap: 14 };

  // CONTROL: without leads it is exactly the rule that shipped before.
  it("no leads, top anchor: cut from the host's top, the float's height plus the gap", () => {
    expect(hostNotchBand({ ...base, hostTop: 100, hasLeads: false })).toEqual({ y: 0, h: 414, shape: "top" });
  });

  it("no leads, mid anchor: cut from the float's top", () => {
    const b = hostNotchBand({ ...base, floatTop: 300, hostTop: 100, hasLeads: false, anchorOffset: 200 });
    expect(b.y).toBe(200);
    expect(b.shape).toBe("middle");
  });

  it("with leads, a host that starts beside the float is cut from its own top down", () => {
    expect(hostNotchBand({ ...base, hostTop: 260, hasLeads: true })).toEqual({ y: 0, h: 254, shape: "top" });
  });

  it("with leads, a host that starts BELOW the float is not cut at all", () => {
    expect(hostNotchBand({ ...base, hostTop: 600, hasLeads: true }).h).toBe(0);
  });

  it("with leads, a float pushed below the host's top cuts a band inside it", () => {
    const b = hostNotchBand({ ...base, floatTop: 300, hostTop: 200, hasLeads: true });
    expect(b.y).toBe(100);
    expect(b.shape).toBe("middle");
  });
});

// The CSS has to address roles, not positions: `:last-child` / `:not(:last-child)`
// cannot tell a lead from a float, so a lead would float beside the picture.
describe("wrap-group CSS addresses roles", () => {
  const css = readFileSync(join(__dirname, "..", "index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  it("no wrap rule picks its members by position", () => {
    const positional = css.match(/\.wrap-group-content\s*>\s*\*\s*>\s*:(?:not\(:last-child\)|last-child)/g) || [];
    expect(positional).toEqual([]);
  });
  it("the role rules exist, including the lead's", () => {
    expect(css).toMatch(/\[data-wrap-role="float"\]/);
    expect(css).toMatch(/\[data-wrap-role="host"\]/);
    expect(css).toMatch(/\.wrap-group--on > \.wrap-group-content > \* > \[data-wrap-role="lead"\]\s*\{[^}]*display:\s*flow-root/);
  });
});

import { holdGuardStack, decideWrapStack } from "../docs/wrapAnchor";

// THE FLIP-FLOP, replayed. Philosopher's Stone, 2026-10-01: a host holding a
// table — the prediction says WRAP every time it is stacked, the rendered guard
// says STACK every time it is wrapped. 43 flips in 4 idle seconds.
describe("holdGuardStack — a guard-forced stack is not undone at the same width", () => {
  const step = (state) => {
    // what each layout reports for this host
    const predictWrap = !decideWrapStack({ textArea: 200000, besideW: 360, neighborH: 400, prevStacked: state.stacked });
    if (!state.stacked) {
      // wrapped: the table dropped below the picture, the band is blank
      return { stacked: true, latch: state.width };
    }
    const hold = holdGuardStack({ stacked: true, latchWidth: state.latch, width: state.width });
    return predictWrap && !hold ? { stacked: false, latch: null } : { stacked: true, latch: state.latch };
  };
  it("without the latch the two rules alternate forever", () => {
    let s = { stacked: false, latch: null, width: 700 }; let flips = 0;
    for (let i = 0; i < 10; i++) { const n = step({ ...s, latch: null }); if (n.stacked !== s.stacked) flips++; s = { ...n, latch: null, width: 700 }; }
    expect(flips).toBeGreaterThan(5);
  });
  it("with the latch the group settles stacked after one flip", () => {
    let s = { stacked: false, latch: null, width: 700 }; let flips = 0;
    for (let i = 0; i < 10; i++) { const n = step(s); if (n.stacked !== s.stacked) flips++; s = { ...n, width: 700 }; }
    expect(flips).toBe(1);
    expect(s.stacked).toBe(true);
  });
  // CONTROL: widening releases it — the latch is about THIS width only.
  it("a real width change releases the latch", () => {
    expect(holdGuardStack({ stacked: true, latchWidth: 700, width: 712 })).toBe(true);
    expect(holdGuardStack({ stacked: true, latchWidth: 700, width: 760 })).toBe(false);
    expect(holdGuardStack({ stacked: true, latchWidth: null, width: 700 })).toBe(false);
    expect(holdGuardStack({ stacked: false, latchWidth: 700, width: 700 })).toBe(false);
  });
});

import { textSideGap } from "../docs/wrapRoles";

describe("textSideGap — the empty band beside the picture, below a short text side", () => {
  const group = { left: 0, right: 700, top: 0, bottom: 600 };
  const floatRight = [{ left: 400, right: 700, top: 0, bottom: 600 }];
  const shortText = [{ left: 0, right: 390, top: 0, bottom: 150 }];

  it("a press under the short text, beside the picture, is the gap", () => {
    expect(textSideGap({ point: { x: 200, y: 400 }, floatRects: floatRight, textRects: shortText, groupRect: group }))
      .toEqual({ top: 150, bottom: 600, left: 0, right: 400 });
  });
  it("a press on the picture is not", () => {
    expect(textSideGap({ point: { x: 550, y: 400 }, floatRects: floatRight, textRects: shortText, groupRect: group })).toBe(null);
  });
  it("a press on the text is not", () => {
    expect(textSideGap({ point: { x: 200, y: 100 }, floatRects: floatRight, textRects: shortText, groupRect: group })).toBe(null);
  });
  it("a float on the LEFT puts the band on the right", () => {
    const floatLeft = [{ left: 0, right: 300, top: 0, bottom: 600 }];
    const text = [{ left: 310, right: 700, top: 0, bottom: 150 }];
    expect(textSideGap({ point: { x: 500, y: 400 }, floatRects: floatLeft, textRects: text, groupRect: group }))
      .toEqual({ top: 150, bottom: 600, left: 300, right: 700 });
  });
  // CONTROL: text that already reaches past the picture leaves no gap.
  it("no gap when the text side is as tall as the group", () => {
    const tall = [{ left: 0, right: 390, top: 0, bottom: 598 }];
    expect(textSideGap({ point: { x: 200, y: 599 }, floatRects: floatRight, textRects: tall, groupRect: group })).toBe(null);
  });
});
