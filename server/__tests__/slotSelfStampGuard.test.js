import { describe, it, expect } from "vitest";
import {
  guardAgainstSelfStamp,
  markerFromSignature,
  markerFor,
} from "../migrations/0183-a-slot-stamps-itself-null.mjs";

const SF = "vQ0ELZP_zxnx";

/** The op's real shape: two FINDs binding $item and $destContainer, then the IF/ELSE, then the date. */
const pipeline = () => ({
  steps: [
    { id: "a", type: "action", config: { type: "FIND", itemVar: "$item" } },
    { id: "b", type: "action", config: { type: "FIND", itemVar: "$destContainer" } },
    {
      id: "c", type: "if",
      condition: { operator: "AND", rules: [{ id: "r", left: `$destContainer.fields.${SF}.value`, comparator: "IS", right: "slot" }] },
      then: [{ id: "t", type: "action", config: { type: "UPDATE", path: "$item.fields.nSccAtADyUGW.value", value: "$trigger.containerLabel" } }],
      else: [{ id: "e", type: "action", config: { type: "UPDATE", path: "$item.fields.nSccAtADyUGW.value", value: null } }],
    },
    { id: "d", type: "action", config: { type: "UPDATE", path: "$item.fields.Eh7oi4HKdbHB.value", value: "$trigger.date" } },
  ],
});

describe("0183 — a slot must not stamp itself null", () => {
  it("wraps the body in a guard on $item's OWN Schedule Format", () => {
    const p = pipeline();
    const { changed } = guardAgainstSelfStamp(p);
    expect(changed).toBe(true);
    const guard = p.steps[p.steps.length - 1];
    expect(guard.type).toBe("if");
    expect(guard.condition.rules[0]).toMatchObject({
      left: `$item.fields.${SF}.value`, comparator: "IS_NOT", right: "slot",
    });
  });

  it("leaves the two FINDs OUTSIDE the guard — the guard reads $item, so $item must be bound first", () => {
    const p = pipeline();
    guardAgainstSelfStamp(p);
    expect(p.steps).toHaveLength(3);            // FIND, FIND, guard
    expect(p.steps[0].config.itemVar).toBe("$item");
    expect(p.steps[1].config.itemVar).toBe("$destContainer");
  });

  it("moves the ENTIRE original body inside, date write included", () => {
    const p = pipeline();
    guardAgainstSelfStamp(p);
    const body = p.steps[2].then;
    expect(body).toHaveLength(2);
    expect(body[0].type).toBe("if");
    // the date write is the step 0145 and 0182 each repaired the output of
    expect(body[1].config.path).toBe("$item.fields.Eh7oi4HKdbHB.value");
  });

  it("is idempotent — a second run adds no second guard", () => {
    const p = pipeline();
    guardAgainstSelfStamp(p);
    const after = JSON.parse(JSON.stringify(p));
    const { changed, reason } = guardAgainstSelfStamp(p);
    expect(changed).toBe(false);
    expect(reason).toBe("already guarded");
    expect(p).toEqual(after);
  });

  it("refuses a pipeline where nothing binds $item before the first IF", () => {
    const p = { steps: [{ id: "c", type: "if", condition: {}, then: [], else: [] }] };
    expect(guardAgainstSelfStamp(p).changed).toBe(false);
  });
});

describe("0183 — resolving a slot's marker", () => {
  it("reads the master's own signature", () => {
    expect(markerFromSignature("slot:4:30am")).toBe("4:30am");
    expect(markerFromSignature("slot:Todo")).toBe("Todo");
  });

  it("returns null rather than guessing on an unparseable signature", () => {
    expect(markerFromSignature(null)).toBeNull();
    expect(markerFromSignature("cycle:Greek Yogurt Bowl")).toBeNull();
    expect(markerFromSignature("slot:")).toBeNull();
  });

  it("follows copyLinkSource for a per-day COPY, which carries no signature of its own", () => {
    const master = { id: "M", identitySignature: "slot:12:00am" };
    const copy = { id: "C", identitySignature: null, meta: { copyLinkSource: "M" } };
    const byId = new Map([["M", master], ["C", copy]]);
    expect(markerFor(copy, byId)).toEqual({ marker: "12:00am", via: "copyLinkSource M" });
  });

  it("prefers the occurrence's OWN signature over its source's", () => {
    // The master is the discriminating case: it has a signature AND no copyLinkSource.
    const byId = new Map([["M", { id: "M", identitySignature: "slot:9:00pm" }]]);
    expect(markerFor(byId.get("M"), byId)).toEqual({ marker: "9:00pm", via: "signature" });
  });

  it("refuses when there is neither a signature nor a resolvable source", () => {
    const byId = new Map();
    expect(markerFor({ id: "X", meta: { copyLinkSource: "gone" } }, byId).marker).toBeNull();
  });
});
