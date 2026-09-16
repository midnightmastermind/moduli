// THE BUTTON THAT MAKES A PAGE OUT OF WHAT YOU ARE READING.
//
// User, 2026-09-16: *"we also need to add in a button on the browsers magic and
// reading views. to add as a page to our grid. (outside of the bookmark
// occurance)."*
//
// The viewer already PLANS the tree it is showing — `import_plan` with
// `shape: "reader" | "magic"` is what Reader and Magic render. But the only
// handler that MINTS, `import_text`, had no shape at all: it always ran the
// magic tree. So the button would have handed you a page that did not match the
// one you were looking at, which is the drift `import_plan`'s own comment warns
// about ("a second 'plan' path is exactly how the read tree and the imported
// tree would drift").
//
// The shape choice is now ONE function both handlers call, and the test that
// matters is the LAST pair here: plan and mint must agree, AND the two shapes
// must genuinely differ (or "they agree" is satisfied by an argument nothing
// reads).
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../models/Module.js", () => ({ default: { insertMany: vi.fn() } }));
vi.mock("../models/Occurrence.js", () => ({ default: { insertMany: vi.fn(), findOneAndUpdate: vi.fn() } }));
const persistImportResult = vi.fn(async () => {});
vi.mock("../utils/persistImport.js", () => ({ persistImportResult: (...a) => persistImportResult(...a) }));
const linkRootIntoParent = vi.fn(async () => {});
vi.mock("../utils/linkRootIntoParent.js", () => ({ linkRootIntoParent: (...a) => linkRootIntoParent(...a) }));

const { registerImportHandlers } = await import("../socketHandlers/import.js");

const MD = [
  "# Albert Ellis",
  "",
  "![Albert Ellis](https://x/portrait.jpg)",
  "",
  "He founded rational emotive behavior therapy.",
  "",
  "## Early life",
  "",
  "Ellis was born in Pittsburgh.",
  "",
  "## Career",
  "",
  "He held MA and PhD degrees.",
].join("\n");

function harness() {
  const handlers = {};
  const broadcast = [];
  const socket = { userId: "user-1", on: (evt, fn) => { handlers[evt] = fn; }, emit: () => {} };
  const io = { to: () => ({ emit: (evt, p) => broadcast.push({ evt, p }) }) };
  registerImportHandlers(socket, { io, getUC: async () => ({}), userRoom: (u) => `user:${u}` });
  return { handlers, broadcast };
}
const call = (handlers, evt, payload) => new Promise((res) => handlers[evt](payload, res));

// `import_text`'s REPLY deliberately omits the rows to keep the payload small —
// they reach the client as `module_created` / `occurrence_created` broadcasts.
// So the mint is measured by what a tab actually RECEIVES, which is the honest
// thing to compare a plan against anyway.
const mintedFrom = (broadcast) => ({
  modules: broadcast.filter((b) => b.evt === "module_created").map((b) => b.p.module),
  occurrences: broadcast.filter((b) => b.evt === "occurrence_created").map((b) => b.p.occurrence),
});

// The structural fingerprint of a tree: how many of each role/kind. Ids differ
// between two runs by construction, so comparing those would only ever prove
// that uid() is random.
const shapeOf = (mods) => {
  const out = {};
  for (const m of mods || []) out[`${m.role}/${m.kind}`] = (out[`${m.role}/${m.kind}`] || 0) + 1;
  return out;
};

beforeEach(() => { persistImportResult.mockClear(); linkRootIntoParent.mockClear(); });

describe("import_text takes a shape", () => {
  it("reader shape mints ONE container and ONE textblock", async () => {
    const { handlers, broadcast } = harness();
    const out = await call(handlers, "import_text", {
      content: MD, gridId: "g1", title: "Albert Ellis", shape: "reader",
    });
    expect(out.ok).toBe(true);
    expect(shapeOf(mintedFrom(broadcast).modules)).toEqual({ "container/doc": 1, "textblock/doc": 1 });
  });

  // THE BACK-COMPAT CONTROL. Every existing caller (the drag/paste import)
  // passes no shape and must keep getting the full tree.
  it("no shape is the magic tree, exactly as before", async () => {
    const { handlers, broadcast } = harness();
    const out = await call(handlers, "import_text", { content: MD, gridId: "g1", title: "Albert Ellis" });
    expect(out.ok).toBe(true);
    // Many sections, not one textblock — the discriminator against reader.
    expect(shapeOf(mintedFrom(broadcast).modules)["container/doc"]).toBeGreaterThan(1);
  });

  // PARENTED IS NOT LISTED. A container renders its `occurrences[]`, so a root
  // that only carries `parentId` exists in the data and appears nowhere — the
  // created-but-unlinked class this repo has repaired from five directions.
  // `markdownToModuli` does this push itself; `planReaderShape` is a pure
  // planner and does not, so the reader shape was invisible until this.
  it("LISTS the imported root in its destination, not just parents it", async () => {
    for (const shape of ["reader", "magic"]) {
      const { handlers } = harness();
      const pushes = [];
      linkRootIntoParent.mockImplementation(async (a) => { pushes.push(a); });
      const out = await call(handlers, "import_text", {
        content: MD, gridId: "g1", title: "T", shape, parentId: "dest-occ",
      });
      expect(out.ok, shape).toBe(true);
      const hit = pushes.find((x) => x.parentId === "dest-occ" && x.childId === out.rootOccurrenceId);
      expect(hit, `root not listed by its parent for ${shape}`).toBeTruthy();
    }
  });

  it("parents the imported root into the chosen destination", async () => {
    for (const shape of ["reader", "magic"]) {
      const { handlers, broadcast } = harness();
      const out = await call(handlers, "import_text", {
        content: MD, gridId: "g1", title: "T", shape, parentId: "dest-occ",
      });
      const root = mintedFrom(broadcast).occurrences.find((o) => o.id === out.rootOccurrenceId);
      expect(root, `root missing for ${shape}`).toBeTruthy();
      expect(root.parentId, `parentId for ${shape}`).toBe("dest-occ");
    }
  });

  // It MINTS, so unlike import_plan it must persist as well as broadcast —
  // an import that only reaches open tabs is gone on the next reload.
  it("persists what it minted", async () => {
    const { handlers, broadcast } = harness();
    await call(handlers, "import_text", { content: MD, gridId: "g1", title: "T", shape: "reader" });
    expect(persistImportResult).toHaveBeenCalledTimes(1);
    expect(mintedFrom(broadcast).occurrences.length).toBeGreaterThan(0);
  });
});

describe("the plan and the mint cannot disagree", () => {
  // THE ONE THAT MATTERS. The viewer renders `import_plan`; the button mints
  // through `import_text`. If those ever produce different trees, the page you
  // get is not the page you previewed — silently.
  it("produces the same structure for the same shape", async () => {
    for (const shape of ["reader", "magic"]) {
      const { handlers, broadcast } = harness();
      const planned = await call(handlers, "import_plan", { content: MD, gridId: "g1", title: "T", shape });
      await call(handlers, "import_text", { content: MD, gridId: "g1", title: "T", shape });
      const got = mintedFrom(broadcast);
      expect(planned.ok, shape).toBe(true);
      expect(shapeOf(got.modules), `shape mismatch for ${shape}`).toEqual(shapeOf(planned.modules));
      expect(got.occurrences.length, `occurrence count for ${shape}`).toBe(planned.occurrences.length);
    }
  });

  it("and the two shapes are genuinely different trees", async () => {
    const { handlers } = harness();
    const reader = await call(handlers, "import_plan", { content: MD, gridId: "g1", title: "T", shape: "reader" });
    const magic = await call(handlers, "import_plan", { content: MD, gridId: "g1", title: "T", shape: "magic" });
    expect(shapeOf(reader.modules)).not.toEqual(shapeOf(magic.modules));
  });
});
