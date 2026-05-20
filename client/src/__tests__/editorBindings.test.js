// Tests for editor↔field binding helpers: resolveEditorBinding cascade,
// sameLinkValue (with SAME_DAY for ISO date strings), and the JOIN walker
// findLinkedOccurrence.
import { describe, it, expect } from "vitest";
import {
  resolveEditorBinding,
  findLinkedOccurrence,
  sameLinkValue,
} from "../state/editorBindings.js";

describe("resolveEditorBinding", () => {
  it("returns null when neither occurrence nor module sets the slot", () => {
    expect(resolveEditorBinding({ occurrence: {}, module: {}, slot: "header" })).toBeNull();
  });

  it("returns the module binding when occurrence has none", () => {
    const b = { target: "f1", link: "f2" };
    expect(
      resolveEditorBinding({ occurrence: {}, module: { meta: { headerLink: b } }, slot: "header" })
    ).toBe(b);
  });

  it("occurrence binding wins over module binding", () => {
    const m = { target: "f1", link: "f2" };
    const o = { target: "f3", link: "f4" };
    expect(
      resolveEditorBinding({
        occurrence: { meta: { headerLink: o } },
        module: { meta: { headerLink: m } },
        slot: "header",
      })
    ).toBe(o);
  });

  it("treats occurrence's 'clear' string as explicit opt-out (no binding even if module sets one)", () => {
    const m = { target: "f1", link: "f2" };
    expect(
      resolveEditorBinding({
        occurrence: { meta: { headerLink: "clear" } },
        module: { meta: { headerLink: m } },
        slot: "header",
      })
    ).toBeNull();
  });

  it("slot is scoped (body link does not bleed into header)", () => {
    const body = { target: "fA", link: "fB" };
    expect(
      resolveEditorBinding({ occurrence: {}, module: { meta: { bodyLink: body } }, slot: "header" })
    ).toBeNull();
    expect(
      resolveEditorBinding({ occurrence: {}, module: { meta: { bodyLink: body } }, slot: "body" })
    ).toBe(body);
  });

  it("rejects malformed bindings (missing target/link)", () => {
    expect(
      resolveEditorBinding({
        occurrence: {},
        module: { meta: { headerLink: { target: "f1" } } },
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

  it("compares numbers by equality", () => {
    expect(sameLinkValue(1, 1)).toBe(true);
    expect(sameLinkValue(1, 2)).toBe(false);
  });

  it("treats ISO date strings as SAME_DAY", () => {
    expect(sameLinkValue("2026-05-19T03:00:00.000Z", "2026-05-19T22:00:00.000Z")).toBe(true);
    expect(sameLinkValue("2026-05-19", "2026-05-19T10:00:00.000Z")).toBe(true);
    expect(sameLinkValue("2026-05-19", "2026-05-20")).toBe(false);
  });

  it("returns false when either side is null/undefined", () => {
    expect(sameLinkValue(null, "x")).toBe(false);
    expect(sameLinkValue("x", undefined)).toBe(false);
    expect(sameLinkValue(null, null)).toBe(false);
  });
});

describe("findLinkedOccurrence", () => {
  const occurrencesById = {
    host1: { id: "host1", fields: { dateF: { value: "2026-05-19" } } },
    src1: {
      id: "src1",
      fields: { dateF: { value: "2026-05-19" }, qF: { value: "Q for today" } },
    },
    src2: {
      id: "src2",
      fields: { dateF: { value: "2026-05-20" }, qF: { value: "Q tomorrow" } },
    },
    src3: {
      // matches link but has no target value
      id: "src3",
      fields: { dateF: { value: "2026-05-19" } },
    },
  };

  it("returns the matching occurrence by link field + non-empty target", () => {
    const r = findLinkedOccurrence({
      binding: { target: "qF", link: "dateF" },
      hostOccurrence: occurrencesById.host1,
      occurrencesById,
    });
    expect(r?.id).toBe("src1");
  });

  it("skips the host itself", () => {
    const host = {
      id: "src1",
      fields: { dateF: { value: "2026-05-19" }, qF: { value: "Q for today (self)" } },
    };
    // The host IS src1; without anybody else matching, no other occurrence has
    // both the link AND a non-empty target, so this resolves to null.
    const map = {
      src1: host,
      src3: occurrencesById.src3,
    };
    const r = findLinkedOccurrence({
      binding: { target: "qF", link: "dateF" },
      hostOccurrence: host,
      occurrencesById: map,
    });
    expect(r).toBeNull();
  });

  it("returns null when host has no link-field value", () => {
    const r = findLinkedOccurrence({
      binding: { target: "qF", link: "dateF" },
      hostOccurrence: { id: "hostX", fields: {} },
      occurrencesById,
    });
    expect(r).toBeNull();
  });

  it("returns null when no occurrence has both matching link and target", () => {
    const r = findLinkedOccurrence({
      binding: { target: "qF", link: "dateF" },
      hostOccurrence: { id: "hostY", fields: { dateF: { value: "2099-01-01" } } },
      occurrencesById,
    });
    expect(r).toBeNull();
  });

  it("matches across timezone-shifted ISO date strings (SAME_DAY semantics)", () => {
    // Isolated map so only the timezone-shifted source can match the host.
    const map = {
      hostTz: { id: "hostTz", fields: { dateF: { value: "2026-06-01T23:30:00.000Z" } } },
      srcTz: {
        id: "srcTz",
        fields: { dateF: { value: "2026-06-01T00:01:00.000Z" }, qF: { value: "tz match" } },
      },
    };
    const r = findLinkedOccurrence({
      binding: { target: "qF", link: "dateF" },
      hostOccurrence: map.hostTz,
      occurrencesById: map,
    });
    expect(r?.id).toBe("srcTz");
  });
});
