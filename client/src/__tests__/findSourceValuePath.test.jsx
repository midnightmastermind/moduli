// A NEW "Find" OPTIONS SOURCE STORES AN ID ON AN OCCURRENCE FIELD.
//
// Found 2026-09-23 while wiring the ancestor-chain crumbs the user asked for:
// the rebuild grid's only occurrence field could not show a collision at all,
// because a UI-made find source defaulted to `valuePath: "label"`.
//
// Measured across every grid: of 106 find-mode fields, 101 key their options by
// `id` and 5 by `label`. The editor shipped the minority shape as the default
// for BOTH field types, and on an occurrence field it is wrong twice over:
//
//   - the stored value becomes a label STRING rather than a reference, so
//     renaming the row silently breaks every field pointing at it;
//   - `resolveOptions` de-duplicates options BY VALUE, so a board holding four
//     rows called "Stretch" collapses to ONE pickable option.
//
// A SELECT is the opposite case and keeps "label": there the value IS the
// label, which is why this is a per-type default and not a blanket change.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";

vi.mock("../../blocks/ConditionGroup", () => ({ default: () => null }));

import SelectOptionsSourceEditor from "../ui/commandCenter/SelectOptionsSourceEditor";

function renderEditor(fieldType, onChange) {
  const ctx = {
    dispatch: vi.fn(), socket: null, gridId: "g1",
    occurrencesById: {}, modulesById: {}, fieldsById: {}, foldersById: {},
    getOccMap: () => ({}), state: { grid: {} },
  };
  return render(
    <GridActionsContext.Provider value={ctx}>
      <SelectOptionsSourceEditor
        source={{ mode: "manual", values: [] }}
        fieldType={fieldType}
        onChange={onChange}
      />
    </GridActionsContext.Provider>
  );
}
const findBtn = (c, label) =>
  [...c.querySelectorAll("button")].find(b => b.textContent.trim() === label);

describe("switching a source to Find", () => {
  it("an OCCURRENCE field keys its options by id, showing the label", () => {
    const onChange = vi.fn();
    const { container } = renderEditor("occurrence", onChange);
    fireEvent.click(findBtn(container, "Find"));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(next.mode).toBe("find");
    expect(next.find.valuePath).toBe("id");
    expect(next.find.labelPath).toBe("label");
  });

  it("a SELECT field still keys by label — there the value IS the label", () => {
    // The control. Without it, "occurrence uses id" is equally satisfied by a
    // blanket change that breaks every select.
    const onChange = vi.fn();
    const { container } = renderEditor("select", onChange);
    fireEvent.click(findBtn(container, "Find"));
    const next = onChange.mock.calls[0][0];
    expect(next.find.valuePath).toBe("label");
    expect(next.find.labelPath).toBeUndefined();
  });

  it("both keep the rest of the find shape", () => {
    for (const t of ["occurrence", "select"]) {
      const onChange = vi.fn();
      const { container } = renderEditor(t, onChange);
      fireEvent.click(findBtn(container, "Find"));
      const { find } = onChange.mock.calls[0][0];
      expect(find.over).toBe("$allInstances");
      expect(find.predicate).toEqual({ rules: [] });
    }
  });
});

describe("why it matters — the shape the default produced", () => {
  it("an id-keyed source keeps same-named rows pickable; a label-keyed one collapses them", async () => {
    const { resolveOptions } = await import("../helpers/optionsResolver");
    const ctx = {
      occurrencesById: {
        s1: { id: "s1", moduleId: "m", fields: {} },
        s2: { id: "s2", moduleId: "m", fields: {} },
        s3: { id: "s3", moduleId: "m", fields: {} },
      },
      modulesById: { m: { id: "m", label: "Stretch", role: "instance" } },
      fieldsById: {}, foldersById: {},
    };
    const mk = (find) => ({ type: "occurrence", meta: { optionsSource: { mode: "find", find } } });
    const base = { over: "$allInstances", predicate: { rules: [] } };

    const byLabel = resolveOptions(mk({ ...base, valuePath: "label" }), ctx);
    const byId = resolveOptions(mk({ ...base, valuePath: "id", labelPath: "label" }), ctx);

    expect(byLabel.options).toHaveLength(1);   // three rows, ONE pickable option
    expect(byId.options).toHaveLength(3);      // all three reachable
  });
});
