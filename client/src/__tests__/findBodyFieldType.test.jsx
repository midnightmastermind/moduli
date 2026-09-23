// OPENING AN OCCURRENCE FIELD WHITE-SCREENED THE WHOLE APP.
//
// Found building `Occupational › Employment` on poms through the UI
// (2026-09-23): clicking the `Appointment Type` chip in the Command Center's
// Fields tab threw
//
//   ReferenceError: fieldType is not defined
//
// and took the entire app down with it — `document.getElementById("root")`
// measured **0 bytes of HTML** afterwards, i.e. not a broken panel, a blank
// page. The probe read it as "the Command Center closed"; the page-error
// listener is what said otherwise.
//
// `FindBody({ source, onChange })` calls `findValueDefaults(fieldType)` and
// never receives `fieldType` — it is a prop of the PARENT
// (`SelectOptionsSourceEditor`), one component up. It only throws on the
// branch that evaluates it: `source?.find` must be MISSING, which is exactly
// the live shape — poms' occurrence fields store the find config FLAT
// (`{mode:"find", over, predicate, …}`, no nested `find` key), so `source.find`
// is undefined and the `||` fallback runs.
//
// That flat-vs-nested split is why this survived: a field whose options were
// authored in this editor nests them and never reaches the throw.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import SelectOptionsSourceEditor from "../ui/commandCenter/SelectOptionsSourceEditor.jsx";

vi.mock("../helpers/GridActionsContext", () => ({
  useGridActions: () => ({ fieldsById: {}, modulesById: {}, occurrencesById: {}, foldersById: {} }),
  GridActionsContext: React.createContext({}),
}));

// The live shape: mode "find" with the config FLAT, no nested `find` object.
const LIVE_FLAT_SOURCE = {
  mode: "find",
  over: "$allInstances",
  predicate: { operator: "AND", rules: [{ left: "fields.abc.value", comparator: "CONTAINS", right: "appointment" }] },
  valuePath: "id",
  labelPath: "label",
};

describe("opening an occurrence field's options editor", () => {
  it("renders instead of throwing — this is the white-screen", () => {
    expect(() =>
      render(<SelectOptionsSourceEditor source={LIVE_FLAT_SOURCE} onChange={() => {}} fieldType="occurrence" />),
    ).not.toThrow();
  });

  // The CONTROL. "it does not throw" is equally satisfied by a component that
  // renders nothing at all, so pin that the find editor actually came up.
  it("shows the find-mode editor it was asked for", () => {
    render(<SelectOptionsSourceEditor source={LIVE_FLAT_SOURCE} onChange={() => {}} fieldType="occurrence" />);
    expect(screen.getByText(/find/i)).toBeTruthy();
  });

  // A select field reaches the same component and must keep working — it is
  // the case that never crashed, so it guards against "fix it by deleting the
  // branch".
  it("a select field's find editor still renders", () => {
    expect(() =>
      render(<SelectOptionsSourceEditor source={LIVE_FLAT_SOURCE} onChange={() => {}} fieldType="select" />),
    ).not.toThrow();
  });

  // And the nested shape — what this editor itself writes — must still work,
  // or the fix would trade one crash for another.
  it("the nested shape this editor writes still renders", () => {
    expect(() =>
      render(
        <SelectOptionsSourceEditor
          source={{ mode: "find", find: { over: "$allInstances", predicate: { rules: [] } } }}
          onChange={() => {}}
          fieldType="occurrence"
        />,
      ),
    ).not.toThrow();
  });
});
