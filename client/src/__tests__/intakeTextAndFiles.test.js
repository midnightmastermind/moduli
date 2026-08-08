// Intake Task 5, continued (2026-08-08): `text-textblock` and `files-container`.
//
// WHY text-textblock FIRST. The classifier ALREADY preselects it for text
// dropped inside a doc body ("inside a doc the page wrapper has nowhere to go —
// the words do"), but it had no route, so `filterToImplemented` silently
// re-pointed the preselection at TEXT_DOC_PAGE. Pasting a paragraph into a doc
// therefore offered to build a whole page. That is the same shape as the
// link-chip preselection bug recorded on 2026-08-07 (5): a classifier decision
// quietly overruled by a missing route.
//
// files-container is the file twin of `runLinkContainer` — N things dropped at
// once become ONE container holding them, rather than N loose siblings.
import { describe, it, expect, vi, beforeEach } from "vitest";

const createArtifactPlaceholders = vi.fn(() => [{ moduleId: "m1", occurrenceId: "o1" }]);
const uploadArtifactPlaceholders = vi.fn();
vi.mock("../helpers/artifactUpload", () => ({
  createArtifactPlaceholders: (...a) => createArtifactPlaceholders(...a),
  uploadArtifactPlaceholders: (...a) => uploadArtifactPlaceholders(...a),
}));

const createTextblockInContainer = vi.fn(() => ({ moduleId: "tm", occurrenceId: "to" }));
const createContainerInContainer = vi.fn(() => ({ moduleId: "cm", occurrenceId: "co" }));
vi.mock("../helpers/CommitHelpers", async (orig) => ({
  ...(await orig()),
  createTextblockInContainer: (...a) => createTextblockInContainer(...a),
  createContainerInContainer: (...a) => createContainerInContainer(...a),
}));

const { applyIntakeShape, INTAKE_ROUTES } = await import("../helpers/intakeApply.js");
const { INTAKE_SHAPES, classifyIntake } = await import("../helpers/intake.js");

const DEST = { id: "dest", gridId: "g", userId: "u", occurrences: [] };
const base = { gridId: "g", userId: "u", dispatch: vi.fn(), socket: {}, destinationOccurrence: DEST };

beforeEach(() => { vi.clearAllMocks(); });

describe("text-textblock", () => {
  it("is routed at all", () => {
    expect(typeof INTAKE_ROUTES[INTAKE_SHAPES.TEXT_TEXTBLOCK.id]?.run).toBe("function");
  });

  it("mints ONE textblock carrying the text verbatim", () => {
    applyIntakeShape(INTAKE_SHAPES.TEXT_TEXTBLOCK.id, { ...base, payload: { text: "hello  world" } });
    expect(createTextblockInContainer).toHaveBeenCalledTimes(1);
    const arg = createTextblockInContainer.mock.calls[0][0];
    expect(arg.containerOccurrence).toBe(DEST);
    // The words, unedited — that is the shape's whole promise ("verbatim").
    expect(JSON.stringify(arg.textmap)).toContain("hello  world");
  });

  // Multi-paragraph text must stay multi-paragraph. Collapsing it would make
  // this shape lossy, and the user picked "the words, verbatim".
  it("keeps blank-line-separated paragraphs as separate paragraphs", () => {
    applyIntakeShape(INTAKE_SHAPES.TEXT_TEXTBLOCK.id, { ...base, payload: { text: "one\n\ntwo\n\nthree" } });
    const doc = createTextblockInContainer.mock.calls[0][0].textmap;
    expect(doc.content.filter((n) => n.type === "paragraph")).toHaveLength(3);
  });

  it("writes nothing without text or a destination", () => {
    applyIntakeShape(INTAKE_SHAPES.TEXT_TEXTBLOCK.id, { ...base, payload: { text: "   " } });
    applyIntakeShape(INTAKE_SHAPES.TEXT_TEXTBLOCK.id, { payload: { text: "x" } });
    expect(createTextblockInContainer).not.toHaveBeenCalled();
  });

  // THE REGRESSION THIS FIXES: the classifier's own preselection must survive
  // the implemented-filter now that the route exists.
  it("stays preselected for text dropped inside a doc", async () => {
    const { filterToImplemented } = await import("../helpers/intakeApply.js");
    // The destination's KIND is what makes it "in a doc" — there is no `inDoc`
    // flag (the first version of this test invented one and failed against
    // correct code).
    const c = classifyIntake(
      { kind: "text", text: "a paragraph of prose that is long enough to matter" },
      { kind: "doc" },
    );
    expect(c.preselected).toBe(INTAKE_SHAPES.TEXT_TEXTBLOCK.id);
    expect(filterToImplemented(c).preselected).toBe(INTAKE_SHAPES.TEXT_TEXTBLOCK.id);
  });
});

describe("files-container", () => {
  const files = [{ name: "a.png" }, { name: "b.pdf" }, { name: "c.txt" }];

  it("is routed at all", () => {
    expect(typeof INTAKE_ROUTES[INTAKE_SHAPES.FILES_CONTAINER.id]?.run).toBe("function");
  });

  it("mints ONE container and uploads every file INTO it, not beside it", () => {
    applyIntakeShape(INTAKE_SHAPES.FILES_CONTAINER.id, { ...base, files });
    expect(createContainerInContainer).toHaveBeenCalledTimes(1);
    expect(createArtifactPlaceholders).toHaveBeenCalledTimes(1);
    // The files' parent is the NEW container — this is the whole difference
    // between this shape and files-siblings.
    const parent = createArtifactPlaceholders.mock.calls[0][1].parentOccurrence;
    expect(parent.id).toBe("co");
    expect(createArtifactPlaceholders.mock.calls[0][0]).toHaveLength(3);
  });

  it("names the container after the number of files", () => {
    applyIntakeShape(INTAKE_SHAPES.FILES_CONTAINER.id, { ...base, files });
    expect(createContainerInContainer.mock.calls[0][0].label).toContain("3");
  });

  // If the container mint fails there is nowhere to put them; uploading anyway
  // would scatter the files loose at the destination, which is the OTHER shape.
  it("writes no files when the container could not be minted", () => {
    createContainerInContainer.mockReturnValueOnce(null);
    applyIntakeShape(INTAKE_SHAPES.FILES_CONTAINER.id, { ...base, files });
    expect(createArtifactPlaceholders).not.toHaveBeenCalled();
  });

  it("writes nothing without files or a destination", () => {
    applyIntakeShape(INTAKE_SHAPES.FILES_CONTAINER.id, { ...base, files: [] });
    applyIntakeShape(INTAKE_SHAPES.FILES_CONTAINER.id, { files });
    expect(createContainerInContainer).not.toHaveBeenCalled();
  });
});

describe("files-container is destination-aware", () => {
  const files = [{ name: "a.png" }, { name: "b.pdf" }];

  it("is offered on a board", () => {
    const ids = classifyIntake({ files }, { kind: "board" }).shapes.map(s => s.id);
    expect(ids).toContain(INTAKE_SHAPES.FILES_CONTAINER.id);
  });

  // A doc renders its TEXTMAP. A container minted into one is listed in
  // occurrences[] and invisible on screen — so the shape must not be offered
  // there at all, rather than mint something the user cannot find.
  it("is NOT offered inside a doc body", () => {
    const ids = classifyIntake({ files }, { kind: "doc" }).shapes.map(s => s.id);
    expect(ids).not.toContain(INTAKE_SHAPES.FILES_CONTAINER.id);
    expect(ids).not.toContain(INTAKE_SHAPES.FILES_FOLDER_PAGE.id);
    // The per-file shape still is — the doc arm embeds those.
    expect(ids).toContain(INTAKE_SHAPES.FILES_SIBLINGS.id);
  });
});
