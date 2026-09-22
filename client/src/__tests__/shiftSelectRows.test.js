// A SHIFT+CLICK ON A ROW SELECTS THE ROW, NOT THE CONTAINER AROUND IT.
//
// Found rebuilding poms grid through the UI (2026-09-22): shift+click on an
// instance selected nothing, and the CONTAINER toggled instead. Measured on
// prod with listeners on both elements:
//
//   plain click   pointerdown · mousedown · mouseup · click   -> reaches the row
//   shift+click   pointerdown · mousedown · mouseup · (none)  -> the row never
//                                                                sees a click
//
// `ModuleContainer` handles shift+click in the CAPTURE phase and calls
// `stopPropagation()`. Capture runs top-down, so the container fires BEFORE the
// row and halts the event — the row's own bubble-phase `onClick` can never run.
// The capture phase was chosen for a real reason ("so inner contentEditable /
// inputs don't swallow it"), so the fix is not to drop it: the container skips
// the clicks that belong to a row, and the row claims them in capture too.
//
// Consequence while broken: rows could not be multi-selected AT ALL, which
// makes the whole bulk clipboard unreachable for them — "Copy N selected" and
// its siblings live on a ROW's right-click menu, gated on the selection count.
import { describe, it, expect } from "vitest";
import { containerClaimsShiftClick, ROW_SELECTOR } from "../helpers/shiftSelect";

function fixture() {
  const shell = document.createElement("div");
  shell.className = "container-shell";
  shell.innerHTML = `
    <div class="container-header"><span class="container-header-label">Physical</span></div>
    <div class="container-list">
      <div class="instance-wrap" data-occurrence-id="occ-1">
        <div class="instance-row"><div class="instance-textcol">Morning Walk</div></div>
      </div>
    </div>`;
  return {
    shell,
    row: shell.querySelector(".instance-wrap"),
    inRow: shell.querySelector(".instance-textcol"),
    header: shell.querySelector(".container-header-label"),
    list: shell.querySelector(".container-list"),
  };
}

describe("who owns a shift+click", () => {
  it("the container does NOT claim a click that landed on a row", () => {
    const { inRow } = fixture();
    expect(containerClaimsShiftClick(inRow), "the container swallows the row's own click").toBe(false);
  });

  it("nor one on the row wrapper itself", () => {
    const { row } = fixture();
    expect(containerClaimsShiftClick(row)).toBe(false);
  });

  // THE CONTROL. Without it, "the container stops claiming row clicks" is
  // equally satisfied by a container that never selects itself at all — and
  // selecting a container is a shipped gesture (it is the only one that WORKED
  // while this was broken).
  it("but it DOES claim its header", () => {
    const { header } = fixture();
    expect(containerClaimsShiftClick(header), "the container can no longer be selected").toBe(true);
  });

  it("and its own empty list area", () => {
    const { list } = fixture();
    expect(containerClaimsShiftClick(list)).toBe(true);
  });

  it("a null target is the container's (nothing else can own it)", () => {
    expect(containerClaimsShiftClick(null)).toBe(true);
  });

  it("names the row element by the class the renderer actually writes", () => {
    // ModuleInstance's wrapper className starts `instance-wrap` — if that ever
    // changes, this constant has to move with it or the fix silently reverts.
    expect(ROW_SELECTOR).toBe(".instance-wrap");
  });
});
