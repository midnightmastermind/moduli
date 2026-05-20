// Smoke tests for BoundBody — read-only render of a bound text/TipTap field
// in textblock-body position. (Bidirectional write-back covered in Task 4.)
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";
import BoundBody from "../modules/BoundBody.jsx";

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

describe("BoundBody (read-only)", () => {
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

  it("falls back to children when no source occurrence matches", () => {
    const ctx = makeCtx({
      occurrencesById: {
        host: { id: "host", fields: { dateF: { value: "2026-05-19" } } },
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
    expect(screen.getByText(/FALLBACK/)).toBeTruthy();
  });

  it("falls back to children when target field is unknown", () => {
    const ctx = makeCtx({ fieldsById: { dateF: { id: "dateF", name: "Date", type: "date" } } });
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

  it("renders a plain-string field value too", () => {
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
