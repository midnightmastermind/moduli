// The "Ask with a form" step's editor mounts through the operation editor (2026-10-25: picking it threw
// "fieldsById is not defined" — the schema field renderer has `fields`, never `fieldsById`; the builder's own
// test mounted FormItemsEditor directly and never went through this path).
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "@testing-library/react";

const { ActionConfig } = await import("../blocks/OperationsBuilder");

describe("ASK_FORM in the operation editor", () => {
  it("renders the form builder, and a field item shows its field", () => {
    const fields = [{ id: "f1", name: "Rating", type: "number" }];
    const { getByTestId, getAllByLabelText } = render(
      <ActionConfig actionType="ASK_FORM" cfg={{ items: [{ key: "rating", label: "Rating", fieldId: "f1" }] }} setCfg={vi.fn()}
        fields={fields} varOptions={[]} localVars={[]} modulesById={{}} occurrencesById={{}} operationsById={{}} sources={[]} />,
    );
    expect(getByTestId("form-items-editor")).toBeTruthy();
    expect(getAllByLabelText("Label")[0].value).toBe("Rating");
  });
});
