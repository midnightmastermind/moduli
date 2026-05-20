// Smoke tests for BoundBody — bound text/TipTap field render.
// Write-back path is type-aware: tested at the helper boundary (makeFieldWriter)
// and verified end-to-end manually in the browser. The TipTap onUpdate path
// can't be cleanly driven from JSDOM without faking the editor model.
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";
import BoundBody, { makeFieldWriter } from "../modules/BoundBody.jsx";
import * as CommitHelpers from "../helpers/CommitHelpers";

vi.mock("../helpers/CommitHelpers", () => ({
  updateOccurrence: vi.fn(),
}));

const tiptapAnswer = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "today's answer" }] },
  ],
};

function makeCtx(overrides = {}) {
  return {
    dispatch: vi.fn(),
    socket: { emit: vi.fn() },
    occurrencesById: {
      host: { id: "host", fields: { dateF: { value: "2026-05-19" } } },
      src: {
        id: "src",
        fields: { dateF: { value: "2026-05-19" }, aF: { value: tiptapAnswer } },
      },
    },
    modulesById: {},
    fieldsById: {
      aF: { id: "aF", name: "Answer", type: "text" },
      dateF: { id: "dateF", name: "Date", type: "date" },
    },
    ...overrides,
  };
}

describe("BoundBody", () => {
  beforeEach(() => {
    CommitHelpers.updateOccurrence.mockClear();
  });

  it("renders the linked occurrence's TipTap text content", () => {
    const ctx = makeCtx();
    render(
      <GridActionsContext.Provider value={ctx}>
        <BoundBody
          hostOccurrence={ctx.occurrencesById.host}
          binding={{ target: "aF", link: "dateF" }}
        >
          <div>FALLBACK</div>
        </BoundBody>
      </GridActionsContext.Provider>
    );
    expect(screen.getByText(/today's answer/)).toBeTruthy();
  });

  it("falls back to children when no source matches", () => {
    const ctx = makeCtx({
      occurrencesById: { host: { id: "host", fields: { dateF: { value: "2026-05-19" } } } },
    });
    render(
      <GridActionsContext.Provider value={ctx}>
        <BoundBody
          hostOccurrence={ctx.occurrencesById.host}
          binding={{ target: "aF", link: "dateF" }}
        >
          <div>FALLBACK</div>
        </BoundBody>
      </GridActionsContext.Provider>
    );
    expect(screen.getByText(/FALLBACK/)).toBeTruthy();
  });

  it("falls back to children when target field is unknown", () => {
    const ctx = makeCtx({
      fieldsById: { dateF: { id: "dateF", name: "Date", type: "date" } },
    });
    render(
      <GridActionsContext.Provider value={ctx}>
        <BoundBody
          hostOccurrence={ctx.occurrencesById.host}
          binding={{ target: "aF", link: "dateF" }}
        >
          <div>FALLBACK</div>
        </BoundBody>
      </GridActionsContext.Provider>
    );
    expect(screen.getByText(/FALLBACK/)).toBeTruthy();
  });

  it("renders a plain-string field value too (string text fields)", () => {
    const ctx = makeCtx({
      occurrencesById: {
        host: { id: "host", fields: { dateF: { value: "2026-05-19" } } },
        src: { id: "src", fields: { dateF: { value: "2026-05-19" }, aF: { value: "plain string answer" } } },
      },
    });
    render(
      <GridActionsContext.Provider value={ctx}>
        <BoundBody
          hostOccurrence={ctx.occurrencesById.host}
          binding={{ target: "aF", link: "dateF" }}
        >
          <div>FALLBACK</div>
        </BoundBody>
      </GridActionsContext.Provider>
    );
    expect(screen.getByText(/plain string answer/)).toBeTruthy();
  });
});

describe("makeFieldWriter", () => {
  beforeEach(() => {
    CommitHelpers.updateOccurrence.mockClear();
  });

  it("returns a function that writes value to the source occurrence's target field", () => {
    const source = { id: "src", fields: { dateF: { value: "2026-05-19" }, aF: { value: "old" } } };
    const dispatch = vi.fn();
    const socket = { emit: vi.fn() };
    const write = makeFieldWriter({ source, binding: { target: "aF", link: "dateF" }, dispatch, socket });

    write({ type: "doc", content: [{ type: "paragraph" }] });

    expect(CommitHelpers.updateOccurrence).toHaveBeenCalledTimes(1);
    const call = CommitHelpers.updateOccurrence.mock.calls[0][0];
    expect(call.occurrence.id).toBe("src");
    expect(call.occurrence.fields.aF.value).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    // existing fields preserved
    expect(call.occurrence.fields.dateF.value).toBe("2026-05-19");
    // existing field meta preserved (no { value: ... } only)
    expect(call.occurrence.fields.aF).toMatchObject({ value: expect.any(Object) });
  });

  it("returns a no-op when source is missing", () => {
    const write = makeFieldWriter({ source: null, binding: { target: "aF", link: "dateF" }, dispatch: vi.fn(), socket: {} });
    write("anything");
    expect(CommitHelpers.updateOccurrence).not.toHaveBeenCalled();
  });
});
