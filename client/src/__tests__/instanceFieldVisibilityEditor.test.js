// An INSTANCE's own fieldVisibility had no editor (2026-10-08): containers, pages and
// panels mount FieldVisibilitySection, an instance's Settings offered only Settings /
// Style / Fields. On poms' Workouts tile that setting is written by an operation, so a
// hidden-by-show-list field could never be reached by clicking — a hidden setting.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.join(__dirname, "../ui/InstanceForm.jsx"), "utf8").replace(/\/\/.*$|\/\*[\s\S]*?\*\//gm, "");

describe("instance Settings › Fields edits the occurrence's own field visibility", () => {
  it("imports and mounts FieldVisibilitySection with the occurrence", () => {
    expect(src).toMatch(/import FieldVisibilitySection from "\.\/FieldVisibilitySection"/);
    expect(src).toMatch(/<FieldVisibilitySection\s+occurrence=\{occurrence\}/);
  });
  it("mounts it in the Fields tab, after the bindings editor (control: the tab exists)", () => {
    const tab = src.slice(src.indexOf('TabsContent value="fields"'));
    expect(tab.indexOf("<FieldBindingsEditor")).toBeGreaterThan(-1);
    expect(tab.indexOf("<FieldVisibilitySection")).toBeGreaterThan(tab.indexOf("<FieldBindingsEditor"));
  });
});
