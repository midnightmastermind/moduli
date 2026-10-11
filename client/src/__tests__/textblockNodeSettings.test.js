// An in-doc textblock's radial "Settings" did nothing: RadialMenu's default
// Settings item calls onSettings, and InstanceTextblockNode passed none — so a
// textblock on a doc page could not be named by any click.
import fs from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const src = fs.readFileSync(path.resolve(__dirname, "../docs/pills/InstanceTextblockNode.jsx"), "utf8");
const radial = src.slice(src.indexOf("<RadialMenu"), src.indexOf("/>", src.indexOf("<RadialMenu")));

describe("in-doc textblock settings", () => {
  it("control: the node still renders its RadialMenu with a delete", () => {
    expect(radial).toMatch(/onDelete=\{handleDeleteBlock\}/);
  });
  it("hands the radial an onSettings that opens the popover", () => {
    expect(radial).toMatch(/onSettings=\{[^}]*setSettingsOpen\(true\)/);
  });
  it("the popover is the row's InstanceForm, and its label writes the module", () => {
    expect(src).toMatch(/<InstanceForm[\s\S]*onCommitLabel=\{commitLabel\}/);
    expect(src).toMatch(/renameLeaf\(\{[^}]*module: instance,[^}]*label: draft\?\.label/);
  });
});
