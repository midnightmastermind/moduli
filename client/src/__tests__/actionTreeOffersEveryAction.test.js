// The action picker must offer every action the executor implements.
//
// `executeActionItem` (helpers/operationActions.js) is the canonical executor;
// `ui/actionTree.js` is what the editor lets you pick. 16 implemented action
// types were missing from the tree, and 7 of them are used by live pipelines
// (measured across every grid, 2026-09-27):
//
//     REMOVE_CHILD 6 steps · DATE_DIFF 3 · SET_FILTER 2 ·
//     PICK_RANDOM_FROM_POOL 2 · SCROLL_TO 2 · SLOTS_COVERED 2 · IS_DUE_ON 2
//
// `SET_FILTER` is what `Grid: Snap Filter To Today` uses to move the date — an
// operation you could read in the UI and never author there. Same shape as the
// comparator catalog (see comparatorCatalog.test.js), one level up.
//
// The WALKER is the point: it reads the executor's own switch and fails when a
// new action lands without a picker entry.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ACTION_TREE } from "../ui/actionTree";

const SRC = fs.readFileSync(
  path.join(__dirname, "..", "helpers", "operationActions.js"), "utf8"
);

/** Every action type `executeActionItem` cases on, read out of its own body. */
function executorActions() {
  const start = SRC.indexOf("export function executeActionItem(");
  expect(start).toBeGreaterThan(-1);
  const body = SRC.slice(start);
  const out = new Set();
  for (const m of body.matchAll(/^\s*case "([A-Z_]+)":/gm)) out.add(m[1]);
  return out;
}

/** Every LEAF value the picker commits (a node with children is a category). */
function offered(nodes = ACTION_TREE, acc = new Set()) {
  for (const n of nodes) {
    if (n.children?.length) offered(n.children, acc);
    else acc.add(n.value);
  }
  return acc;
}

describe("the action picker", () => {
  it("offers EVERY action the executor implements", () => {
    const missing = [...executorActions()].filter((a) => !offered().has(a));
    expect(missing).toEqual([]);
  });

  it("offers nothing the executor cannot run", () => {
    const cases = executorActions();
    expect([...offered()].filter((v) => !cases.has(v))).toEqual([]);
  });

  it("found a real switch — the walker is not vacuous", () => {
    // A scan whose bounds slipped would make both directions pass while
    // verifying nothing.
    const cases = executorActions();
    expect(cases.size).toBeGreaterThan(60);
    expect(cases.has("CREATE")).toBe(true);
    expect(cases.has("SET_FILTER")).toBe(true);
  });

  it("offers the seven that live pipelines already use", () => {
    // A regression here is the original defect returning.
    const o = offered();
    for (const a of ["REMOVE_CHILD", "DATE_DIFF", "SET_FILTER",
                     "PICK_RANDOM_FROM_POOL", "SCROLL_TO", "SLOTS_COVERED", "IS_DUE_ON"]) {
      expect(o.has(a), `${a} is not offered`).toBe(true);
    }
  });

  it("gives every leaf a title and every category children", () => {
    const walk = (nodes) => {
      for (const n of nodes) {
        expect(n.value, "a node with no value").toBeTruthy();
        expect(n.title, `${n.value} has no title`).toBeTruthy();
        if (n.children) { expect(n.children.length).toBeGreaterThan(0); walk(n.children); }
      }
    };
    walk(ACTION_TREE);
  });

  it("lists no action twice", () => {
    const seen = new Set();
    const walk = (nodes) => {
      for (const n of nodes) {
        if (n.children) { walk(n.children); continue; }
        expect(seen.has(n.value), `${n.value} listed twice`).toBe(false);
        seen.add(n.value);
      }
    };
    walk(ACTION_TREE);
  });
});
