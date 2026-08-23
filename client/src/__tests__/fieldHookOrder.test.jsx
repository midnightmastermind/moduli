// A `Field` must call the SAME NUMBER OF HOOKS whichever way it renders.
//
// Five `useMemo`s lived below `if (isEditable) { … }` and its many returns, and
// a sixth inside `case type === "date"` — so one field rendered four to six
// fewer hooks as an INPUT than as a DISPLAY. That is only safe if a mounted
// Field can never switch, and it can: `inputEnabled`, `displayEnabled` and
// `type` are all editable in the Command Center's Fields tab, and editing one
// re-renders every Field bound to it. React answers a changing hook count by
// unmounting the tree — "Rendered fewer hooks than during the previous render".
//
// Same class as `BoundHeader` (2026-08-11), and as `ActionConfig`,
// `ModuleContainer` and `TextblockCard` the same day as this.
//
// EVERY CASE BELOW RE-RENDERS THE SAME COMPONENT INSTANCE — no `key` changes —
// because remounting is exactly what would hide the defect.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";

vi.mock("../helpers/operationExecutor", () => ({ runMatchingOperations: () => [] }));
vi.mock("../state/actions", () => ({ setComputedValue: () => ({ type: "noop" }) }));

import Field from "../ui/Field";

const ctx = {
  dispatch: vi.fn(), socket: null, gridId: "g1", userId: "u1",
  occurrencesById: {}, modulesById: {}, fieldsById: {}, operationsById: {},
  state: { grid: {} },
};
const wrap = (node) => <GridActionsContext.Provider value={ctx}>{node}</GridActionsContext.Provider>;

/**
 * Re-render the SAME instance with a different field shape.
 * React reports a hook-count change TWO ways — it logs "change in the order of
 * Hooks" AND throws "Rendered more hooks…" — so both are collected. Catching
 * only the log is what made the first version of this file pass its five
 * assertions while its own control failed.
 */
function flip(first, second, propsA = {}, propsB = {}) {
  const errs = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...a) => errs.push(a.map(String).join(" ")));
  let thrown = null;
  const { rerender, unmount } = render(wrap(<Field field={first} hostOccurrence={{ id: "occ-1" }} {...propsA} />));
  try {
    rerender(wrap(<Field field={second} hostOccurrence={{ id: "occ-1" }} {...propsB} />));
  } catch (e) { thrown = e; }
  spy.mockRestore();
  try { unmount(); } catch { /* a torn-down tree cannot always unmount */ }
  return [thrown?.message || "", ...errs].join("\n");
}
const hookError = (s) => /Rendered (fewer|more) hooks|change in the order of Hooks/i.test(s);

describe("Field — hook count is stable across every render path", () => {
  // `isEditable` is `typeof onCommit === "function"` — a PROP, not a field flag.
  // The first version of this file never passed it, so both renders took the
  // display path and all five assertions were vacuous: putting the defect back
  // still passed them.
  const asInput = { onCommit: () => {} };
  const asDisplay = {};

  it("the two paths really are different — the control", () => {
    // Everything below is an assertion of ABSENCE, which proves nothing until
    // the two renders are shown to differ.
    const f = { id: "f0", type: "number", name: "Water" };
    const { container: a, unmount: ua } = render(wrap(<Field field={f} hostOccurrence={{ id: "o" }} {...asInput} />));
    const inputHtml = a.innerHTML; ua();
    const { container: b, unmount: ub } = render(wrap(<Field field={f} hostOccurrence={{ id: "o" }} {...asDisplay} />));
    const displayHtml = b.innerHTML; ub();
    expect(a.querySelector("input, button, select") || inputHtml).toBeTruthy();
    expect(inputHtml).not.toBe(displayHtml);
  });

  it("INPUT -> DISPLAY does not change the hook count", () => {
    // Reachable: `FieldRenderer` decides whether to pass `onCommit` from the
    // field's own input/display flags, both editable in the Fields tab.
    const f = { id: "f1", type: "number", name: "Water" };
    expect(hookError(flip(f, f, asInput, asDisplay))).toBe(false);
  });

  it("DISPLAY -> INPUT does not change the hook count", () => {
    const f = { id: "f1", type: "number", name: "Water" };
    expect(hookError(flip(f, f, asDisplay, asInput))).toBe(false);
  });

  it("changing TYPE to `date` does not change the hook count", () => {
    // `relativeDateLabel` lived inside the date branch — one extra hook for
    // exactly one type, reached only while editable.
    const text = { id: "f2", type: "text", name: "Note" };
    const date = { id: "f2", type: "date", name: "Note" };
    expect(hookError(flip(text, date, asInput, asInput))).toBe(false);
  });

  it("changing TYPE away from `date` does not change the hook count", () => {
    const date = { id: "f2", type: "date", name: "Note" };
    const text = { id: "f2", type: "text", name: "Note" };
    expect(hookError(flip(date, text, asInput, asInput))).toBe(false);
  });

  it("a DISPLAY field gaining a target does not change the hook count", () => {
    const plain = { id: "f3", type: "number", name: "Steps" };
    const withTarget = { id: "f3", type: "number", name: "Steps", displayConfig: { targetValue: 100 } };
    expect(hookError(flip(plain, withTarget, asDisplay, asDisplay))).toBe(false);
  });

  it("the probe can SEE a hook error — the control", () => {
    // Without this, every assertion above could pass because the detector is
    // broken rather than because the component is correct. The first version of
    // this control keyed the extra hook off a RENDER COUNTER and never fired —
    // StrictMode double-invokes render, so the counter is not a reliable
    // discriminator. Keying it off a PROP is.
    // eslint-disable-next-line react-hooks/rules-of-hooks -- this component
    // EXISTS to break the rule; that is what makes it a control.
    function Bad({ two }) { React.useMemo(() => 1, []); if (two) React.useMemo(() => 2, []); return null; }
    const errs = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...a) => errs.push(a.map(String).join(" ")));
    let thrown = null;
    const { rerender } = render(<Bad two={false} />);
    try { rerender(<Bad two={true} />); } catch (e) { thrown = e; }
    spy.mockRestore();
    expect(hookError([thrown?.message || "", ...errs].join("\n"))).toBe(true);
  });
});
