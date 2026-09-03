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

  // ── A CUSTOM `items` LIST MUST NOT SWALLOW THE DELETE ────────────────────
  //
  // The custom branch used to return `items` verbatim, so a caller passing BOTH
  // was silently given no delete. It bit exactly one surface — an instance
  // builds a custom list ONLY when it is copy-linked, and a copy-linked row is
  // most of a Schedule, so those rows had no delete in the radial menu at all
  // (user, 2026-09-03: "can you put the delete icon back in to the radial menu
  // for instances").
  const custom = [{ icon: () => null, label: "Break Link", onClick: () => {} }];

  it("renders the delete alongside a CUSTOM items list", () => {
    open(<RadialMenu items={custom} onDelete={() => {}} deleteLabel="Delete" forceDirection="down" />);
    expect(screen.getByTitle("Delete")).toBeTruthy();
    expect(screen.getByTitle("Break Link")).toBeTruthy();   // the custom item survives
  });

  it("fires the handler from the CUSTOM branch too", () => {
    let hits = 0;
    open(<RadialMenu items={custom} onDelete={() => { hits += 1; }} deleteLabel="Delete" forceDirection="down" />);
    fireEvent.click(screen.getByTitle("Delete"));
    expect(hits).toBe(1);
  });

  // The four pill nodes pass `items` and NO onDelete — they must be untouched.
  it("adds nothing when a custom list carries no onDelete", () => {
    open(<RadialMenu items={custom} forceDirection="down" />);
    expect(screen.queryByTitle("Delete")).toBeNull();
    expect(screen.queryByTitle("Remove")).toBeNull();
  });

  it("keeps extraItems AFTER the delete, matching the default branch's order", () => {
    const extra = [{ icon: () => null, label: "Convert", onClick: () => {} }];
    const c = open(<RadialMenu items={custom} extraItems={extra} onDelete={() => {}} deleteLabel="Delete" forceDirection="down" />);
    const titles = [...document.querySelectorAll("[title]")].map((e) => e.getAttribute("title"));
    expect(titles.indexOf("Delete")).toBeLessThan(titles.indexOf("Convert"));
    expect(titles.indexOf("Break Link")).toBeLessThan(titles.indexOf("Delete"));
    expect(c).toBeTruthy();
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
