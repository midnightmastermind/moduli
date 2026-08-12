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

  // ── The question has to be READABLE WITHOUT A POINTER ──────────────────────
  // Measured 2026-08-11 on the live grid: the <select> renders 342px wide inside
  // a 460px header at BOTH 1440px and 390px, so a full-sentence question is cut
  // off after ~7 words, and the rest used to live in a `:hover` overlay. A phone
  // has no hover — the remainder was unreachable there, permanently.
  //
  // These pin the shape that fixes it: the text is a real node OUTSIDE the
  // select (so it can overflow, and so AutoMarquee can measure it), while the
  // select stays the thing that actually writes the value.
  it("renders the selected text OUTSIDE the select, so it is readable with no hover", () => {
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
    const textLayer = container.querySelector(".bound-header-text");
    expect(textLayer).toBeTruthy();
    expect(textLayer.textContent).toContain("opt-a");
    // ...and it is NOT inside the control, which is what made it unmeasurable.
    expect(textLayer.closest("select")).toBeNull();
  });

  it("keeps the native select as the control that writes the value", () => {
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
    const select = container.querySelector("select.bound-header-native");
    expect(select).toBeTruthy();
    fireEvent.change(select, { target: { value: "opt-b" } });
    expect(CommitHelpers.updateOccurrence.mock.calls[0][0].occurrence.fields.qF.value)
      .toBe("opt-b");
  });

  // The empty-pool diagnostic (#47) used to be the select's only <option>. An
  // invisible select cannot show one, so dropping it would have turned a
  // misconfigured predicate back into a silently blank header.
  it("still surfaces the empty-pool diagnostic when nothing resolves", () => {
    const ctx = makeCtx({
      fieldsById: {
        // _resolvedOptions: [] is the honest "the predicate matched nothing"
        // state — the memo returns a stored array verbatim, so this reproduces an
        // empty pool without depending on what the real resolver does with a
        // half-configured find-mode source.
        qF: {
          id: "qF", name: "Question", type: "select",
          meta: { optionsSource: { mode: "find" }, _resolvedOptions: [] },
        },
        dateF: { id: "dateF", name: "Date", type: "date" },
      },
      occurrencesById: { host: { id: "host", fields: { dateF: { value: "2026-05-19" } } } },
    });
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
    expect(container.querySelector(".bound-header-text").textContent)
      .toMatch(/no options/i);
  });
});
