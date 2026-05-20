// Smoke tests for BoundHeader — type-dispatched render of a bound field value
// in container-header position.
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";
import BoundHeader from "../modules/BoundHeader.jsx";
import * as CommitHelpers from "../helpers/CommitHelpers";

vi.mock("../helpers/CommitHelpers", () => ({
  updateOccurrence: vi.fn(),
  updateModule: vi.fn(),
}));

function makeCtx(overrides = {}) {
  return {
    dispatch: vi.fn(),
    socket: { emit: vi.fn() },
    occurrencesById: {
      host: { id: "host", fields: { dateF: { value: "2026-05-19" } } },
      src: {
        id: "src",
        fields: { dateF: { value: "2026-05-19" }, qF: { value: "opt-a" } },
      },
    },
    modulesById: {},
    fieldsById: {
      qF: {
        id: "qF",
        name: "Question",
        type: "select",
        meta: {
          optionsSource: { mode: "manual", manual: ["opt-a", "opt-b"] },
          randomizable: true,
          _resolvedOptions: [
            { value: "opt-a", label: "opt-a" },
            { value: "opt-b", label: "opt-b" },
          ],
        },
      },
      dateF: { id: "dateF", name: "Date", type: "date" },
    },
    ...overrides,
  };
}

describe("BoundHeader", () => {
  it("renders the linked occurrence's select value", () => {
    const ctx = makeCtx();
    render(
      <GridActionsContext.Provider value={ctx}>
        <BoundHeader
          hostOccurrence={ctx.occurrencesById.host}
          binding={{ target: "qF", link: "dateF" }}
          markdownPrefix=""
          label={"FallbackLabel"}
        />
      </GridActionsContext.Provider>
    );
    expect(screen.getAllByText(/opt-a/).length).toBeGreaterThan(0);
  });

  it("falls back to the label when no source occurrence matches", () => {
    const ctx = makeCtx({
      occurrencesById: {
        host: { id: "host", fields: { dateF: { value: "2026-05-19" } } },
      },
    });
    render(
      <GridActionsContext.Provider value={ctx}>
        <BoundHeader
          hostOccurrence={ctx.occurrencesById.host}
          binding={{ target: "qF", link: "dateF" }}
          markdownPrefix=""
          label={"FallbackLabel"}
        />
      </GridActionsContext.Provider>
    );
    expect(screen.getByText(/FallbackLabel/)).toBeTruthy();
  });

  it("calls CommitHelpers.updateOccurrence on the SOURCE occurrence when the dropdown changes", () => {
    CommitHelpers.updateOccurrence.mockClear();
    const ctx = makeCtx();
    render(
      <GridActionsContext.Provider value={ctx}>
        <BoundHeader
          hostOccurrence={ctx.occurrencesById.host}
          binding={{ target: "qF", link: "dateF" }}
          markdownPrefix=""
          label={"FallbackLabel"}
        />
      </GridActionsContext.Provider>
    );
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "opt-b" } });
    expect(CommitHelpers.updateOccurrence).toHaveBeenCalled();
    const call = CommitHelpers.updateOccurrence.mock.calls.at(-1)[0];
    expect(call.occurrence.id).toBe("src");
    expect(call.occurrence.fields.qF.value).toBe("opt-b");
  });

  it("renders dice button when field is randomizable", () => {
    const ctx = makeCtx();
    const { container } = render(
      <GridActionsContext.Provider value={ctx}>
        <BoundHeader
          hostOccurrence={ctx.occurrencesById.host}
          binding={{ target: "qF", link: "dateF" }}
          markdownPrefix=""
          label={"FallbackLabel"}
        />
      </GridActionsContext.Provider>
    );
    expect(container.querySelector("[data-testid='bound-header-dice']")).toBeTruthy();
  });
});
