// __tests__/applyUpdate.test.js
// Tests for the unified UPDATE-verb routing helper.
// See plan: docs/superpowers/plans/2026-04-27-unified-operation-verbs.md (Task 1).
import { describe, it, expect } from "vitest";
import { applyUpdate } from "../helpers/applyUpdate";

const makeCtx = (overrides = {}) => ({
  vars: {},
  occurrencesById: {},
  ...overrides,
});

// ---------------------------------------------------------------------------
// $item.fields.<id>.value
// ---------------------------------------------------------------------------
describe("applyUpdate — $item.fields.<id>.value", () => {
  it("returns UPDATE_ITEM_FIELD with subKind=value", () => {
    const ctx = makeCtx({ vars: { $item: { id: "occ1" } } });
    const result = applyUpdate("$item.fields.f_amount.value", 42, ctx);
    expect(result.varWrites).toEqual({});
    expect(result.effects).toEqual([
      {
        _effect: "UPDATE_ITEM_FIELD",
        itemId: "occ1",
        fieldId: "f_amount",
        value: 42,
        subKind: "value",
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// $item.fields.<id>.flow
// ---------------------------------------------------------------------------
describe("applyUpdate — $item.fields.<id>.flow", () => {
  it("returns UPDATE_ITEM_FIELD with subKind=flow", () => {
    const ctx = makeCtx({ vars: { $item: { id: "occ1" } } });
    const result = applyUpdate("$item.fields.f_amount.flow", "out", ctx);
    expect(result.effects).toEqual([
      {
        _effect: "UPDATE_ITEM_FIELD",
        itemId: "occ1",
        fieldId: "f_amount",
        value: "out",
        subKind: "flow",
      },
    ]);
    expect(result.varWrites).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// $item.parentId
// ---------------------------------------------------------------------------
describe("applyUpdate — $item.parentId", () => {
  it("returns UPDATE_ITEM_PARENT", () => {
    const ctx = makeCtx({ vars: { $item: { id: "occ1" } } });
    const result = applyUpdate("$item.parentId", "newParent", ctx);
    expect(result.effects).toEqual([
      {
        _effect: "UPDATE_ITEM_PARENT",
        itemId: "occ1",
        toParentId: "newParent",
      },
    ]);
    expect(result.varWrites).toEqual({});
  });

  it("throws when $item is not bound in vars", () => {
    const ctx = makeCtx({ vars: {} });
    expect(() => applyUpdate("$item.parentId", "newParent", ctx)).toThrow(
      "$item not bound in current pipeline context"
    );
  });
});

// ---------------------------------------------------------------------------
// $item.meta.<key>
// ---------------------------------------------------------------------------
describe("applyUpdate — $item.meta.<key>", () => {
  it("returns UPDATE_ITEM_META with metaPath for a single-segment meta key", () => {
    const ctx = makeCtx({ vars: { $item: { id: "occ1" } } });
    const result = applyUpdate("$item.meta.completedAt", "2026-04-27", ctx);
    expect(result.effects).toEqual([
      {
        _effect: "UPDATE_ITEM_META",
        itemId: "occ1",
        metaPath: ["completedAt"],
        value: "2026-04-27",
      },
    ]);
    expect(result.varWrites).toEqual({});
  });

  it("returns UPDATE_ITEM_META with full nested metaPath for deep meta writes", () => {
    const ctx = makeCtx({ vars: { $item: { id: "occ1" } } });
    const cellDoc = { type: "doc", content: [{ type: "paragraph" }] };
    const result = applyUpdate("$item.meta.table.cells.0:0", cellDoc, ctx);
    expect(result.effects).toEqual([
      {
        _effect: "UPDATE_ITEM_META",
        itemId: "occ1",
        metaPath: ["table", "cells", "0:0"],
        value: cellDoc,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// $item.textmap (direct value)
// ---------------------------------------------------------------------------
describe("applyUpdate — $item.textmap (direct)", () => {
  it("returns UPDATE_ITEM_TEXTMAP carrying the value verbatim", () => {
    const ctx = makeCtx({ vars: { $item: { id: "occ1" } } });
    const tm = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
    };
    const result = applyUpdate("$item.textmap", tm, ctx);
    expect(result.effects).toEqual([
      {
        _effect: "UPDATE_ITEM_TEXTMAP",
        itemId: "occ1",
        textmap: tm,
      },
    ]);
    expect(result.varWrites).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// $item.textmap (template + tokens)
// ---------------------------------------------------------------------------
describe("applyUpdate — $item.textmap with fromTemplate + tokens", () => {
  it("clones template's textmap from occurrencesById and substitutes [tokens]", () => {
    const templateTextmap = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Day: [Date] — [Day]" },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "no tokens here" },
          ],
        },
      ],
    };
    const ctx = makeCtx({
      vars: { $item: { id: "occ_target" } },
      occurrencesById: {
        tmpl1: { id: "tmpl1", textmap: templateTextmap },
      },
    });

    const result = applyUpdate(
      "$item.textmap",
      { fromTemplate: "tmpl1", tokens: { "[Date]": "2026-04-27", "[Day]": "Monday" } },
      ctx
    );

    expect(result.effects).toHaveLength(1);
    const effect = result.effects[0];
    expect(effect._effect).toBe("UPDATE_ITEM_TEXTMAP");
    expect(effect.itemId).toBe("occ_target");
    // First paragraph text fully substituted
    expect(effect.textmap.content[0].content[0].text).toBe(
      "Day: 2026-04-27 — Monday"
    );
    // Second paragraph untouched
    expect(effect.textmap.content[1].content[0].text).toBe("no tokens here");
    // The clone should not be the same reference as the source
    expect(effect.textmap).not.toBe(templateTextmap);
    expect(templateTextmap.content[0].content[0].text).toBe(
      "Day: [Date] — [Day]"
    );
  });
});

// ---------------------------------------------------------------------------
// Single-segment $myVar — pipeline-internal var write
// ---------------------------------------------------------------------------
describe("applyUpdate — $<varName> single segment", () => {
  it("returns varWrites with no effects", () => {
    const ctx = makeCtx({ vars: { $item: { id: "occ1" } } });
    const result = applyUpdate("$total", 99, ctx);
    expect(result.effects).toEqual([]);
    expect(result.varWrites).toEqual({ $total: 99 });
  });

  it("throws when single-segment is a reserved identifier", () => {
    const ctx = makeCtx();
    expect(() => applyUpdate("$display", 1, ctx)).toThrow(
      "cannot write reserved identifier: $display"
    );
    expect(() => applyUpdate("$item", { id: "x" }, ctx)).toThrow(
      "cannot write reserved identifier: $item"
    );
  });
});

// ---------------------------------------------------------------------------
// $display.<fieldId>.<itemId>
// ---------------------------------------------------------------------------
describe("applyUpdate — $display.<fieldId>.<itemId>", () => {
  it("returns UPDATE_DISPLAY_VALUE", () => {
    const ctx = makeCtx();
    const result = applyUpdate("$display.f_total.occ1", 17, ctx);
    expect(result.effects).toEqual([
      {
        _effect: "UPDATE_DISPLAY_VALUE",
        fieldId: "f_total",
        itemId: "occ1",
        value: 17,
      },
    ]);
    expect(result.varWrites).toEqual({});
  });

  it("throws when itemId segment is missing ($display.<fieldId>)", () => {
    const ctx = makeCtx();
    expect(() => applyUpdate("$display.f_total", 17, ctx)).toThrow(
      "display path requires itemId segment"
    );
  });
});

// ---------------------------------------------------------------------------
// Unknown path heads
// ---------------------------------------------------------------------------
describe("applyUpdate — unknown paths", () => {
  it("throws for paths that don't start with a known head", () => {
    const ctx = makeCtx();
    expect(() => applyUpdate("unknown.path", 1, ctx)).toThrow(
      "unknown path head: unknown.path"
    );
  });

  it("throws for malformed $item subpaths", () => {
    const ctx = makeCtx({ vars: { $item: { id: "occ1" } } });
    expect(() => applyUpdate("$item.notARealKey", 1, ctx)).toThrow(
      "unknown path head: $item.notARealKey"
    );
  });

  it("throws for empty path", () => {
    const ctx = makeCtx();
    expect(() => applyUpdate("", 1, ctx)).toThrow();
  });
});
