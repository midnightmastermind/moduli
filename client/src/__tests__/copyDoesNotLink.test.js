// A COPY OF A COPY-LINKED OCCURRENCE IS A PLAIN COPY.
//
// User, 2026-09-17: *"if i copy a copylinked occurance (lets say i copy
// something from tasks completed and drag it elsewhere), that it creates a copy
// and not copylink. it should only ever copylink for feeds or if i do a copy
// link myself."*
//
// The worry is well-founded in shape: a feed copy carries BOTH
// `linkedGroupId` (it is copy-linked to its source) and `meta.feedSourceId`
// (the marker feedSync sweeps on). If either travelled into a plain copy:
//
//   linkedGroupId   -> the new row silently joins the linked group, so editing
//                      it writes through to the original AND every sibling
//                      (the server fans field writes out across the group)
//   feedSourceId    -> feedSync would treat the new row as one of ITS copies
//                      and sweep it the moment it stopped matching — a row the
//                      user placed by hand, deleted by a background engine
//
// `copyInstanceToContainer` builds a fresh occurrence rather than spreading the
// source, so neither can travel. These tests pin that, because the drop path
// DOES hand it the whole source object (`sourceOccurrence: {...sourceOcc,
// fields: stampedFields}`) — one `...sourceOccurrence` added to the builder
// would reintroduce both at once, and nothing else would fail.
import { describe, it, expect, vi, beforeEach } from "vitest";

const created = [];
// LayoutHelpers does `import * as CommitHelpers`, so the mock has to expose
// NAMED exports — a `default` object is invisible to a namespace import.
vi.mock("../helpers/CommitHelpers", () => ({
  createOccurrence: (args) => { created.push(args.occurrence); },
  createModule: () => {},
  updateOccurrence: () => {},
  removeOccurrence: () => {},
  updateModule: () => {},
}));

const LayoutHelpers = await import("../helpers/LayoutHelpers");

/** A feed copy as it really is on the grid: linked AND feed-marked. */
const feedCopy = () => ({
  id: "copy-1",
  moduleId: "mod-appointment",
  linkedGroupId: "lg-source-1",
  meta: { feedSourceId: "source-1" },
  parentId: "completed-container",
  fields: { f1: { value: true, flow: "in" } },
  label: "Therapy with Keith",
});

const args = (sourceOccurrence) => ({
  dispatch: () => {},
  socket: { emit: () => {} },
  gridId: "g1",
  userId: "u1",
  sourceInstanceId: "mod-appointment",
  toContainer: { id: "dest", label: "Emotional", _occurrence: { id: "dest-occ", occurrences: [] } },
  sourceOccurrence,
});

beforeEach(() => { created.length = 0; });

describe("copying a feed copy", () => {
  it("does NOT carry the linkedGroupId", () => {
    LayoutHelpers.copyInstanceToContainer(args(feedCopy()));
    expect(created).toHaveLength(1);
    expect(created[0].linkedGroupId).toBeUndefined();
  });

  it("does NOT carry meta.feedSourceId", () => {
    LayoutHelpers.copyInstanceToContainer(args(feedCopy()));
    expect(created[0].meta?.feedSourceId).toBeUndefined();
  });

  it("gets a fresh id and is parented to the destination", () => {
    LayoutHelpers.copyInstanceToContainer(args(feedCopy()));
    expect(created[0].id).not.toBe("copy-1");
    expect(created[0].parentId).toBe("dest-occ");
  });

  // The CONTROL. Without it, "carries no linkedGroupId" is equally satisfied by
  // a copy that carries nothing at all — including the field values, which is
  // the whole point of copying.
  it("DOES carry the field values", () => {
    LayoutHelpers.copyInstanceToContainer(args(feedCopy()));
    expect(created[0].fields).toEqual({ f1: { value: true, flow: "in" } });
  });

  // Deep-cloned, so editing the copy cannot reach back into the source's own
  // field object through a shared reference.
  it("deep-clones the fields rather than sharing the object", () => {
    const src = feedCopy();
    LayoutHelpers.copyInstanceToContainer(args(src));
    expect(created[0].fields).not.toBe(src.fields);
    created[0].fields.f1.value = "mutated";
    expect(src.fields.f1.value).toBe(true);
  });
});

describe("copy-link is the OTHER path, and it does link", () => {
  // The discriminating sibling: the same source through the copylink helper
  // MUST produce a linkedGroupId. Without this, every assertion above is also
  // satisfied by a build where linking is broken everywhere.
  it("copylinkInstanceToContainer produces a linked occurrence", () => {
    LayoutHelpers.copylinkInstanceToContainer({
      ...args(feedCopy()),
      sourceOccurrenceId: "copy-1",
    });
    expect(created).toHaveLength(1);
    expect(created[0].linkedGroupId).toBeTruthy();
  });
});
