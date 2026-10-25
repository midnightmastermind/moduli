// A button field's settings list the operations LISTENING to it (an On Button trigger on that field); the button
// itself picks no operation (user, 2026-10-25: "the button does nothing until we add a listener for it").
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { buttonListeners } from "../helpers/buttonRun.js";

const listen = (id, name, fieldId, extra = {}) => ({
  id, name, enabled: true, triggerTypes: ["onButton"],
  triggerObjects: [{ eventType: "onButton", subjectType: "field", targetId: fieldId }], ...extra,
});

describe("buttonListeners", () => {
  const ops = {
    a: listen("a", "Add movie", "f1"),
    b: listen("b", "Other button", "f2"),
    c: { id: "c", name: "Any button", enabled: true, triggerTypes: ["onButton"], triggerObjects: [{ eventType: "onButton", subjectType: "grid", targetId: "" }] },
    d: listen("d", "Off", "f1", { enabled: false }),
    e: listen("e", "Alarm", "f1", { alarm: { time: "1" } }),
    g: listen("g", "Also add movie", "f1"),
  };
  it("is every enabled operation with an On Button trigger on THIS field", () => {
    expect(buttonListeners("f1", ops).map((o) => o.id)).toEqual(["a", "g"]);
  });
  it("an unscoped On Button trigger is not a listener; nothing listens to an unknown field", () => {
    expect(buttonListeners("f3", ops)).toEqual([]);
    expect(buttonListeners(null, ops)).toEqual([]);
  });
});

describe("the button field's settings", () => {
  it("names its listeners and opens one on click; says so when none listen", async () => {
    vi.resetModules();
    const ops = { a: listen("a", "Add movie", "f1") };
    vi.doMock("../GridActionsContext", async (orig) => ({ ...(await orig()), useGridActions: () => ({ modulesById: {}, fieldsById: {}, operationsById: ops, state: {} }) }));
    const { FieldDetail } = await import("../ui/commandCenter/FieldsTab.jsx");
    const { takeRequestedOperation } = await import("../helpers/buttonOperation.js");
    const field = { id: "f1", name: "New movie", type: "button", meta: { buttonLabel: "New movie" } };
    const { getByTestId, getByText } = render(<FieldDetail field={field} onSave={() => {}} />);
    expect(getByTestId("button-listeners").textContent).toMatch(/Add movie/);
    fireEvent.click(getByText("Add movie"));
    expect(takeRequestedOperation()).toBe("a");
    const none = render(<FieldDetail field={{ ...field, id: "f9" }} onSave={() => {}} />);
    expect(none.getAllByTestId("button-listeners").at(-1).textContent).toMatch(/Nothing yet/);
    expect(document.body.textContent).not.toMatch(/Operation to run|New operation for this button/);
  }, 30000); // importing the whole Fields tab can take seconds under full-suite load
});
