// The other half of `server/utils/wireProjection.js`.
//
// That file omits keys from the wire on the grounds that NOTHING IN THE CLIENT
// READS THEM — a fact about the client, so it can only be a named list, and a
// named list is the class this repo keeps getting burned by. This walks the
// client source and fails when a reader appears.
//
// IT EXISTS BECAUSE THE FIRST VERSION OF THE LIST WAS WRONG. A grep for
// `occurrence.updatedAt` reported ZERO readers and `updatedAt` very nearly
// shipped as dead weight. The real readers address it differently, and one of
// them is the stale-write conflict guard:
//
//     CommitHelpers.js:332   localPrev?.updatedAt  -> expectedUpdatedAt
//     PageFolder.jsx:553     occ?.updatedAt || mod?.updatedAt
//     ModuleContainer:1683   occ?.updatedAt || occ?.createdAt
//
// So `updatedAt` and `createdAt` are the CONTROLS below: a detector that cannot
// see those has not proven anything about the keys that read zero.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  WIRE_OMIT_KEYS, WIRE_HOIST_KEYS, projectRowsForWire, rehydrateWireRows,
} from "../../../server/utils/wireProjection.js";

const SRC = resolve(__dirname, "..");
const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== "__tests__" && e !== "node_modules") walk(p); }
    else if (/\.jsx?$/.test(e)) files.push(p);
  }
})(SRC);

/** Every read of `_id` that is DELIBERATELY kept, with the reason. A read not
 *  on this list fails the guard — which is stronger, and far more honest, than
 *  making the regex below clever enough to infer intent.
 *
 *  Each of these is a FALLBACK behind `id`, and `id` is non-empty on 100% of
 *  the rows that travel (17,160/17,160 occurrences, 4,906/4,906 modules,
 *  8,430/8,430 core — measured 2026-09-28), so none of them can fire for a wire
 *  row. They stay in place for a legacy row arriving by some other path. */
const KEPT_ID_READS = [
  // The GRID model genuinely carries `_id`; grids are not projected.
  [/\b\w*[Gg]rid\w*\s*\??\.\s*_id\b/g, "the Grid model's own _id"],
  // `X.id || X._id` — bindSocketToStore x3, LayoutHelpers panel ids x2.
  [/\b(\w+)\.id\s*\|\|\s*\1\s*\??\.\s*_id[\w?.()]*/g, "fallback behind id"],
  // LayoutHelpers.normalizeId — `if (doc.id) return doc;` guards the line above.
  [/if\s*\(doc\._id\)\s*return\s*\{\s*\.\.\.doc,\s*id:\s*String\(doc\._id\)/g, "normalizeId fallback"],
  // A React key on a FIELD suggestion. Fields are not projected.
  [/key=\{item\._id\}/g, "React key on a Field, not a projected row"],
];

/** Reads of `.<key>` in the client, minus comments, minus `$trigger.<name>`
 *  (a variable NAME in a picker list, not a read), minus the kept forms above. */
function readersOf(key) {
  const hits = [];
  for (const f of files) {
    let src = readFileSync(f, "utf8");
    src = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, ""); // comments are not readers
    src = src.replace(/\$trigger\.\w+/g, "");
    for (const [re] of KEPT_ID_READS) src = src.replace(re, "");
    const re = new RegExp(`\\.\\s*${key}\\b`, "g");
    for (const m of src.match(re) || []) hits.push(`${f.replace(SRC, "")} ${m}`);
  }
  return hits;
}

describe("wireProjection — the omitted keys have no reader", () => {
  it.each([...WIRE_OMIT_KEYS])("nothing in the client reads .%s", (key) => {
    expect(readersOf(key)).toEqual([]);
  });

  it("CONTROL: the detector finds the keys that ARE read", () => {
    // Without this, "zero readers" is equally satisfied by a detector that
    // matches nothing at all — which is exactly how `updatedAt` nearly shipped.
    expect(readersOf("updatedAt").length).toBeGreaterThan(0);
    expect(readersOf("createdAt").length).toBeGreaterThan(0);
    expect(WIRE_OMIT_KEYS).not.toContain("updatedAt");
    expect(WIRE_OMIT_KEYS).not.toContain("createdAt");
  });

  it("CONTROL: the client source was actually scanned", () => {
    expect(files.length).toBeGreaterThan(200);
  });
});

describe("wireProjection — the hoist is lossless", () => {
  const rows = () => [
    { id: "a", gridId: "G", userId: "U", _id: "x1", timestamp: 1, label: "A", fields: { f: 1 } },
    { id: "b", gridId: "G", userId: "U", _id: "x2", timestamp: 2, label: "B" },
  ];

  it("round-trips to the original minus the omitted keys", () => {
    const { rows: wire, hoisted } = projectRowsForWire(rows());
    const back = rehydrateWireRows(wire, hoisted);
    expect(back).toEqual(rows().map(({ _id, timestamp, ...keep }) => keep));
  });

  it("lifts the constants off the rows and onto the envelope", () => {
    const { rows: wire, hoisted } = projectRowsForWire(rows());
    expect(hoisted).toEqual({ gridId: "G", userId: "U" });
    for (const k of WIRE_HOIST_KEYS) expect(wire[0]).not.toHaveProperty(k);
  });

  it("a MIXED batch keeps the key per row rather than losing a value", () => {
    // The guard that makes hoisting safe: a key is lifted only when every row
    // agrees. A batch spanning two grids must not be flattened onto one.
    const mixed = [{ id: "a", gridId: "G1", userId: "U" }, { id: "b", gridId: "G2", userId: "U" }];
    const { rows: wire, hoisted } = projectRowsForWire(mixed);
    expect(hoisted).toEqual({ userId: "U" });
    expect(rehydrateWireRows(wire, hoisted)).toEqual(mixed);
  });

  it("an empty batch hoists nothing", () => {
    expect(projectRowsForWire([])).toEqual({ rows: [], hoisted: {} });
  });
});
