// EVERY IMPORTED NODE KNOWS ITS PARENT, or deleting the page orphans it.
//
// `delete_occurrence` cascades only through children whose `parentId` points
// back at the node being deleted — deliberately, so a multi-parented child
// survives. The importer minted most children with `parentId: null` ("set when
// added to container.occurrences", which nothing did), so deleting an imported
// page left most of the tree behind. Measured on two real imports (2026-09-22):
// 3 of 4 and 10 of 18 child nodes would have survived a root delete.
import { describe, it, expect, vi } from "vitest";

vi.mock("../models/Module.js", () => ({ default: { insertMany: vi.fn() } }));
vi.mock("../models/Occurrence.js", () => ({ default: { insertMany: vi.fn(), findOneAndUpdate: vi.fn() } }));
const { markdownToModuli } = await import("../services/markdownImporter.js");

const MD = [
  "# Zazen",
  "",
  "![Monk](https://x/monk.jpg)",
  "",
  "Zazen is seated meditation.",
  "",
  "## Practice",
  "",
  "- sit",
  "- breathe",
  "",
  "> Just sit.",
  "",
  "| a | b |",
  "|---|---|",
  "| 1 | 2 |",
  "",
  "### Posture",
  "",
  "Keep the back straight.",
].join("\n");

describe("imported trees", () => {
  it("stamp every child's parentId with the node that lists it", async () => {
    const r = await markdownToModuli({ gridId: "g", userId: "u", markdown: MD, title: "Zazen", dryRun: true, sourceUrl: "https://x/z" });
    const listedBy = new Map();
    for (const o of r.occurrences) for (const c of o.occurrences || []) listedBy.set(c, o.id);
    // LISTED children only. Nodes embedded solely in a textblock's TEXT (list
    // chips, quotes, the source link) are listed by no node; the cascade walks
    // `occurrences[]`, so parentId alone would not reach them — tracked apart.
    const wrong = r.occurrences
      .filter((o) => listedBy.has(o.id))
      .filter((o) => listedBy.get(o.id) !== o.parentId)
      .map((o) => `${o.id.slice(0, 8)} parentId=${o.parentId} listedBy=${listedBy.get(o.id)?.slice(0, 8)}`);
    expect(listedBy.size).toBeGreaterThan(5);
    expect(wrong).toEqual([]);
  });

  it("CONTROL — the root keeps the parent it was given", async () => {
    const r = await markdownToModuli({ gridId: "g", userId: "u", markdown: MD, title: "Zazen", dryRun: true, parentId: "dest" });
    expect(r.occurrences.find((o) => o.id === r.rootOccurrenceId).parentId).toBe("dest");
  });
});
