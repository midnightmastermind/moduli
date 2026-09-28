// A `json:` literal (what the editor's STRUCTURED mode writes) resolves its
// `$var` leaves — and only those.
//
// Measured 2026-09-28: 39 of 40 object-valued steps across every grid carry
// `$var` leaves (the history trackers' PUSH_TO_ARRAY rows, Build Schedule's
// `{mode: "$pageMode", columns: "$pageColumns", …}` layout write), all
// seed-written as real objects. The editor stores an object as a `json:` string,
// which resolved WITHOUT substitution — so none could be authored in the UI.
// Of 89 live `json:` payloads, zero contain a `$`-string, so resolving `$`
// leaves changes nothing that exists. Other leaves stay literal on purpose: a
// hand-written list of items must not have "7" turned into 7.
import { describe, it, expect } from "vitest";
import { resolveExpr } from "../helpers/operationActions";

describe("json: literals resolve $var leaves", () => {
  const vars = { $pageMode: "grid", $cols: 7 };
  it("substitutes a $var leaf, keeping the structure", () => {
    expect(resolveExpr('json:{"mode":"$pageMode","columns":"$cols","hideChildIds":[]}', vars))
      .toEqual({ mode: "grid", columns: 7, hideChildIds: [] });
  });
  it("leaves every other string literal (no number coercion, no literal: stripping)", () => {
    expect(resolveExpr('json:["7","literal:x","stack"]', vars)).toEqual(["7", "literal:x", "stack"]);
  });
  it("an unresolvable $ leaf stays as written", () => {
    expect(resolveExpr('json:{"a":"$nope"}', vars)).toEqual({ a: "$nope" });
  });
  it("CONTROL: a plain json: literal still parses", () => {
    expect(resolveExpr('json:{"a":1,"b":[true]}', vars)).toEqual({ a: 1, b: [true] });
  });
});
