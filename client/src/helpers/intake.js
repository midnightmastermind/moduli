// helpers/intake.js
//
// Task 1 of docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md —
// the INTAKE CLASSIFIER. Pure: no React, no DOM, no network, no writes, and no
// stored defaults.
//
// The audit's first finding was that NOTHING ASKS: every drop decides silently,
// so the same file dropped two feet apart becomes two different things and the
// user is never told why. The fix is not another hard-coded payload→shape path;
// it is to name the SHAPES a payload could take here and let the sheet ask.
//
//   classifyIntake(payload, destination) → { payload, shapes[], preselected }
//
// TWO RULES THIS FILE IS BUILT ON:
//
// 1. **Never zero shapes.** Intake must always have something to do — an
//    unknown payload still gets exactly one shape (today's behaviour). A sheet
//    with no options is a dead end where a drop used to work.
// 2. **Every shape id must map to a real branch in the router** (`intakeApply`,
//    Task 3). A shape offered and not implemented is worse than one not
//    offered, so the ids live in `INTAKE_SHAPES` and the router's coverage is
//    asserted against that list.
//
// Classification keys on PAYLOAD KIND × DESTINATION KIND only. Anything that
// needs to look at live data (does this occurrence bind a media field? is this
// board an option board?) is passed IN on the destination — resolved by the
// caller, never fetched here.

/**
 * Every shape intake can produce. The `id` is the contract with the router.
 * `label` is what the sheet shows; `hint` is the one-line explanation under it.
 */
export const INTAKE_SHAPES = {
  // link
  // Today's behaviour, named so the sheet can offer it while Task 5's better
  // shapes land. The audit calls this out as the thing to replace — a card
  // whose label is a raw URL — but a decision layer that cannot reproduce
  // what the app already does is not behaviour-preserving, so it is a real
  // shape with a real route rather than an unnamed fallback.
  LINK_INSTANCE: { id: "link-instance", label: "Plain item", hint: "A card labelled with the link (today's behaviour)" },
  LINK_CHIP: { id: "link-chip", label: "Link chip", hint: "An inline chip you can click" },
  LINK_BOOKMARK: { id: "link-bookmark", label: "Bookmark card", hint: "Title and favicon, with room for a note" },
  LINK_PAGE: { id: "link-page", label: "Import the page", hint: "Fetch it and build the whole tree" },
  LINK_CONTAINER: { id: "link-container", label: "Container of links", hint: "One container holding every link" },
  LINK_BOARD_OPTION: { id: "link-board-option", label: "Board option", hint: "A real tagged option this board's dropdowns can see" },
  LINK_FIELD_VALUE: { id: "link-field-value", label: "Set as field value", hint: "Fill this occurrence's link field" },
  LINK_FOLLOW: { id: "link-follow", label: "…and follow its links", hint: "Import the pages it points at too" },

  // image
  IMAGE_ARTIFACT: { id: "image-artifact", label: "Image", hint: "An image artifact, as today" },
  IMAGE_CANVAS: { id: "image-canvas", label: "Canvas with it", hint: "A drawing surface holding the image" },
  IMAGE_OUTLINE: { id: "image-outline", label: "Outline version", hint: "Trace its edges onto their own layer" },
  IMAGE_ATTACH: { id: "image-attach", label: "Attach to this", hint: "Add to its Files, optionally as its face" },
  IMAGE_OCR_LIST: { id: "image-ocr-list", label: "Photo of a list → items", hint: "One instance per line, as a checklist" },

  // file
  FILE_ARTIFACT: { id: "file-artifact", label: "File", hint: "An artifact, as today" },
  FILE_OCR_TEXT: { id: "file-ocr-text", label: "File + its text", hint: "Artifact plus an OCR'd textblock" },
  FILE_MARKDOWN_IMPORT: { id: "file-markdown-import", label: "Import as a tree", hint: "Headings become containers, prose becomes textblocks" },
  FILE_CSV_TABLE: { id: "file-csv-table", label: "Table", hint: "Rows and columns as a real table container" },

  // several files
  FILES_SIBLINGS: { id: "files-siblings", label: "Separate items", hint: "One artifact each, side by side" },
  FILES_CONTAINER: { id: "files-container", label: "One container", hint: "Grouped together as a set" },
  FILES_FOLDER_PAGE: { id: "files-folder-page", label: "Folder page", hint: "A page of cards you can drill into" },

  // html / text
  TEXT_DOC_PAGE: { id: "text-doc-page", label: "Doc page", hint: "The imported tree, wrapped in a page" },
  TEXT_CONTAINER_TREE: { id: "text-container-tree", label: "Container tree", hint: "The structure without the page wrapper" },
  TEXT_TEXTBLOCK: { id: "text-textblock", label: "One textblock", hint: "The words, verbatim" },
  TEXT_CHECKLIST: { id: "text-checklist", label: "Checklist", hint: "Each line an item you can tick" },
};

const S = INTAKE_SHAPES;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|heif|tiff?)$/i;
const MARKDOWN_EXT = /\.(md|markdown|mdx)$/i;
const TABLE_EXT = /\.(csv|tsv)$/i;
const OCR_EXT = /\.(pdf)$/i;

/** Normalize the many shapes a drop/paste/QuickAdd can arrive in into one. */
export function normalizeIntakePayload(raw = {}) {
  const files = (raw.files || []).map((f) => ({
    name: f?.name || "",
    type: f?.type || "",
    size: f?.size ?? null,
  }));
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const html = typeof raw.html === "string" ? raw.html : "";
  const text = typeof raw.text === "string" ? raw.text : "";

  if (files.length) {
    const allImages = files.every(isImageFile);
    return { kind: files.length > 1 ? "files" : "file", files, count: files.length, allImages };
  }
  if (url && isUrlish(url)) return { kind: "link", urls: [url], count: 1 };

  // A text payload that is nothing but links is a LINK payload — that is the
  // "several links dropped at once" case, and treating it as prose would bury
  // it in a textblock.
  const urls = extractUrls(text);
  if (urls.length && urls.join("\n").length >= text.trim().length - urls.length) {
    return { kind: "link", urls, count: urls.length };
  }
  if (html && html.trim().length > 12) return { kind: "html", html, text, count: 1 };
  if (text.trim()) return { kind: "text", text, count: 1 };
  return { kind: "unknown", count: 0 };
}

export function isUrlish(s) {
  return /^(https?:\/\/|www\.)\S+$/i.test(String(s || "").trim());
}

export function isImageFile(f) {
  return /^image\//i.test(f?.type || "") || IMAGE_EXT.test(f?.name || "");
}

function extractUrls(text) {
  if (!text) return [];
  const lines = String(text).split(/\s+/).map((s) => s.trim()).filter(Boolean);
  const urls = lines.filter(isUrlish);
  return urls.length === lines.length ? urls : [];
}

/**
 * @param {object} payload    normalized (see normalizeIntakePayload)
 * @param {object} destination {
 *   kind:        "canvas" | "doc" | "board" | "table" | "folder" | "grid-cell" | null
 *   occurrenceId: string|null  — the occurrence being dropped ON (not the page)
 *   isOptionBoard: boolean     — resolved by the caller from the board's feed tag
 *   linkFieldId:  string|null  — a url/link field on that occurrence
 *   filesFieldId: string|null  — its Files field
 *   canDraw:      boolean      — a surface that can host a canvas (default: kind === "canvas")
 * }
 */
export function classifyIntake(payload = {}, destination = {}) {
  const p = payload && payload.kind ? payload : normalizeIntakePayload(payload);
  const d = destination || {};
  const onCanvas = d.canDraw ?? d.kind === "canvas";
  const inDoc = d.kind === "doc";
  const onOccurrence = !!d.occurrenceId;

  const shapes = [];
  const add = (shape) => { if (shape && !shapes.some((s) => s.id === shape.id)) shapes.push(shape); };

  let preselected = null;

  if (p.kind === "link") {
    const many = (p.urls?.length || 0) > 1;
    add(S.LINK_INSTANCE);
    add(S.LINK_CHIP);
    add(S.LINK_BOOKMARK);
    add(S.LINK_PAGE);
    if (many) add(S.LINK_CONTAINER);
    // Only where it can actually land: an option board can mint a tagged option
    // (addNewOption already knows how), an occurrence with a link field can take
    // the URL as a value.
    if (d.isOptionBoard) add(S.LINK_BOARD_OPTION);
    if (onOccurrence && d.linkFieldId) add(S.LINK_FIELD_VALUE);
    add(S.LINK_FOLLOW);
    preselected = many ? S.LINK_CONTAINER.id : S.LINK_CHIP.id;
  } else if (p.kind === "file" || p.kind === "files") {
    const files = p.files || [];
    const one = files.length === 1 ? files[0] : null;

    if (files.length > 1) {
      add(S.FILES_SIBLINGS);
      add(S.FILES_CONTAINER);
      add(S.FILES_FOLDER_PAGE);
      preselected = S.FILES_SIBLINGS.id;
      // A set of images can still become one canvas or be attached in bulk.
      if (p.allImages && onCanvas) add(S.IMAGE_CANVAS);
      if (p.allImages && onOccurrence && d.filesFieldId) add(S.IMAGE_ATTACH);
    } else if (one && isImageFile(one)) {
      add(S.IMAGE_ARTIFACT);
      // The canvas pair is the creative core — but only where a canvas can
      // live. Offering "make a canvas" inside a doc body would be a shape with
      // nowhere to go.
      if (onCanvas) { add(S.IMAGE_CANVAS); add(S.IMAGE_OUTLINE); }
      if (onOccurrence && d.filesFieldId) add(S.IMAGE_ATTACH);
      add(S.IMAGE_OCR_LIST);
      preselected = S.IMAGE_ARTIFACT.id;
    } else if (one && MARKDOWN_EXT.test(one.name)) {
      // The audit gap: `import_markdown` has existed for months and a dropped
      // .md file has never reached it.
      add(S.FILE_MARKDOWN_IMPORT);
      add(S.FILE_ARTIFACT);
      preselected = S.FILE_MARKDOWN_IMPORT.id;
    } else if (one && TABLE_EXT.test(one.name)) {
      add(S.FILE_CSV_TABLE);
      add(S.FILE_ARTIFACT);
      preselected = S.FILE_CSV_TABLE.id;
    } else {
      add(S.FILE_ARTIFACT);
      if (one && OCR_EXT.test(one.name)) add(S.FILE_OCR_TEXT);
      preselected = S.FILE_ARTIFACT.id;
    }
  } else if (p.kind === "html" || p.kind === "text") {
    add(S.TEXT_DOC_PAGE);
    add(S.TEXT_CONTAINER_TREE);
    add(S.TEXT_TEXTBLOCK);
    add(S.TEXT_CHECKLIST);
    // Inside a doc body the page wrapper has nowhere to go — the words do.
    preselected = inDoc ? S.TEXT_TEXTBLOCK.id : S.TEXT_DOC_PAGE.id;
  }

  // Rule 1: never zero. An unrecognised payload still becomes what it becomes
  // today rather than opening a sheet with nothing in it.
  if (!shapes.length) {
    add(S.FILE_ARTIFACT);
    preselected = S.FILE_ARTIFACT.id;
  }
  if (!preselected || !shapes.some((s) => s.id === preselected)) {
    preselected = shapes[0].id;
  }

  return { payload: p, shapes, preselected };
}

/** Every id this module can emit — the router's coverage is asserted against it. */
export function allIntakeShapeIds() {
  return Object.values(INTAKE_SHAPES).map((s) => s.id);
}
