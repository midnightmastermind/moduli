// Tests for editor↔field binding helpers (self-field + sync model).
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveEditorBinding,
  findLinkedSiblings,
  sameLinkValue,
} from "../state/editorBindings.js";
import { propagateBoundFieldWrite } from "../helpers/boundFieldSync.js";
import * as CommitHelpers from "../helpers/CommitHelpers";

vi.mock("../helpers/CommitHelpers", () => ({
  updateOccurrence: vi.fn(),
}));

describe("resolveEditorBinding", () => {
  it("returns null when neither occurrence nor module sets the slot", () => {
    expect(resolveEditorBinding({ occurrence: {}, module: {}, slot: "header" })).toBeNull();
  });

  it("returns the module binding when occurrence has none", () => {
    const b = { selfField: "f1", link: "f2" };
    expect(
      resolveEditorBinding({ occurrence: {}, module: { meta: { headerLink: b } }, slot: "header" })
    ).toBe(b);
  });

  it("occurrence binding wins over module binding", () => {
    const m = { selfField: "f1", link: "f2" };
    const o = { selfField: "f3", link: "f4" };
    expect(
      resolveEditorBinding({
        occurrence: { meta: { headerLink: o } },
        module: { meta: { headerLink: m } },
        slot: "header",
      })
    ).toBe(o);
  });

  it("treats occurrence's 'clear' string as explicit opt-out", () => {
    const m = { selfField: "f1", link: "f2" };
    expect(
      resolveEditorBinding({
        occurrence: { meta: { headerLink: "clear" } },
        module: { meta: { headerLink: m } },
        slot: "header",
      })
    ).toBeNull();
  });

  it("slot is scoped (body link does not bleed into header)", () => {
    const body = { selfField: "fA", link: "fB" };
    expect(
      resolveEditorBinding({ occurrence: {}, module: { meta: { bodyLink: body } }, slot: "header" })
    ).toBeNull();
    expect(
      resolveEditorBinding({ occurrence: {}, module: { meta: { bodyLink: body } }, slot: "body" })
    ).toBe(body);
  });

  it("rejects malformed bindings (missing selfField or link)", () => {
    expect(
      resolveEditorBinding({
        occurrence: {},
        module: { meta: { headerLink: { selfField: "f1" } } },
        slot: "header",
      })
    ).toBeNull();
  });
});

describe("sameLinkValue", () => {
  it("compares strings by equality", () => {
    expect(sameLinkValue("a", "a")).toBe(true);
    expect(sameLinkValue("a", "b")).toBe(false);
  });

  it("treats ISO date strings as SAME_DAY", () => {
    expect(sameLinkValue("2026-05-19T03:00:00.000Z", "2026-05-19T22:00:00.000Z")).toBe(true);
    expect(sameLinkValue("2026-05-19", "2026-05-19T10:00:00.000Z")).toBe(true);
    expect(sameLinkValue("2026-05-19", "2026-05-20")).toBe(false);
  });

  it("returns false when either side is null/undefined", () => {
    expect(sameLinkValue(null, "x")).toBe(false);
    expect(sameLinkValue("x", undefined)).toBe(false);
  });
});

describe("findLinkedSiblings", () => {
  const baseMap = {
    host: {
      id: "host",
      fields: { dateF: { value: "2026-05-19" }, qF: { value: "today's pick" } },
    },
    sib1: {
      id: "sib1",
      fields: { dateF: { value: "2026-05-19" }, qF: { value: "stale" } },
    },
    sib2: {
      id: "sib2",
      fields: { dateF: { value: "2026-05-20" }, qF: { value: "other day" } },
    },
    sib3: {
      // Same date, but missing the self field — not a sibling for this binding.
      id: "sib3",
      fields: { dateF: { value: "2026-05-19" } },
    },
    sib4: {
      // Same date, has the field, but value already equals next — skipped.
      id: "sib4",
      fields: { dateF: { value: "2026-05-19" }, qF: { value: "today's pick" } },
    },
  };

  it("returns occurrences sharing link value AND carrying the selfField", () => {
    const out = findLinkedSiblings({
      binding: { selfField: "qF", link: "dateF" },
      hostOccurrence: baseMap.host,
      occurrencesById: baseMap,
      nextValue: "today's pick",
    });
    const ids = out.map((o) => o.id);
    expect(ids).toContain("sib1");
    expect(ids).not.toContain("sib2"); // different date
    expect(ids).not.toContain("sib3"); // missing field
    expect(ids).not.toContain("sib4"); // value already matches nextValue
    expect(ids).not.toContain("host"); // host is excluded
  });

  it("returns [] when host has no link-field value", () => {
    expect(
      findLinkedSiblings({
        binding: { selfField: "qF", link: "dateF" },
        hostOccurrence: { id: "hostX", fields: {} },
        occurrencesById: baseMap,
        nextValue: "anything",
      })
    ).toEqual([]);
  });
});

describe("propagateBoundFieldWrite", () => {
  beforeEach(() => CommitHelpers.updateOccurrence.mockClear());

  it("writes nextValue to every linked sibling's selfField", () => {
    const occurrencesById = {
      host: {
        id: "host",
        fields: { dateF: { value: "2026-05-19" }, qF: { value: "new pick" } },
      },
      sib1: {
        id: "sib1",
        fields: { dateF: { value: "2026-05-19" }, qF: { value: "stale" } },
      },
      sib2: {
        id: "sib2",
        fields: { dateF: { value: "2026-05-20" }, qF: { value: "other day" } },
      },
    };
    propagateBoundFieldWrite({
      hostOccurrence: occurrencesById.host,
      binding: { selfField: "qF", link: "dateF" },
      nextValue: "new pick",
      occurrencesById,
      dispatch: vi.fn(),
      socket: { emit: vi.fn() },
    });
    expect(CommitHelpers.updateOccurrence).toHaveBeenCalledTimes(1);
    const call = CommitHelpers.updateOccurrence.mock.calls[0][0];
    expect(call.occurrence.id).toBe("sib1");
    expect(call.occurrence.fields.qF.value).toBe("new pick");
  });

  it("is a no-op when binding is missing", () => {
    propagateBoundFieldWrite({
      hostOccurrence: { id: "host", fields: {} },
      binding: null,
      nextValue: "x",
      occurrencesById: {},
      dispatch: vi.fn(),
      socket: { emit: vi.fn() },
    });
    expect(CommitHelpers.updateOccurrence).not.toHaveBeenCalled();
  });
});
