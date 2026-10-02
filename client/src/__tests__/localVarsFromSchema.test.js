// @vitest-environment jsdom
// A step's OUTPUT variable must be pickable by every later step.
//
// `collectLocalVars` read only `config.name` / `itemIdVar` / `itemVar`. A
// schema-declared action names its output with its own key — `to` (25 actions),
// `resultVar` (4), `as`, `responseVar`, `errorVar`, `varName` — so none of those
// outputs appeared in any later picker. Found 2026-09-27 building
// `Schedule: Place Dated Work`: a SLOTS_COVERED step's result could not be chosen
// as the next loop's collection, which is the only thing that step is for.
//
// A BLANK optional field contributes its DOCUMENTED DEFAULT, because that is the
// var the executor actually writes. Treating blank as "produces nothing" is the
// opposite of what optional means here.
import { describe, it, expect } from "vitest";
import { collectLocalVars } from "../blocks/OperationsBuilder";
import { ACTION_CONFIG_SCHEMA } from "../blocks/actionConfigSchema";

const act = (config) => ({ type: "action", config });

describe("collectLocalVars", () => {
  it("picks up a schema action's explicit output var", () => {
    const vars = collectLocalVars([act({ type: "SLOTS_COVERED", start: "$a", to: "$covered" })]);
    expect([...vars]).toContain("$covered");
  });

  it("picks up the DEFAULT when the output field is left blank", () => {
    // `to` blank → the executor writes `$slotsCovered`.
    const vars = collectLocalVars([act({ type: "SLOTS_COVERED", start: "$a" })]);
    expect([...vars]).toContain("$slotsCovered");
  });

  it("covers every output key the schemas use, not a hand-listed few", () => {
    const keys = new Set();
    for (const s of Object.values(ACTION_CONFIG_SCHEMA)) {
      for (const f of s.fields || []) if (f.kind === "var") keys.add(f.key);
    }
    // These are the six the three old reads missed.
    for (const k of ["to", "as", "resultVar", "responseVar", "errorVar", "varName"]) {
      expect(keys, `${k} is no longer a schema var key`).toContain(k);
    }
    // Each one, on a real action that declares it, is collected.
    const byKey = {};
    for (const [a, s] of Object.entries(ACTION_CONFIG_SCHEMA)) {
      for (const f of s.fields || []) if (f.kind === "var" && !byKey[f.key]) byKey[f.key] = { a, f };
    }
    for (const [k, { a, f }] of Object.entries(byKey)) {
      const vars = collectLocalVars([act({ type: a, [k]: "$mine" })]);
      expect([...vars], `${a}.${k}`).toContain("$mine");
      if (f.defaultsTo) {
        expect([...collectLocalVars([act({ type: a })])], `${a}.${k} default`).toContain(f.defaultsTo);
      }
    }
  });

  it("still reads the hand-written editors' keys", () => {
    // Those actions have no schema entry, so the three original reads carry them.
    expect([...collectLocalVars([act({ type: "INIT_VAR", name: "$acc" })])]).toContain("$acc");
    expect([...collectLocalVars([act({ type: "FIND", itemIdVar: "$slotId", itemVar: "$slot" })])])
      .toEqual(expect.arrayContaining(["$slotId", "$slot"]));
  });

  it("still surfaces a loop's iteration variable inside its body", () => {
    expect([...collectLocalVars([{ type: "loop", as: "$appt", body: [] }])]).toContain("$appt");
  });

  it("ignores a name that is not a $var", () => {
    expect([...collectLocalVars([act({ type: "SLOTS_COVERED", to: "covered" })])]).not.toContain("covered");
  });
});
