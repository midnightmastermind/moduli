// A DAY COLUMN THAT ALREADY EXISTS WAS NEVER LISTED BY ITS BOARD.
//
// The second shape of the unlisted-column bug, and the one `adoptableHolders`
// cannot reach. `Day Page: Build` finds its column by parentId — so unlike the
// Schedule build it DOES see an unlisted column — and then merges into it and
// never lists it:
//
//   if ($colId IS_EMPTY)
//     THEN  APPLY_TEMPLATE (create) -> ADD_CHILD(board, $colId)   <- lists it
//     ELSE  APPLY_TEMPLATE (merge)                                 <- never does
//
// So a column that loses its listing once stays invisible for good: every later
// load finds it, tops it up, and leaves it unreachable. One live instance on
// poms — daypage:col:2026-08-26, 5 children, unlisted since the day it was made.
//
// ADD_CHILD is idempotent, so moving the listing below the branch leaves the
// create path behaving identically and is a no-op on every healthy column.
import { describe, it, expect } from "vitest";
import { listColumnFromBothBranches } from "../migrations/0350-day-page-merge-lists-its-column.mjs";

const addChild = (parentId, childId) => ({ id: "ac", type: "action", config: { type: "ADD_CHILD", parentId, childId } });
const applyTemplate = (rootIdVar) => ({ id: "at", type: "action", config: { type: "APPLY_TEMPLATE", templateRef: "$tplId", rootIdVar } });
const merge = () => ({ id: "mg", type: "action", config: { type: "APPLY_TEMPLATE", templateRef: "$tplId", mode: "merge" } });

// The real shape: the branch sits inside a loop over the active dates.
const pipeline = () => ({
  steps: [
    { id: "iv", type: "action", config: { type: "INIT_VAR", name: "$board" } },
    {
      id: "loop", type: "loop", overExpr: "$activePeriodDates", as: "$day",
      body: [
        { id: "find", type: "action", config: { type: "FIND", itemIdVar: "$colId" } },
        {
          id: "if", type: "if", condition: { rules: [] },
          then: [applyTemplate("$colId"), addChild("8gpoqzx32h7", "$colId")],
          else: [merge()],
        },
        { id: "upd", type: "action", config: { type: "UPDATE", path: "$col.meta.appliedFromTemplateId" } },
        // the SHARED wheel, multi-parented into the column — must NOT move
        addChild("$colId", "19ed6e9e-bb12-4ced-9e5b-f3ba030cab19"),
      ],
    },
  ],
});

const loopBody = (p) => p.steps[1].body;

describe("Day Page: Build lists its column from both branches", () => {
  it("moves the listing out of the THEN branch to below the if/else", () => {
    const { pipeline: next, changed, reason } = listColumnFromBothBranches(pipeline());
    expect(changed).toBe(true);
    expect(reason).toMatch(/moved ADD_CHILD/);
    const body = loopBody(next);
    const ifStep = body.find((s) => s.type === "if");
    expect(ifStep.then.some((s) => s.config?.type === "ADD_CHILD"), "still in THEN").toBe(false);
    // it now sits immediately after the branch, so BOTH paths reach it
    const at = body.indexOf(ifStep);
    expect(body[at + 1].config).toMatchObject({ type: "ADD_CHILD", parentId: "8gpoqzx32h7", childId: "$colId" });
  });

  // THE CONTROL that matters: the op's OTHER ADD_CHILD multi-parents the shared
  // Emotions Wheel into the column. A blanket "move every ADD_CHILD" would move
  // that one too, and it belongs exactly where it is — the 2026-09-18 (5) sweep
  // records what happens when the wheel is treated as ordinary.
  it("leaves the shared-wheel ADD_CHILD alone", () => {
    const { pipeline: next } = listColumnFromBothBranches(pipeline());
    const body = loopBody(next);
    const wheel = body.filter((s) => s.config?.childId === "19ed6e9e-bb12-4ced-9e5b-f3ba030cab19");
    expect(wheel).toHaveLength(1);
    expect(wheel[0].config.parentId).toBe("$colId");
    expect(body.indexOf(wheel[0])).toBe(body.length - 1);   // still last
  });

  it("is idempotent — running it twice changes nothing the second time", () => {
    const once = listColumnFromBothBranches(pipeline()).pipeline;
    const twice = listColumnFromBothBranches(once);
    expect(twice.changed).toBe(false);
    expect(twice.reason).toBe("already lists from both branches");
    expect(twice.pipeline).toEqual(once);
  });

  it("does not touch a pipeline that has no create/merge branch", () => {
    const flat = { steps: [{ id: "a", type: "action", config: { type: "INIT_VAR" } }] };
    const out = listColumnFromBothBranches(flat);
    expect(out.changed).toBe(false);
    expect(out.pipeline).toEqual(flat);
  });

  it("never mutates the pipeline it was given", () => {
    const original = pipeline();
    const snapshot = JSON.parse(JSON.stringify(original));
    listColumnFromBothBranches(original);
    expect(original).toEqual(snapshot);
  });
});
