// Tests for editor↔field binding helpers (self-field + sync model).
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resolveEditorBinding,
  resolveInstanceBodyBinding,
  findLinkedSiblings,
  sameLinkValue,
  isSyncingBinding,
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

  // REWRITTEN 2026-08-23. This case used to assert that `{selfField}` with no
  // `link` is malformed. It is not: a link-less binding is the instance notes
  // body — per-occurrence by design, and inert for propagation (see the
  // findLinkedSiblings cases below). The genuinely malformed shapes are the
  // ones with no selfField, or that are not an object at all.
  it("rejects malformed bindings (no selfField, or not an object)", () => {
    const bad = [{ link: "f2" }, "nope", 42, [], null];
    for (const headerLink of bad) {
      expect(
        resolveEditorBinding({ occurrence: {}, module: { meta: { headerLink } }, slot: "header" })
      ).toBeNull();
    }
  });

  it("accepts a binding that declares NO link (per-occurrence body)", () => {
    const b = { selfField: "notes" };
    expect(
      resolveEditorBinding({ occurrence: {}, module: { meta: { bodyLink: b } }, slot: "body" })
    ).toBe(b);
  });

  it("falls back to the caller's gridDefault when neither occurrence nor module binds", () => {
    const g = { selfField: "notes" };
    expect(
      resolveEditorBinding({ occurrence: {}, module: {}, slot: "body", gridDefault: g })
    ).toBe(g);
  });

  it("a module binding WINS over the gridDefault", () => {
    const m = { selfField: "f1", link: "f2" };
    const g = { selfField: "notes" };
    expect(
      resolveEditorBinding({
        occurrence: {},
        module: { meta: { bodyLink: m } },
        slot: "body",
        gridDefault: g,
      })
    ).toBe(m);
  });

  it("an occurrence 'clear' opts out of the gridDefault too", () => {
    expect(
      resolveEditorBinding({
        occurrence: { meta: { bodyLink: "clear" } },
        module: {},
        slot: "body",
        gridDefault: { selfField: "notes" },
      })
    ).toBeNull();
  });

  // THE SCOPING TEST. ModuleTextblock resolves its body through this same
  // function and passes no gridDefault — if the default were read from the grid
  // in here, all 1161 textblock bodies would be replaced by an empty field.
  it("ignores a grid default the caller did not pass", () => {
    expect(resolveEditorBinding({ occurrence: {}, module: {}, slot: "body" })).toBeNull();
  });

  it("ignores a malformed gridDefault", () => {
    expect(
      resolveEditorBinding({ occurrence: {}, module: {}, slot: "body", gridDefault: { link: "d" } })
    ).toBeNull();
  });
});

describe("resolveInstanceBodyBinding", () => {
  const gridDefault = { selfField: "notes" };

  it("applies the grid default to an instance", () => {
    expect(
      resolveInstanceBodyBinding({ occurrence: {}, module: { role: "instance" }, gridDefault })
    ).toEqual({ selfField: "notes" });
  });

  // The row shell is SHARED — ModuleTextblock's card context and every
  // ArtifactCard call site compose it. A textblock is already its own body.
  it("does NOT apply to a textblock or an artifact", () => {
    for (const role of ["textblock", "artifact", "container", "page", "panel"]) {
      expect(resolveInstanceBodyBinding({ occurrence: {}, module: { role }, gridDefault })).toBeNull();
    }
  });

  it("a module binding still wins over the grid default", () => {
    const m = { selfField: "own", link: "d" };
    expect(
      resolveInstanceBodyBinding({
        occurrence: {},
        module: { role: "instance", meta: { bodyLink: m } },
        gridDefault,
      })
    ).toBe(m);
  });

  it("returns null with no grid default set", () => {
    expect(
      resolveInstanceBodyBinding({ occurrence: {}, module: { role: "instance" }, gridDefault: null })
    ).toBeNull();
  });

  it("is null-safe on a missing module or grid", () => {
    expect(resolveInstanceBodyBinding({ occurrence: {}, module: null, gridDefault })).toBeNull();
    expect(
      resolveInstanceBodyBinding({ occurrence: {}, module: { role: "instance" }, gridDefault: undefined })
    ).toBeNull();
  });
});

describe("isSyncingBinding", () => {
  it("is true only when a non-empty link is declared", () => {
    expect(isSyncingBinding({ selfField: "a", link: "b" })).toBe(true);
    expect(isSyncingBinding({ selfField: "a" })).toBe(false);
    expect(isSyncingBinding({ selfField: "a", link: "" })).toBe(false);
    expect(isSyncingBinding({ selfField: "a", link: null })).toBe(false);
    expect(isSyncingBinding(null)).toBe(false);
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

  // THE DANGEROUS DIRECTION, and it needs the ONE shape where the guard is not
  // redundant. With `link` undefined the ordinary path already bails on
  // `linkVal == null` — so a plain fixture passes with or without the guard and
  // proves nothing. But `fields[undefined]` is stored under the STRING key
  // "undefined", and reading `fields[link]` with link undefined FINDS it. So an
  // occurrence carrying that key (what a buggy write that stamped
  // `fields[binding.link]` would produce) makes every other occurrence carrying
  // it a "sibling" — and the instance notes body is bound grid-wide, so one
  // row's note would be pasted onto all of them.
  const undefKeyMap = {
    host: { id: "host", fields: { undefined: { value: "shared" }, qF: { value: "mine" } } },
    sib1: { id: "sib1", fields: { undefined: { value: "shared" }, qF: { value: "theirs" } } },
  };

  it("returns [] for a link-less binding even when the host carries an 'undefined' field key", () => {
    expect(
      findLinkedSiblings({
        binding: { selfField: "qF" },
        hostOccurrence: undefKeyMap.host,
        occurrencesById: undefKeyMap,
        nextValue: "mine",
      })
    ).toEqual([]);
  });

  it("CONTROL: that same fixture DOES match when the link is declared explicitly", () => {
    const out = findLinkedSiblings({
      binding: { selfField: "qF", link: "undefined" },
      hostOccurrence: undefKeyMap.host,
      occurrencesById: undefKeyMap,
      nextValue: "mine",
    });
    expect(out.map((o) => o.id)).toEqual(["sib1"]);
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

  // Same "undefined" field key as the findLinkedSiblings case above — the one
  // shape where the guard is load-bearing rather than redundant. This is the
  // write that would paste one row's note onto every other row.
  it("writes to NOBODY for a link-less binding", () => {
    const occurrencesById = {
      host: { id: "host", fields: { undefined: { value: "shared" }, qF: { value: "mine" } } },
      sib1: { id: "sib1", fields: { undefined: { value: "shared" }, qF: { value: "theirs" } } },
    };
    propagateBoundFieldWrite({
      hostOccurrence: occurrencesById.host,
      binding: { selfField: "qF" },
      nextValue: "mine",
      occurrencesById,
      dispatch: vi.fn(),
      socket: { emit: vi.fn() },
    });
    expect(CommitHelpers.updateOccurrence).not.toHaveBeenCalled();
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
