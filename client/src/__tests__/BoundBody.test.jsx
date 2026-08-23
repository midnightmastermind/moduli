// Smoke tests for BoundBody (self-field + sync model). The editor reads
// and writes the HOST's own selfField; sync covered in editorBindings.test.js.
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { GridActionsContext } from "../GridActionsContext";
import BoundBody, { makeFieldWriter, badgeState } from "../modules/BoundBody.jsx";
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
      host: {
        id: "host",
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

describe("BoundBody (self-field model)", () => {
  beforeEach(() => {
    CommitHelpers.updateOccurrence.mockClear();
  });

  it("renders the host's own selfField TipTap content", () => {
    const ctx = makeCtx();
    render(
      <GridActionsContext.Provider value={ctx}>
        <BoundBody
          hostOccurrence={ctx.occurrencesById.host}
          binding={{ selfField: "aF", link: "dateF" }}
        >
          <div>FALLBACK</div>
        </BoundBody>
      </GridActionsContext.Provider>
    );
    expect(screen.getByText(/today's answer/)).toBeTruthy();
  });

  it("falls back to children when host is missing", () => {
    const ctx = makeCtx();
    render(
      <GridActionsContext.Provider value={ctx}>
        <BoundBody
          hostOccurrence={null}
          binding={{ selfField: "aF", link: "dateF" }}
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
          binding={{ selfField: "aF", link: "dateF" }}
        >
          <div>FALLBACK</div>
        </BoundBody>
      </GridActionsContext.Provider>
    );
    expect(screen.getByText(/FALLBACK/)).toBeTruthy();
  });

  it("renders a plain-string field value too (text fields can hold strings)", () => {
    const ctx = makeCtx({
      occurrencesById: {
        host: {
          id: "host",
          fields: { dateF: { value: "2026-05-19" }, aF: { value: "plain string answer" } },
        },
      },
    });
    render(
      <GridActionsContext.Provider value={ctx}>
        <BoundBody
          hostOccurrence={ctx.occurrencesById.host}
          binding={{ selfField: "aF", link: "dateF" }}
        >
          <div>FALLBACK</div>
        </BoundBody>
      </GridActionsContext.Provider>
    );
    expect(screen.getByText(/plain string answer/)).toBeTruthy();
  });
});

describe("makeFieldWriter (self-field model)", () => {
  beforeEach(() => CommitHelpers.updateOccurrence.mockClear());

  it("writes nextValue to the HOST occurrence (not a linked one)", () => {
    const host = {
      id: "host",
      fields: { dateF: { value: "2026-05-19" }, aF: { value: "old" } },
    };
    const write = makeFieldWriter({
      host,
      binding: { selfField: "aF", link: "dateF" },
      occurrencesById: { host },
      dispatch: vi.fn(),
      socket: { emit: vi.fn() },
    });
    write({ type: "doc", content: [{ type: "paragraph" }] });
    expect(CommitHelpers.updateOccurrence).toHaveBeenCalled();
    // First call is the host write; sync may produce additional calls
    const hostCall = CommitHelpers.updateOccurrence.mock.calls[0][0];
    expect(hostCall.occurrence.id).toBe("host");
    expect(hostCall.occurrence.fields.aF.value).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("returns a no-op when host is missing", () => {
    const write = makeFieldWriter({
      host: null,
      binding: { selfField: "aF", link: "dateF" },
      occurrencesById: {},
      dispatch: vi.fn(),
      socket: {},
    });
    write("anything");
    expect(CommitHelpers.updateOccurrence).not.toHaveBeenCalled();
  });

  it("also propagates the write to linked siblings sharing the link value", () => {
    const host = {
      id: "host",
      fields: { dateF: { value: "2026-05-19" }, aF: { value: "old" } },
    };
    const sibling = {
      id: "sib1",
      fields: { dateF: { value: "2026-05-19" }, aF: { value: "stale" } },
    };
    const write = makeFieldWriter({
      host,
      binding: { selfField: "aF", link: "dateF" },
      occurrencesById: { host, sib1: sibling },
      dispatch: vi.fn(),
      socket: { emit: vi.fn() },
    });
    write("synced value");
    // First write: host. Second write: propagated to sib1.
    expect(CommitHelpers.updateOccurrence).toHaveBeenCalledTimes(2);
    const second = CommitHelpers.updateOccurrence.mock.calls[1][0];
    expect(second.occurrence.id).toBe("sib1");
    expect(second.occurrence.fields.aF.value).toBe("synced value");
  });
});


// THREE states, not two. A binding with no `link` is per-occurrence BY DESIGN
// (the instance notes body) — calling that a "Broken link" tells the user
// something is wrong with a body that is working exactly as authored.
describe("badgeState", () => {
  it("reports 'unlinked' when the binding declares no link", () => {
    expect(badgeState({ binding: { selfField: "notes" }, isLinked: false })).toBe("unlinked");
    // isLinked cannot be true without a link, but it must not flip the answer.
    expect(badgeState({ binding: { selfField: "notes" }, isLinked: true })).toBe("unlinked");
    expect(badgeState({ binding: { selfField: "notes", link: "" }, isLinked: false })).toBe("unlinked");
  });

  it("still distinguishes linked from broken when a link IS declared", () => {
    expect(badgeState({ binding: { selfField: "a", link: "d" }, isLinked: true })).toBe("linked");
    expect(badgeState({ binding: { selfField: "a", link: "d" }, isLinked: false })).toBe("broken");
  });
});
