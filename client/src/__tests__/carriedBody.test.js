import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { carriedBody } from "../helpers/carriedBody.js";

const body = { type: "doc", content: [{ type: "instanceTextblock", attrs: { occurrenceId: "tb" } }, { type: "paragraph" }] };

describe("carriedBody — a copy shows its source's notes", () => {
  it("carries a body with content, as its own copy", () => {
    const src = { id: "a", textmap: body };
    const out = carriedBody(src);
    expect(out.textmap).toEqual(body);
    expect(out.textmap).not.toBe(body);
  });
  it("carries nothing for an empty body, a held/unloaded body, or a copy with its own children", () => {
    expect(carriedBody({ textmap: { type: "doc", content: [{ type: "paragraph" }] } })).toEqual({});
    expect(carriedBody({ textmap: "H4sIA…compressed" })).toEqual({});
    expect(carriedBody({ textmap: body }, { copiesChildren: true })).toEqual({});
  });
  it("both copy paths use it", () => {
    const ops = readFileSync(new URL("../helpers/operationActions.js", import.meta.url), "utf8");
    const lay = readFileSync(new URL("../helpers/LayoutHelpers.js", import.meta.url), "utf8");
    expect(ops).toMatch(/\.\.\.carriedBody\(src, \{ copiesChildren: childIds\.length > 0 \}\)/);
    expect(lay).toMatch(/\.\.\.carriedBody\(sourceOccurrence/);
  });
});
