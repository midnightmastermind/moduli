// A share rule's conditions read `$share` — `Share: link` gates on
// $share.clip / $share.props.url, `Share: add profile` on $share.person.network —
// and the path picker had no entry for it, so none could be built by clicking
// (2026-10-05). The tree is built from the Imports tab's own catalog.
import { describe, it, expect } from "vitest";
import { itemsForLevel } from "../ui/DrilldownPicker.jsx";
import { CATEGORIES } from "../ui/categoryRegistry";
import { allSharePaths } from "../helpers/shareRulesUi.js";

const level = (chain, localVars = ["$share"]) => itemsForLevel(chain, { fields: [], localVars }, CATEGORIES).items.map((i) => i.value);

describe("the path picker drills $share", () => {
  it("lists $share where the editor passes it", () => {
    expect(level(["localVars"])).toContain("$share");
  });
  it("CONTROL: an ordinary operation has no $share", () => {
    expect(level(["localVars"], [])).not.toContain("$share");
  });
  it("drills to the props each rule reads", () => {
    expect(level(["localVars", "$share"])).toEqual(expect.arrayContaining(["props", "person", "clip", "label", "externalId"]));
    expect(level(["localVars", "$share", "props"])).toEqual(expect.arrayContaining(["url", "occurrenceId", "text"]));
    expect(level(["localVars", "$share", "person"])).toContain("network");
    expect(level(["localVars", "$share", "clip", "meta"])).toContain("clipShape");
  });
  it("every catalog path is reachable", () => {
    for (const p of allSharePaths()) {
      const segs = p.split(".").slice(1);
      expect(level(["localVars", "$share", ...segs.slice(0, -1)]), p).toContain(segs.at(-1));
    }
  });
});

import fs from "node:fs";
import path from "node:path";
describe("the Imports tab hands its rules $share", () => {
  it("passes $share to the PipelineEditor as a variable", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../ui/commandCenter/ImportsTab.jsx"), "utf8");
    expect(src).toMatch(/SHARE_VARS = \["\$share"\]/);
    expect(src).toMatch(/extraLocalVars=\{SHARE_VARS\}/);
  });
});
