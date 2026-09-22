// A COPY-LINK drop into a doc LEAVES THE SOURCE WHERE IT WAS.
//
// FOUND ON PROD (rebuild grid, 2026-09-22), by a UI drag of "Wake Up" — a row
// whose drag mode is copylink — that missed its container and released over the
// "How This Grid Works" doc page. Read back out of the transactions collection,
// one gesture wrote exactly two things:
//
//     6:00am                occurrences  [Breakfast, Wake Up] -> [Breakfast]
//     How This Grid Works   textmap      + moduleEmbed(Wake Up's own id)
//
// i.e. a MOVE. The editor's block-embed drop branched on `dragMode === "copy"`
// and let every other mode fall through to the move path, so copylink detached
// the source from its slot. A copy-link must never remove the original — that
// is the whole difference between it and a move.
//
// The drop handler lives inside Editor's registration effect and needs a live
// TipTap + Pragmatic DnD to mount, so the wiring is pinned by a source guard
// SCOPED TO THE BLOCK-EMBED BRANCH (a whole-file indexOf matched an unrelated
// earlier occurrence once and passed against the defect — root CLAUDE.md,
// 2026-09-18). The mint itself is unit-tested through the real helper.
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const created = [];
const updated = [];
vi.mock("../helpers/CommitHelpers", () => ({
  createOccurrence: (args) => { created.push(args); },
  createModule: () => {},
  updateOccurrence: (args) => { updated.push(args.occurrence); },
  removeOccurrence: () => {},
  updateModule: () => {},
}));

const LayoutHelpers = await import("../helpers/LayoutHelpers");

describe("mintLinkedCopy", () => {
  beforeEach(() => { created.length = 0; updated.length = 0; });

  const base = (src) => ({
    dispatch: () => {}, socket: null, gridId: "g1",
    sourceInstanceId: src.moduleId, sourceOccurrenceId: src.id, sourceOccurrence: src,
    emit: false, fireTrigger: false,
  });

  it("joins the source's existing group and never touches the source's parent", () => {
    const src = { id: "wake", moduleId: "m-wake", linkedGroupId: "lg-1", fields: { done: { value: false } } };
    const r = LayoutHelpers.mintLinkedCopy(base(src));
    expect(r.linkedGroupId).toBe("lg-1");
    expect(created).toHaveLength(1);
    expect(created[0].occurrence.id).not.toBe("wake");
    expect(created[0].occurrence.linkedGroupId).toBe("lg-1");
    expect(created[0].occurrence.fields).toEqual({ done: { value: false } });
    // No write at all: no parent list edit (that is what the move did), no re-tag.
    expect(updated).toEqual([]);
  });

  it("tags an ungrouped source with its own id, the assignLinkedGroup convention", () => {
    const src = { id: "wake", moduleId: "m-wake", fields: {} };
    const r = LayoutHelpers.mintLinkedCopy(base(src));
    expect(r.linkedGroupId).toBe("wake");
    expect(updated).toEqual([{ id: "wake", linkedGroupId: "wake" }]);
  });

  it("places the copy nowhere unless asked (a doc embed owns it through its textmap)", () => {
    LayoutHelpers.mintLinkedCopy(base({ id: "wake", moduleId: "m-wake", linkedGroupId: "lg-1" }));
    expect(created[0].occurrence.parentId).toBeNull();
  });

  it("copylinkInstanceToContainer still lists its copy in the container (the refactor's control)", () => {
    const src = { id: "wake", moduleId: "m-wake", linkedGroupId: "lg-1" };
    const r = LayoutHelpers.copylinkInstanceToContainer({
      ...base(src), userId: "u1",
      toContainer: { id: "m-9am", _occurrence: { id: "occ-9am", occurrences: [] } },
    });
    expect(created[0].occurrence.parentId).toBe("occ-9am");
    expect(created[0].occurrence.userId).toBe("u1");
    expect(r.linkedGroupId).toBe("lg-1");
  });
});

describe("Editor block-embed drop handles copylink before the move path", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "../ui/Editor.jsx"), "utf8");
  const start = src.indexOf("// ── Block-embed drop — ONE path for every embeddable occurrence");
  const end = src.indexOf('if (type === "field")', start);
  const branch = src.slice(start, end);

  it("the branch exists (control — a deleted branch must not pass)", () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(branch).toContain("DETACH source from parent");
  });

  it("returns from a copylink drop before any detach", () => {
    const linkAt = branch.indexOf('dragMode === "copylink"');
    const detachAt = branch.indexOf("DETACH source from parent");
    expect(linkAt).toBeGreaterThan(-1);
    expect(linkAt).toBeLessThan(detachAt);
    const linkBody = branch.slice(linkAt, detachAt);
    expect(linkBody).toContain("mintLinkedCopy(");
    expect(linkBody).toMatch(/return;/);
  });
});
