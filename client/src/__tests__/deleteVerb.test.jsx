/**
 * deleteVerb.test.jsx
 *
 * ONE ACTION HAD FOUR NAMES, and three of them said the opposite of what it
 * does. `CommitHelpers.removeOccurrence` emits `delete_occurrence` and the
 * server cascades everything parented to the row — yet it was offered as
 * "Remove" (radial), "Remove from container" (row menu and the settings
 * sheet), and only the bulk item, which calls the SAME function, said
 * "Delete N selected". User, 2026-08-26: *"i cant find the delete in the
 * radial menu"* — it was there, under another word.
 *
 * The distinction that has to survive: on a doc PILL or an embed, delete really
 * does only take the node out of the prose, and "Remove" is right there.
 */
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { resolve } from "path";
import RadialMenu from "../ui/RadialMenu.jsx";

const open = (ui) => {
  const { container } = render(ui);
  // The arc is portaled and only mounts once the handle is opened.
  const trigger = container.querySelector("button");
  fireEvent.click(trigger);
  return container;
};

describe("RadialMenu — the caller names its own delete", () => {
  it("says Remove when the caller does not name it (every existing call site)", () => {
    open(<RadialMenu onDelete={() => {}} forceDirection="down" />);
    expect(screen.getByTitle("Remove")).toBeTruthy();
    expect(screen.queryByTitle("Delete")).toBeNull();
  });

  it("says Delete when the caller asks for it", () => {
    open(<RadialMenu onDelete={() => {}} deleteLabel="Delete" forceDirection="down" />);
    expect(screen.getByTitle("Delete")).toBeTruthy();
    expect(screen.queryByTitle("Remove")).toBeNull();
  });

  it("still calls the handler it was given", () => {
    let hits = 0;
    open(<RadialMenu onDelete={() => { hits += 1; }} deleteLabel="Delete" forceDirection="down" />);
    fireEvent.click(screen.getByTitle("Delete"));
    expect(hits).toBe(1);
  });
});

// The row surfaces cannot be mounted — ModuleInstance needs the whole grid
// store, which is why its own header says no test mounts it. The contract is
// therefore asserted where it lives: a surface that calls `removeOccurrence`
// must not describe itself as merely removing a placement.
describe("the row surfaces call it what it is", () => {
  const read = (rel) => readFileSync(resolve(__dirname, rel), "utf8");

  it("the row's radial names the verb per context, not once for both", () => {
    const src = read("../modules/ModuleInstance.jsx");
    expect(src).toMatch(/deleteLabel=\{embedOnDelete \? "Remove" : "Delete"\}/);
  });

  it("no surface that deletes an occurrence says 'Remove from container'", () => {
    for (const f of ["../modules/ModuleInstance.jsx", "../ui/InstanceForm.jsx"]) {
      const src = read(f);
      const code = src.split("\n").filter(l => !l.trim().startsWith("//")).join("\n");
      expect(code).not.toContain("Remove from container");
    }
  });

  it("the settings sheet warns that children go too, and still promises the module survives", () => {
    const src = read("../ui/InstanceForm.jsx");
    expect(src).toMatch(/Delete this item\?/);
    expect(src).toMatch(/Anything inside it is deleted too/);
    expect(src).toMatch(/module stays in the Command Center/);
  });
});
