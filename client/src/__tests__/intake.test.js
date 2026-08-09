import { describe, it, expect } from "vitest";
import {
  classifyIntake,
  normalizeIntakePayload,
  INTAKE_SHAPES as S,
  allIntakeShapeIds,
} from "../helpers/intake";

const ids = (r) => r.shapes.map((s) => s.id);
const file = (name, type = "") => ({ name, type });

describe("classifyIntake", () => {
  it("a PNG on a canvas offers the canvas pair; the same file in a doc does not", () => {
    const onCanvas = classifyIntake({ files: [file("floorplan.png", "image/png")] }, { kind: "canvas" });
    expect(onCanvas.fallback).toBe(S.IMAGE_ARTIFACT.id);
    expect(ids(onCanvas)).toContain(S.IMAGE_CANVAS.id);
    expect(ids(onCanvas)).toContain(S.IMAGE_OUTLINE.id);

    const inDoc = classifyIntake({ files: [file("floorplan.png", "image/png")] }, { kind: "doc" });
    // A canvas shape inside a doc body would be a shape with nowhere to go.
    expect(ids(inDoc)).not.toContain(S.IMAGE_CANVAS.id);
    expect(ids(inDoc)).not.toContain(S.IMAGE_OUTLINE.id);
    expect(inDoc.fallback).toBe(S.IMAGE_ARTIFACT.id);
  });

  it("attach-to-this appears only when the destination occurrence has a Files field", () => {
    const bare = classifyIntake({ files: [file("a.jpg", "image/jpeg")] }, { kind: "board" });
    expect(ids(bare)).not.toContain(S.IMAGE_ATTACH.id);
    const onOcc = classifyIntake({ files: [file("a.jpg", "image/jpeg")] },
      { kind: "board", occurrenceId: "occ1", filesFieldId: "f-files" });
    expect(ids(onOcc)).toContain(S.IMAGE_ATTACH.id);
  });

  it("a bare URL offers chip / bookmark / page / follow", () => {
    const r = classifyIntake({ url: "https://en.wikipedia.org/wiki/Eminem" }, { kind: "board" });
    expect(r.fallback).toBe(S.LINK_CHIP.id);
    expect(ids(r)).toEqual(expect.arrayContaining([
      S.LINK_CHIP.id, S.LINK_BOOKMARK.id, S.LINK_PAGE.id, S.LINK_FOLLOW.id,
    ]));
    // Not offered where they cannot land.
    expect(ids(r)).not.toContain(S.LINK_BOARD_OPTION.id);
    expect(ids(r)).not.toContain(S.LINK_FIELD_VALUE.id);
  });

  it("a link dropped on an OPTION BOARD can become a tagged option", () => {
    const r = classifyIntake({ url: "https://example.com/movie" },
      { kind: "board", isOptionBoard: true });
    expect(ids(r)).toContain(S.LINK_BOARD_OPTION.id);
  });

  it("several links fall back to the container instead of a lone chip", () => {
    const r = classifyIntake({ text: "https://a.com\nhttps://b.com\nhttps://c.com" }, { kind: "board" });
    expect(r.payload.kind).toBe("link");
    expect(r.payload.urls).toHaveLength(3);
    expect(r.fallback).toBe(S.LINK_CONTAINER.id);
  });

  it("three files offer the SET shapes", () => {
    const r = classifyIntake({ files: [file("a.pdf"), file("b.pdf"), file("c.pdf")] }, { kind: "board" });
    expect(r.fallback).toBe(S.FILES_SIBLINGS.id);
    expect(ids(r)).toEqual(expect.arrayContaining([
      S.FILES_SIBLINGS.id, S.FILES_CONTAINER.id, S.FILES_FOLDER_PAGE.id,
    ]));
  });

  it("HTML offers the tree shapes; inside a doc the words win over the page wrapper", () => {
    const html = "<h2>Heading</h2><p>Some prose that is long enough to matter.</p>";
    const onBoard = classifyIntake({ html }, { kind: "board", occurrenceId: "c1" });
    expect(ids(onBoard)).toEqual(expect.arrayContaining([
      S.TEXT_DOC_PAGE.id, S.TEXT_CONTAINER_TREE.id, S.TEXT_TEXTBLOCK.id, S.TEXT_CHECKLIST.id,
    ]));
    expect(classifyIntake({ html }, { kind: "doc" }).fallback).toBe(S.TEXT_TEXTBLOCK.id);
  });

  // NOT a UI default — nothing is pre-selected. This is the no-host fallback,
  // and it reproduces what the drop ALREADY did at this destination: the tree
  // lands in place when there is somewhere to land, and only the homeless
  // (empty-cell) import gets wrapped in a page.
  it("the text fallback follows the destination: tree in place, page when homeless", () => {
    const html = "<h2>Heading</h2><p>Some prose that is long enough to matter.</p>";
    expect(classifyIntake({ html }, { kind: "board", occurrenceId: "c1" }).fallback)
      .toBe(S.TEXT_CONTAINER_TREE.id);
    expect(classifyIntake({ html }, { kind: null, occurrenceId: null }).fallback)
      .toBe(S.TEXT_DOC_PAGE.id);
  });

  // A container root with no parent is listed by nobody and embedded in
  // nothing — offering it would mint something invisible.
  it("the container tree is NOT offered when there is nowhere to put it", () => {
    const html = "<h2>Heading</h2><p>Some prose that is long enough to matter.</p>";
    const homeless = classifyIntake({ html }, { kind: null, occurrenceId: null });
    expect(ids(homeless)).not.toContain(S.TEXT_CONTAINER_TREE.id);
    expect(ids(homeless)).toContain(S.TEXT_DOC_PAGE.id);
  });

  // The engine still cannot read a PDF — `helpers/pdfPages` rasterises each
  // page first (2026-08-09). Before that existed the shape was offered on
  // `.pdf` and NOTHING else, i.e. pointed at the one type its runner refuses.
  it("the OCR shape is offered on images AND, via rasterising, on PDFs", () => {
    const img = classifyIntake({ files: [file("receipt.jpg", "image/jpeg")] }, { kind: "board", occurrenceId: "c1" });
    expect(ids(img)).toContain(S.FILE_OCR_TEXT.id);
    // Both OCR outcomes on an image — prose vs one item per line — because
    // which one is right is a fact about the photo, not the file.
    expect(ids(img)).toContain(S.IMAGE_OCR_LIST.id);

    const pdf = classifyIntake({ files: [file("scan.pdf", "application/pdf")] }, { kind: "board", occurrenceId: "c1" });
    expect(ids(pdf)).toContain(S.FILE_OCR_TEXT.id);
    // Keeping it as a plain file stays on offer — that is the common case, and
    // OCR is one slow pass per page.
    expect(ids(pdf)).toContain(S.FILE_ARTIFACT.id);
    expect(pdf.fallback).toBe(S.FILE_ARTIFACT.id);
  });

  it("a file that is neither an image nor a PDF gets no OCR tile", () => {
    const zip = classifyIntake({ files: [file("backup.zip", "application/zip")] }, { kind: "board", occurrenceId: "c1" });
    expect(ids(zip)).not.toContain(S.FILE_OCR_TEXT.id);
  });

  it("a .md file routes to the importer — the audit gap — and a .csv to a table", () => {
    const md = classifyIntake({ files: [file("notes.md", "text/markdown")] }, { kind: "board" });
    expect(md.fallback).toBe(S.FILE_MARKDOWN_IMPORT.id);
    const csv = classifyIntake({ files: [file("weights.csv", "text/csv")] }, { kind: "board" });
    expect(csv.fallback).toBe(S.FILE_CSV_TABLE.id);
  });

  it("an unknown payload returns EXACTLY ONE shape — never zero", () => {
    const r = classifyIntake({}, { kind: "board" });
    expect(r.shapes).toHaveLength(1);
    expect(r.fallback).toBe(r.shapes[0].id);
  });

  it("the fallback id is always one of the offered shapes", () => {
    const cases = [
      [{ url: "https://a.com" }, { kind: "canvas" }],
      [{ files: [file("x.png", "image/png")] }, { kind: "doc" }],
      [{ files: [file("a.txt"), file("b.txt")] }, { kind: "grid-cell" }],
      [{ text: "just some words" }, { kind: "board" }],
      [{}, {}],
    ];
    for (const [p, d] of cases) {
      const r = classifyIntake(p, d);
      expect(ids(r)).toContain(r.fallback);
    }
  });

  it("every emitted shape id is declared in INTAKE_SHAPES (the router's contract)", () => {
    const declared = new Set(allIntakeShapeIds());
    const seen = new Set();
    for (const d of [{ kind: "canvas", occurrenceId: "o", filesFieldId: "f", linkFieldId: "l", isOptionBoard: true },
                     { kind: "doc" }, { kind: "board" }, { kind: "grid-cell" }]) {
      for (const p of [{ url: "https://a.com" }, { text: "https://a.com\nhttps://b.com" },
                       { files: [file("a.png", "image/png")] }, { files: [file("a.md")] },
                       { files: [file("a.csv")] }, { files: [file("a.pdf")] },
                       { files: [file("a.pdf"), file("b.pdf")] }, { html: "<p>hello there friend</p>" }, {}]) {
        classifyIntake(p, d).shapes.forEach((s) => seen.add(s.id));
      }
    }
    for (const id of seen) expect(declared.has(id)).toBe(true);
    expect(seen.size).toBeGreaterThan(10);
  });
});

describe("normalizeIntakePayload", () => {
  it("prose containing a link is TEXT, not a link payload", () => {
    const r = normalizeIntakePayload({ text: "see https://a.com for details, it is worth a read" });
    expect(r.kind).toBe("text");
  });
  it("a list of bare urls is a LINK payload", () => {
    expect(normalizeIntakePayload({ text: "https://a.com https://b.com" }).kind).toBe("link");
  });
  it("files win over any accompanying text", () => {
    expect(normalizeIntakePayload({ files: [file("a.png", "image/png")], text: "https://a.com" }).kind).toBe("file");
  });
});

describe("a shape can ask a second question", () => {
  const url = { url: "https://example.com" };

  it("the link-field shape is offered ONLY where the row has text fields to fill", () => {
    const none = classifyIntake(url, { kind: "board", occurrenceId: "o1" });
    expect(ids(none)).not.toContain(S.LINK_FIELD_VALUE.id);

    const some = classifyIntake(url, {
      kind: "board", occurrenceId: "o1",
      linkFields: [{ id: "f-web", name: "Website" }],
    });
    expect(ids(some)).toContain(S.LINK_FIELD_VALUE.id);
  });

  it("it carries the field list as its follow-up, in binding order", () => {
    const r = classifyIntake(url, {
      kind: "board", occurrenceId: "o1",
      linkFields: [{ id: "f-web", name: "Website" }, { id: "f-li", name: "LinkedIn" }],
    });
    const shape = r.shapes.find((s) => s.id === S.LINK_FIELD_VALUE.id);
    expect(shape.followUp.kind).toBe("choose-one");
    expect(shape.followUp.options).toEqual([
      { value: "f-web", label: "Website" },
      { value: "f-li", label: "LinkedIn" },
    ]);
  });

  // The user's call (2026-08-09): ask even when there is only one candidate.
  it("asks even when there is exactly ONE candidate field", () => {
    const r = classifyIntake(url, {
      kind: "board", occurrenceId: "o1",
      linkFields: [{ id: "f-web", name: "Website" }],
    });
    const shape = r.shapes.find((s) => s.id === S.LINK_FIELD_VALUE.id);
    expect(shape.followUp.options).toHaveLength(1);
  });

  it("the shared shape constant is not mutated by attaching a follow-up", () => {
    classifyIntake(url, { kind: "board", occurrenceId: "o1", linkFields: [{ id: "f", name: "F" }] });
    expect(S.LINK_FIELD_VALUE.followUp).toBeUndefined();
  });
});

// The canvas shapes MINT the surface, so requiring one to exist first meant
// building the thing before you could use the shape that builds it.
describe("the canvas shapes are offered anywhere except a doc body", () => {
  const png = { files: [file("shot.png", "image/png")] };

  it("offers them on an ordinary board, with no canvas in sight", () => {
    const r = classifyIntake(png, { kind: "board", occurrenceId: "c1" });
    expect(ids(r)).toContain(S.IMAGE_CANVAS.id);
    expect(ids(r)).toContain(S.IMAGE_OUTLINE.id);
  });

  it("still offers them ON a canvas", () => {
    const r = classifyIntake(png, { kind: "canvas", occurrenceId: "c1" });
    expect(ids(r)).toContain(S.IMAGE_CANVAS.id);
  });

  // A doc renders its TEXTMAP, so a page minted into one is listed in
  // occurrences[] and invisible, and no caller wires an embed seam for a page.
  it("withholds them inside a doc body", () => {
    const r = classifyIntake(png, { kind: "doc", occurrenceId: "c1" });
    expect(ids(r)).not.toContain(S.IMAGE_CANVAS.id);
    expect(ids(r)).not.toContain(S.IMAGE_OUTLINE.id);
  });

  it("offers ONE canvas for a set of images, and not in a doc", () => {
    const many = { files: [file("a.png", "image/png"), file("b.png", "image/png")] };
    expect(ids(classifyIntake(many, { kind: "board", occurrenceId: "c1" }))).toContain(S.IMAGE_CANVAS.id);
    expect(ids(classifyIntake(many, { kind: "doc", occurrenceId: "c1" }))).not.toContain(S.IMAGE_CANVAS.id);
  });
});
