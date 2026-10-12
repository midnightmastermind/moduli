// The when field's pill shows a stored value: Field receives the bare when object, which has no `value`
// key, and used to read it as empty ("—") although the value was saved.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";
import Field from "../ui/Field";

const ctx = { dispatch: vi.fn(), socket: null, gridId: "g1", userId: "u1", occurrencesById: {}, modulesById: {}, fieldsById: {}, operationsById: {}, state: { grid: {} } };
const field = { id: "f", type: "when", name: "Schedule", inputEnabled: true, meta: {} };

describe("when field pill", () => {
  it("shows a stored value, in compact and full layouts", () => {
    for (const compact of [true, false]) {
      const { container, unmount } = render(<GridActionsContext.Provider value={ctx}>
        <Field field={field} binding={{ role: "input" }} value={{ mode: "weekdays", days: [1], time: "09:00" }} compact={compact} onCommit={vi.fn()} />
      </GridActionsContext.Provider>);
      expect(container.querySelector('[data-testid="when-pill"]').textContent).toContain("Mon at 9:00am");
      unmount();
    }
  });
});
