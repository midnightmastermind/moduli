// A button can sit on any occurrence: panels show their own fields under the header, and a textblock inside a doc
// shows its button fields as a strip under its text.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buttonBindings } from "../helpers/buttonBindings.js";

const read = (p) => fs.readFileSync(path.join(__dirname, p), "utf8");

describe("buttonBindings", () => {
  const fieldsById = {
    b1: { id: "b1", type: "button" }, b2: { id: "b2", type: "button" }, t: { id: "t", type: "text" },
    gone: { id: "gone", type: "button", trashed: true },
  };
  it("only button bindings, visible ones, in binding order", () => {
    const module = { fieldBindings: [
      { fieldId: "t", order: 0 }, { fieldId: "b2", order: 2 }, { fieldId: "b1", order: 1 },
      { fieldId: "b1x", order: 3 }, { fieldId: "gone", order: 4 }, { fieldId: "b2", order: 5, hidden: true },
    ] };
    expect(buttonBindings(module, fieldsById).map((b) => b.fieldId)).toEqual(["b1", "b2"]);
  });
  it("nothing for a module with no bindings", () => {
    expect(buttonBindings(null, fieldsById)).toEqual([]);
    expect(buttonBindings({}, fieldsById)).toEqual([]);
  });
});

describe("wired", () => {
  it("a panel renders its own fields under the header", () => {
    expect(read("../modules/ModulePanel.jsx")).toMatch(/<OccurrenceFields[\s\S]{0,200}occurrence=\{panelOccurrence\}/);
  });
  it("a doc textblock renders a button strip, and still renders its text", () => {
    const src = read("../docs/pills/InstanceTextblockNode.jsx");
    expect(src).toMatch(/buttonBindings\(/);
    expect(src).toMatch(/<ModuleTextblock/);
  });
});
