// 0360 — adding Instagram people not yet on the board (synthetic names only).
import { describe, it, expect } from "vitest";
import { planAdd } from "../migrations/0360-add-instagram-people.mjs";

const IG = "fIg";
const people = [
  { id: "a", meta: { externalId: "ig:already" }, fields: {} },
  { id: "b", meta: { externalId: "fb:Sam Lee" }, fields: { [IG]: { value: "samlee" } } },
  { id: "c", meta: { externalId: "fb:Ray Ortiz (garbled)" }, fields: {} },
  { id: "d", meta: { externalId: "fb:Jo Park" }, fields: {} },
  { id: "e", meta: { externalId: "fb:Jo Parker" }, fields: {} },
];

describe("0360 planAdd", () => {
  const plan = planAdd({
    igFieldId: IG, people,
    list: {
      add: [
        { handle: "newfriend", name: "New Friend", followsYou: true },
        { handle: "Already", name: "x" },          // already imported (case-insensitive)
        { handle: "samlee", name: "Sam Lee" },     // an existing person carries this handle
        { handle: "newfriend", name: "dup" },      // listed twice
      ],
      attach: [
        { handle: "ray_o", externalIdPrefix: "fb:Ray Ortiz" },   // exactly one
        { handle: "jp", externalIdPrefix: "fb:Jo Park" },        // two people -> refused
        { handle: "sam2", externalIdPrefix: "fb:Sam Lee" },      // already has a handle -> left
      ],
    },
  });
  it("adds only people not already on the board, once", () => {
    expect(plan.add.map(p => p.handle)).toEqual(["newfriend"]);
  });
  it("attaches a handle only to exactly one person with none", () => {
    expect(plan.attach.map(a => [a.occ.id, a.handle])).toEqual([["c", "ray_o"]]);
    expect(plan.refused).toHaveLength(1);
  });
});
