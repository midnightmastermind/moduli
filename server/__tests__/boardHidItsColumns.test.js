/**
 * 0278 — a board container that could not render its own columns.
 *
 * `ModuleContainer` draws child CONTAINERS only when the module carries
 * `meta.allowChildContainers`. The six kanban columns ARE containers and the
 * Kanban module never had the flag, so the trello board this feature is named
 * for has been blank since the template was written. Same defect as the
 * 2026-07-31 (2) "you got rid of my trackers" report: the data is correct in
 * every check anyone would run, and only rendering the page shows it.
 */
import { describe, it, expect } from "vitest";
import { planAllowChildContainers } from "../migrations/0278-a-board-that-hid-its-own-columns.mjs";

const mk = (mods, occs) => [occs, Object.fromEntries(mods.map(m => [m.id, m]))];

describe("planAllowChildContainers", () => {
  it("flags a BOARD container holding containers with no flag", () => {
    const [occs, mods] = mk(
      [{ id: "mk", role: "container", kind: "board", label: "Kanban", meta: {} },
       { id: "mc", role: "container", kind: "board", label: "Docket", meta: {} }],
      [{ id: "k", moduleId: "mk", occurrences: ["c1", "c2"] },
       { id: "c1", moduleId: "mc", occurrences: [] },
       { id: "c2", moduleId: "mc", occurrences: [] }],
    );
    const plan = planAllowChildContainers(occs, mods);
    expect(plan.map(p => p.moduleId)).toContain("mk");
    expect(plan.find(p => p.moduleId === "mk").hiddenChildren).toBe(2);
  });

  it("skips one that already carries the flag — idempotent", () => {
    const [occs, mods] = mk(
      [{ id: "mk", role: "container", kind: "board", meta: { allowChildContainers: true } },
       { id: "mc", role: "container", kind: "board", meta: {} }],
      [{ id: "k", moduleId: "mk", occurrences: ["c1"] }, { id: "c1", moduleId: "mc", occurrences: [] }],
    );
    expect(planAllowChildContainers(occs, mods)).toEqual([]);
  });

  // THE SAFETY OF THE WHOLE MIGRATION. A doc container renders its TEXTMAP, not
  // its child list — 89 live containers on poms grid are in this shape and the
  // flag would change how they behave to fix a problem they do not have.
  it("does NOT flag a DOC container holding containers", () => {
    const [occs, mods] = mk(
      [{ id: "md", role: "container", kind: "doc", label: "Journal", meta: {} },
       { id: "mc", role: "container", kind: "board", meta: {} }],
      [{ id: "d", moduleId: "md", occurrences: ["c1"] }, { id: "c1", moduleId: "mc", occurrences: [] }],
    );
    expect(planAllowChildContainers(occs, mods)).toEqual([]);
  });

  it("does NOT flag a board whose children are INSTANCES, not containers", () => {
    const [occs, mods] = mk(
      [{ id: "mb", role: "container", kind: "board", meta: {} },
       { id: "mi", role: "instance", meta: {} }],
      [{ id: "b", moduleId: "mb", occurrences: ["i1", "i2"] },
       { id: "i1", moduleId: "mi" }, { id: "i2", moduleId: "mi" }],
    );
    expect(planAllowChildContainers(occs, mods)).toEqual([]);
  });

  it("does NOT flag an empty board", () => {
    const [occs, mods] = mk([{ id: "mb", role: "container", kind: "board", meta: {} }],
                            [{ id: "b", moduleId: "mb", occurrences: [] }]);
    expect(planAllowChildContainers(occs, mods)).toEqual([]);
  });

  it("does NOT flag a PAGE — only containers draw children this way", () => {
    const [occs, mods] = mk(
      [{ id: "mp", role: "page", kind: "board", meta: {} }, { id: "mc", role: "container", kind: "board", meta: {} }],
      [{ id: "p", moduleId: "mp", occurrences: ["c1"] }, { id: "c1", moduleId: "mc", occurrences: [] }],
    );
    expect(planAllowChildContainers(occs, mods)).toEqual([]);
  });

  // `list` and `board` are the same container — the standing rule from
  // `feedback_list_is_board`. A grid still carrying the old kind must not be missed.
  it("treats kind:'list' as a board", () => {
    const [occs, mods] = mk(
      [{ id: "ml", role: "container", kind: "list", meta: {} }, { id: "mc", role: "container", kind: "board", meta: {} }],
      [{ id: "l", moduleId: "ml", occurrences: ["c1"] }, { id: "c1", moduleId: "mc", occurrences: [] }],
    );
    expect(planAllowChildContainers(occs, mods).map(p => p.moduleId)).toEqual(["ml"]);
  });

  it("reports one entry per MODULE, summing its placements", () => {
    const [occs, mods] = mk(
      [{ id: "mk", role: "container", kind: "board", label: "Kanban", meta: {} },
       { id: "mc", role: "container", kind: "board", meta: {} }],
      [{ id: "k1", moduleId: "mk", occurrences: ["a"] },
       { id: "k2", moduleId: "mk", occurrences: ["b", "c"] },
       { id: "a", moduleId: "mc" }, { id: "b", moduleId: "mc" }, { id: "c", moduleId: "mc" }],
    );
    const plan = planAllowChildContainers(occs, mods);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ placements: 2, hiddenChildren: 3 });
  });
});
