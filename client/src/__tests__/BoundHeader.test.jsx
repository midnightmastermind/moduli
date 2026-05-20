// Smoke tests for BoundHeader (self-field + sync model). The editor renders
// and writes the HOST occurrence's own selfField; sync to linked siblings is
// covered in editorBindings.test.js (propagateBoundFieldWrite).
import { describe, it, expect, vi, beforeEach } from "vitest";
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
      host: {
        id: "host",
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

describe("BoundHeader (self-field model)", () => {
  beforeEach(() => {
    CommitHelpers.updateOccurrence.mockClear();
  });

  it("renders the host's own selfField value", () => {
    const ctx = makeCtx();
    render(
      <GridActionsContext.Provider value={ctx}>
        <BoundHeader
          hostOccurrence={ctx.occurrencesById.host}
          binding={{ selfField: "qF", link: "dateF" }}
          markdownPrefix=""
          label={"FallbackLabel"}
        />
      </GridActionsContext.Provider>
    );
    expect(screen.getAllByText(/opt-a/).length).toBeGreaterThan(0);
  });

  it("falls back to label when host has no selfField value AND field is text-type", () => {
    const ctx = makeCtx({
      occurrencesById: {
        host: { id: "host", fields: { dateF: { value: "2026-05-19" } } },
      },
      fieldsById: {
        qF: { id: "qF", name: "Question", type: "text" },
        dateF: { id: "dateF", name: "Date", type: "date" },
      },
    });
    render(
      <GridActionsContext.Provider value={ctx}>
        <BoundHeader
          hostOccurrence={ctx.occurrencesById.host}
          binding={{ selfField: "qF", link: "dateF" }}
          markdownPrefix=""
          label={"FallbackLabel"}
        />
      </GridActionsContext.Provider>
    );
    expect(screen.getByText(/FallbackLabel/)).toBeTruthy();
  });

  it("writes to the HOST occurrence (not a linked one) on dropdown change", () => {
    const ctx = makeCtx();
    render(
      <GridActionsContext.Provider value={ctx}>
        <BoundHeader
          hostOccurrence={ctx.occurrencesById.host}
          binding={{ selfField: "qF", link: "dateF" }}
          markdownPrefix=""
          label={"FallbackLabel"}
        />
      </GridActionsContext.Provider>
    );
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "opt-b" } });
    expect(CommitHelpers.updateOccurrence).toHaveBeenCalled();
    const call = CommitHelpers.updateOccurrence.mock.calls[0][0];
    expect(call.occurrence.id).toBe("host");
    expect(call.occurrence.fields.qF.value).toBe("opt-b");
  });

  it("renders dice button when field is randomizable", () => {
    const ctx = makeCtx();
    const { container } = render(
      <GridActionsContext.Provider value={ctx}>
        <BoundHeader
          hostOccurrence={ctx.occurrencesById.host}
          binding={{ selfField: "qF", link: "dateF" }}
          markdownPrefix=""
          label={"FallbackLabel"}
        />
      </GridActionsContext.Provider>
    );
    expect(container.querySelector("[data-testid='bound-header-dice']")).toBeTruthy();
  });
});
