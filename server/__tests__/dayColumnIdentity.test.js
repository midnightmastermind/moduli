// `0284` gives the day column a DATED identity so a duplicate can be refused.
//
// The risk in this migration is the SELECTOR: `Day Page: Build` holds TWO
// APPLY_TEMPLATE steps (the create branch and the merge branch) nested inside
// two IFs and a loop, and patching the wrong one would either do nothing or
// stamp every top-up. So the selector is tested against the real shape.
import { describe, it, expect } from "vitest";
import { findColumnCreateStep, signatureForDate } from "../migrations/0284-day-column-identity.mjs";

const step = (config, extra = {}) => ({ id: "s", type: "action", config, ...extra });

/** The op's real shape: create + merge, both nested. */
const pipeline = () => ({
  steps: [
    step({ type: "INIT_VAR", name: "$board" }),
    {
      id: "if1", type: "if", config: {
        steps: [{
          id: "loop", type: "loop", config: {
            body: [
              step({ type: "FIND", itemVar: "$col", itemIdVar: "$colId" }),
              {
                id: "if2", type: "if", config: {
                  then: [
                    step({ type: "APPLY_TEMPLATE", templateRef: "$tplId", rootParent: "board-id", rootIdVar: "$colId", defaultFields: { dateFid: "$day" } }),
                    step({ type: "ADD_CHILD" }),
                  ],
                  else: [
                    // the MERGE branch — no rootParent, no rootIdVar
                    step({ type: "APPLY_TEMPLATE", templateRef: "$tplId", targetOccurrenceVar: "$colId", mode: "merge" }),
                  ],
                },
              },
            ],
          },
        }],
      },
    },
  ],
});

describe("findColumnCreateStep", () => {
  it("finds the create branch nested inside if > loop > if.then", () => {
    const hits = findColumnCreateStep(pipeline().steps);
    expect(hits).toHaveLength(1);
    expect(hits[0].rootParent).toBe("board-id");
    expect(hits[0].rootIdVar).toBe("$colId");
  });

  // THE ONE THAT MATTERS: the merge branch must never be picked. Stamping a
  // rootSignature there would be inert at best (merge ignores rootParent) and
  // misleading at worst.
  it("does NOT pick the merge-branch APPLY_TEMPLATE", () => {
    const hits = findColumnCreateStep(pipeline().steps);
    expect(hits.every((c) => c.mode !== "merge")).toBe(true);
  });

  it("finds nothing in a pipeline with no column create", () => {
    expect(findColumnCreateStep([step({ type: "UPDATE" })])).toHaveLength(0);
    expect(findColumnCreateStep(undefined)).toHaveLength(0);
  });

  // The migration throws unless it finds EXACTLY one — a second create-shaped
  // step means the shape is ambiguous and picking one would be a guess.
  it("reports BOTH when two create-shaped steps exist, so the caller can fail closed", () => {
    const p = pipeline();
    p.steps.push(step({ type: "APPLY_TEMPLATE", rootParent: "other", rootIdVar: "$x" }));
    expect(findColumnCreateStep(p.steps)).toHaveLength(2);
  });
});

describe("signatureForDate", () => {
  it("is dated, so one column per day is legal and two are not", () => {
    expect(signatureForDate("2026-09-03")).toBe("daypage:col:2026-09-03");
    expect(signatureForDate("2026-09-03")).not.toBe(signatureForDate("2026-09-04"));
  });
});
