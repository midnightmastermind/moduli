// helpers/intakeApply.js
//
// Task 3 of docs/superpowers/plans/2026-08-06-intake-links-and-artifacts.md —
// THE ROUTER. `classifyIntake` names the shapes a payload could take; the sheet
// asks; this file is the only one that WRITES.
//
// It is a router over code that ALREADY EXISTS (`artifactUpload`, `import_text`,
// `createImportsDocPage`, `createChildInContainer`). The plan adds a decision
// layer, not a second implementation — that is the whole reason it is
// affordable.
//
// ── THE COVERAGE CONTRACT (why this file exports its own shape list) ─────────
//
// Task 1's second rule: "every shape id must map to a real branch — a shape
// offered and not implemented is worse than one not offered." A tile that does
// nothing when you pick it is a dead end where a drop used to work.
//
// So the router declares what it can actually do (`IMPLEMENTED_SHAPE_IDS`) and
// callers run the classification through `filterToImplemented` before opening
// the sheet. As Task 5 lands new shapes they light up by adding one route entry
// — and until then they are never offered. `assertShapeCoverage` is what the
// test asserts against, so a shape can never drift out of the router silently.
//
// Step 1 is deliberately BEHAVIOUR-PRESERVING: only the shapes that already had
// an implementation are wired, and each routes to the same helper the old
// hard-coded path called. Nothing changes yet — that is what proves the decision
// layer is transparent before any new shape rides on it.

import { INTAKE_SHAPES, allIntakeShapeIds } from "./intake";
import { createArtifactPlaceholders, uploadArtifactPlaceholders } from "./artifactUpload";
import { convertLinkToPage } from "./linkToPage";
import { withAction } from "./actionScope";
import { csvToMarkdownTable } from "./csvToTable";
import { linkChipShape } from "./linkOccurrence";
import { createTextblockInContainer, createContainerInContainer, createLeafInstanceInParent, spliceChildIntoParent, createPageInContainer, updateOccurrence } from "./CommitHelpers";
import { optionBoardStampFields } from "./boardOption";
import { attachFile } from "./mainFile";
import { splitToChecklistItems, MAX_CHECKLIST_ITEMS } from "./checklistFromText";
import { runOcr } from "./ocr";
import { toast } from "../state/notificationStore";
import * as CommitHelpers from "./CommitHelpers";

const S = INTAKE_SHAPES;

/**
 * shapeId → { run(ctx), note }.
 *
 * `run` receives the full intake context and performs the writes. It returns
 * whatever the underlying helper returns (usually nothing) — the router's job
 * is dispatch, not bookkeeping.
 */
export const INTAKE_ROUTES = {
  // ── Files ────────────────────────────────────────────────────────────────
  // All three are the SAME write today: one artifact per file at the
  // destination. They differ only in what Task 5 will make of them, so keeping
  // them as separate ids now means the sheet's wording is honest even while the
  // outcome is shared.
  [S.IMAGE_ARTIFACT.id]: { run: runArtifacts, note: "one artifact per file (today's behaviour)" },
  [S.FILE_ARTIFACT.id]: { run: runArtifacts, note: "one artifact per file (today's behaviour)" },
  [S.FILES_SIBLINGS.id]: { run: runArtifacts, note: "one artifact per file (today's behaviour)" },

  // ── Text / HTML ──────────────────────────────────────────────────────────
  // Two shapes, and until now they were the same write — see the block comment
  // above `runTextContainerTree` for the measurement that showed it.
  [S.TEXT_CONTAINER_TREE.id]: { run: runTextContainerTree, note: "the imported tree, in place (today's behaviour)" },
  [S.TEXT_DOC_PAGE.id]: { run: runTextDocPage, note: "the imported tree behind one page card" },

  // ── A dropped FILE whose contents we can read (Task 5) ───────────────────
  // The audit's finding: `import_markdown` has existed for months and a
  // dropped .md file has never reached it. Both of these are routes to code
  // that is already in production — the file just has to be read first.
  [S.FILE_MARKDOWN_IMPORT.id]: { run: runMarkdownFileImport, note: "read the .md and build the container/textblock tree" },
  [S.FILE_CSV_TABLE.id]: { run: runCsvFileImport, note: "read the .csv and build a table container" },

  // ── Links ────────────────────────────────────────────────────────────────
  // Today's outcome: a card whose label is the raw URL. The write itself
  // belongs to the caller (it mints an instance into a specific container at a
  // specific index), so the route carries the decision and the caller carries
  // the placement — same seam as `onPlaceholders`.
  [S.LINK_INSTANCE.id]: { run: (ctx) => ctx.onLegacyLink?.(), note: "a card labelled with the link (today's behaviour)" },
  // Newly possible: `import_url` fetches the page and builds the whole tree.
  // This is the same capability behind the right-click "Convert to page",
  // reached from a drop instead of a menu.
  [S.LINK_PAGE.id]: { run: runImportUrl, note: "fetch the link and build the page" },
  // Task 5: a real link chip — the shape the importer already builds for every
  // prose link, so one drop and one imported page produce the SAME thing.
  [S.LINK_CHIP.id]: { run: runLinkChip, note: "a clickable chip carrying the link" },
  // Several links at once: one container holding a chip each.
  [S.LINK_CONTAINER.id]: { run: runLinkContainer, note: "one container holding every link" },
  // A real, tagged option on an option board — the shape the plan calls the one
  // worth fighting for. Offered only when the destination IS an option board,
  // which `helpers/boardOption` derives from the board's own feed.
  [S.LINK_BOARD_OPTION.id]: { run: runLinkBoardOption, note: "a tagged option this board's dropdowns can see" },
  // Attach an image to the occurrence it was dropped ON, rather than adding a
  // sibling next to it. Offered only where there is a Files field to attach to.
  [S.IMAGE_ATTACH.id]: { run: runImageAttach, note: "append to this occurrence's Files, as its face if it has none" },
  // A photo of a handwritten list becomes a working checklist. The plan's other
  // headline; OCR already existed, only the split and the route were missing.
  [S.IMAGE_OCR_LIST.id]: { run: runImageOcrList, note: "OCR the photo, one item per line" },
  // The same OCR, kept as prose instead of split into items — and offered on
  // IMAGES, not PDFs, because tesseract cannot read a PDF (measured).
  [S.FILE_OCR_TEXT.id]: { run: runFileOcrText, note: "keep the picture and add its text as one textblock" },
  // The same split, for text that is already text.
  [S.TEXT_CHECKLIST.id]: { run: runTextChecklist, note: "one item per line" },
  // The words, verbatim, as ONE textblock. The classifier already preselects
  // this for a drop inside a doc body; until it had a route
  // `filterToImplemented` silently re-pointed that at TEXT_DOC_PAGE, so pasting
  // a paragraph into a doc offered to build a whole page.
  [S.TEXT_TEXTBLOCK.id]: { run: runTextTextblock, note: "one textblock holding the text verbatim" },
  // N files dropped at once become ONE container holding them — the file twin
  // of LINK_CONTAINER, and the difference from FILES_SIBLINGS is only where
  // they land.
  [S.FILES_CONTAINER.id]: { run: runFilesContainer, note: "one container holding every file" },
};

/** Ids the router can actually carry out right now. */
export const IMPLEMENTED_SHAPE_IDS = Object.keys(INTAKE_ROUTES);

/**
 * Every declared shape, split by whether the router implements it. The test
 * asserts against this so an unimplemented shape is a KNOWN gap rather than a
 * dead tile, and so a route for a shape id that no longer exists is caught.
 */
export function assertShapeCoverage() {
  const declared = new Set(allIntakeShapeIds());
  const routed = new Set(IMPLEMENTED_SHAPE_IDS);
  return {
    implemented: [...routed].filter((id) => declared.has(id)).sort(),
    notImplemented: [...declared].filter((id) => !routed.has(id)).sort(),
    // A route whose shape id is not declared anywhere — a typo, or a shape that
    // was renamed out from under the router.
    orphanRoutes: [...routed].filter((id) => !declared.has(id)).sort(),
  };
}

/**
 * Drop shapes the router cannot carry out, so the sheet never shows a dead tile.
 *
 * NEVER RETURNS ZERO SHAPES — the same rule the classifier holds. If nothing
 * survives the filter the payload still becomes what it becomes today (an
 * artifact), because a sheet with no options is worse than not asking.
 */
export function filterToImplemented(classification) {
  const shapes = (classification?.shapes || []).filter((s) => INTAKE_ROUTES[s.id]);
  if (!shapes.length) {
    const only = INTAKE_SHAPES.FILE_ARTIFACT;
    return { ...classification, shapes: [only], fallback: only.id };
  }
  // `fallback` is only ever used where there is no sheet host to ask — see the
  // contract note in helpers/intake.js. It still has to name a shape that
  // SURVIVED the filter, or the no-host path would run an unrouted shape and
  // write nothing.
  const fallback = shapes.some((s) => s.id === classification?.fallback)
    ? classification.fallback
    : shapes[0].id;
  return { ...classification, shapes, fallback };
}

/**
 * Carry out one shape.
 *
 * @param {string} shapeId
 * @param {object} ctx  everything the underlying helpers need:
 *   { payload, destination, files, gridId, userId, dispatch, socket,
 *     occurrencesById, containerOccurrenceId, occExtra, persist, onDone }
 * @returns {{ ok: boolean, shapeId: string, reason?: string }}
 */
export function applyIntakeShape(shapeId, ctx = {}) {
  const route = INTAKE_ROUTES[shapeId];
  if (!route) {
    // Loud, not silent: an unrouted shape reaching here means the sheet offered
    // something `filterToImplemented` should have removed. NOTE the scope is not
    // opened until after this guard — an unrouted shape writes nothing, so an
    // action with no writes in it would be an empty undo step.
    console.warn(`[intake] no route for shape "${shapeId}" — nothing was written`);
    return { ok: false, shapeId, reason: "no-route" };
  }
  // ── ONE ACTION SCOPE PER INTAKE (Task 3 Step 2) ──────────────────────────
  // An intake mints modules, occurrences, a parent-list update, and then an
  // upload. Unscoped, each is its own undo step and Ctrl+Z becomes useless —
  // the exact failure `helpers/actionScope.js` exists for. This is the one
  // chokepoint every intake write passes through, so it is the only place the
  // scope has to be opened.
  //
  // `withAction` closes it in a `finally`, which matters more than it looks: a
  // leaked scope silently swallows every LATER write into a stale action, so a
  // throw here would make undo revert far too much rather than too little.
  return withAction(`Intake: ${shapeId}`, () => {
    route.run(ctx);
    return { ok: true, shapeId };
  });
}

// ── Reporting ───────────────────────────────────────────────────────────────
//
// `onIntakeResult` IS STILL A SEAM, BUT IT NOW HAS A DEFAULT, and the reason is
// a defect this file already shipped: NO caller passed it, so the OCR shapes
// reported nothing at all — not a failure, not "read nothing", not success —
// behind a 3.5MB lazy import and seconds of work. Wiring three callers fixed
// that instance and left the class open: the fourth caller forgets and the
// silence is back.
//
// Worse, the three handlers came out BYTE-IDENTICAL, which is the tell that
// this is not caller-specific business at all. Placement is (a doc inserts an
// embed, a board splices — `onPlaceholders` genuinely differs); *reporting an
// outcome* is not. So the router owns it, and a caller may still override.

/** Announce that a slow route has started. Returns a token for `notifyIntake`. */
function startIntake(ctx, message) {
  // A caller that owns reporting owns the whole conversation, including this.
  if (ctx?.onIntakeResult) return null;
  return toast.loading(message, { duration: 120000 });
}

/**
 * Report a route's outcome exactly once.
 *
 * `res.note` carries what a split REFUSED (unreadable lines, the item cap) —
 * shapes return it deliberately, and dropping it hides the fact that part of
 * the input did not make it.
 */
function notifyIntake(ctx, res, token = null) {
  if (ctx?.onIntakeResult) { ctx.onIntakeResult(res); return; }
  const opts = token ? { id: token } : undefined;
  if (res?.ok) {
    const what = res.count
      ? `Read ${res.count} item${res.count === 1 ? "" : "s"}`
      : "Read the text";
    toast.success(res.note ? `${what} · ${res.note}` : what, opts);
  } else {
    toast.error(res?.error || "Could not read that", opts);
  }
}

// ── Routes ──────────────────────────────────────────────────────────────────

// Today's file path, unchanged: mint placeholders at the destination, then
// upload. Both halves come straight from `handleFileDrop`.
function runArtifacts(ctx) {
  const { files = [], gridId, userId, dispatch, socket,
    occExtra = null, persist = null, containerOccurrenceId = null,
    onPlaceholders = null, destinationOccurrence = null } = ctx;
  if (!files.length) return;
  const placeholders = createArtifactPlaceholders(files, {
    gridId, userId, dispatch, occExtra,
    // Step 3: what intake mints carries its destination's filter values, or a
    // file dropped on today's column is invisible to today's filter.
    parentOccurrence: destinationOccurrence,
  });
  // The caller wires the new ids into their destination BETWEEN mint and
  // upload — that placement is genuinely the drop handler's business (which
  // container's occurrences[], a canvas page, an artifact panel's active
  // view), and duplicating it here would give intake a second, drifting copy
  // of rules that already exist.
  onPlaceholders?.(placeholders);
  uploadArtifactPlaceholders(placeholders, {
    gridId, userId, dispatch, socket, containerOccurrenceId, persist,
  });
}

// ── IMAGE → ATTACH TO THIS OCCURRENCE ──────────────────────────────────────
//
// The same upload as any other image; what differs is WHERE the result is
// referenced. Instead of becoming a sibling row, the artifact is appended to
// the target occurrence's Files field — so a photo dropped on "Inception"
// belongs to Inception rather than sitting beside it.
//
// The Files write happens AFTER the upload resolves, because the artifact's
// occurrence id is the value being stored and a placeholder that never uploads
// would leave a reference to a row that does not exist — the dangling-reference
// class this repo keeps paying for.
//
// `attachFile` (not setMainFile) is what makes this safe to use repeatedly: the
// FIRST attachment becomes the face, and every one after it is added without
// stealing a face the user chose.
function runImageAttach(ctx) {
  const {
    files = [], gridId, userId, dispatch, socket,
    destinationOccurrence = null, destination = {},
    occExtra = null, persist = null, containerOccurrenceId = null,
    onPlaceholders = null,
  } = ctx;
  const filesFieldId = destination.filesFieldId || null;
  if (!files.length || !destinationOccurrence || !filesFieldId) {
    notifyIntake(ctx, { ok: false, error: "nothing here to attach it to" });
    return;
  }

  const placeholders = createArtifactPlaceholders(files, {
    gridId, userId, dispatch, occExtra, parentOccurrence: destinationOccurrence,
  });
  onPlaceholders?.(placeholders);

  uploadArtifactPlaceholders(placeholders, {
    gridId, userId, dispatch, socket, containerOccurrenceId, persist,
    onUploaded: (p) => {
      if (!p?.occurrenceId) return;
      // Re-read the field from the occurrence each time rather than batching:
      // several files attach in sequence and each must build on the previous
      // write, not on the value as it was when the drop started.
      const prev = destinationOccurrence.fields?.[filesFieldId];
      const next = attachFile(prev, p.occurrenceId);
      destinationOccurrence.fields = { ...(destinationOccurrence.fields || {}), [filesFieldId]: next };
      CommitHelpers.updateOccurrence({
        dispatch, socket, emit: true,
        occurrence: { id: destinationOccurrence.id, fields: destinationOccurrence.fields },
      });
    },
  });
  notifyIntake(ctx, { ok: true, count: placeholders.length });
}

// ── TEXT / PHOTO → CHECKLIST ───────────────────────────────────────────────
//
// One instance per line. The split lives in `helpers/checklistFromText` and is
// a series of refusals (bullets, checkbox glyphs, stray marks, single stray
// characters, a cap) — because minting a row per RAW line off a photo produces a
// checklist the user has to clean by hand, which is worse than the single
// textblock they got before.
//
// `skipped` and `truncated` are REPORTED, never swallowed: a silent drop of half
// a shopping list is how someone stops trusting the feature.
function mintChecklist(items, ctx) {
  const { destinationOccurrence, gridId, userId, dispatch, socket } = ctx;
  const minted = [];
  for (const item of items) {
    const res = createLeafInstanceInParent({
      dispatch, socket, gridId, userId,
      parentOccurrence: destinationOccurrence,
      label: item.label,
    });
    if (res) minted.push(res);
  }
  return minted;
}

function reportChecklist(res, minted, ctx, token = null) {
  const notes = [];
  if (res.skipped) notes.push(`${res.skipped} unreadable line${res.skipped === 1 ? "" : "s"} skipped`);
  if (res.truncated) notes.push(`stopped at ${MAX_CHECKLIST_ITEMS}`);
  notifyIntake(ctx, { ok: true, count: minted.length, note: notes.join(" · ") || undefined }, token);
}

function runTextChecklist(ctx) {
  const { payload = {}, destinationOccurrence = null } = ctx;
  const text = payload.text || "";
  if (!text || !destinationOccurrence) {
    notifyIntake(ctx, { ok: false, error: "nothing to make a list from" });
    return;
  }
  const res = splitToChecklistItems(text);
  if (!res.items.length) {
    notifyIntake(ctx, { ok: false, error: "no readable lines in that text" });
    return;
  }
  reportChecklist(res, mintChecklist(res.items, ctx), ctx);
}

// The photo arm. OCR is SLOW (seconds, and it lazy-loads a 3.5MB worker), so
// this is the one route that must report progress and cannot be fire-and-forget.
// The image is uploaded as an artifact FIRST and kept — the photo is evidence,
// and throwing it away after reading it would be the destructive shortcut.
function runImageOcrList(ctx) {
  const {
    files = [], gridId, userId, dispatch, socket,
    destinationOccurrence = null, occExtra = null, persist = null,
    containerOccurrenceId = null, onPlaceholders = null,
  } = ctx;
  const file = files[0];
  if (!file || !destinationOccurrence) {
    notifyIntake(ctx, { ok: false, error: "nothing to read" });
    return;
  }

  const placeholders = createArtifactPlaceholders([file], {
    gridId, userId, dispatch, occExtra, parentOccurrence: destinationOccurrence,
  });
  onPlaceholders?.(placeholders);
  uploadArtifactPlaceholders(placeholders, {
    gridId, userId, dispatch, socket, containerOccurrenceId, persist,
  });

  // Read from the local file rather than waiting for the upload: the bytes are
  // already in hand, and coupling OCR to a network round trip would make a slow
  // thing slower and fail for two unrelated reasons.
  const token = startIntake(ctx, "Reading the image…");
  const url = URL.createObjectURL(file);
  runOcr(url)
    .then((text) => {
      const res = splitToChecklistItems(text);
      if (!res.items.length) {
        notifyIntake(ctx, { ok: false, error: "could not read any lines from that image" }, token);
        return;
      }
      reportChecklist(res, mintChecklist(res.items, ctx), ctx, token);
    })
    .catch((err) => {
      notifyIntake(ctx, { ok: false, error: `OCR failed: ${err?.message || "unknown"}` }, token);
    })
    .finally(() => URL.revokeObjectURL(url));
}

// The other half of the photo arm: keep the picture AND its words, as prose.
//
// SAME OCR, DIFFERENT OUTCOME — and which one you want is a fact about the
// photo, not about the file. A photo of a LIST wants one item per line
// (`IMAGE_OCR_LIST`); a photo of a PAGE — a receipt, a whiteboard, a letter —
// wants the text kept whole, because splitting a paragraph on its newlines is
// how you turn one sentence into six checklist items. The sheet asks rather
// than guessing, which is the entire point of the intake layer.
//
// THIS SHAPE USED TO BE OFFERED ONLY FOR `.pdf`, AND THAT COULD NEVER HAVE
// WORKED: `runOcr` is tesseract.js, and tesseract cannot read a PDF — it fails
// with "Error attempting to read image." Measured directly against a real
// one-page PDF before this route was written, which is why the classifier now
// offers it on IMAGES instead. See `helpers/intake.js` for the gate.
function runFileOcrText(ctx) {
  const {
    files = [], gridId, userId, dispatch, socket,
    destinationOccurrence = null, occExtra = null, persist = null,
    containerOccurrenceId = null, onPlaceholders = null,
  } = ctx;
  const file = files[0];
  if (!file || !destinationOccurrence) {
    notifyIntake(ctx, { ok: false, error: "nothing to read" });
    return;
  }

  // The picture is kept, exactly as the checklist arm keeps it: the photo is
  // the evidence, and discarding it once the text is out is the destructive
  // shortcut. The artifact goes in FIRST so the row exists while OCR runs.
  const placeholders = createArtifactPlaceholders([file], {
    gridId, userId, dispatch, occExtra, parentOccurrence: destinationOccurrence,
  });
  onPlaceholders?.(placeholders);
  uploadArtifactPlaceholders(placeholders, {
    gridId, userId, dispatch, socket, containerOccurrenceId, persist,
  });

  // Read the LOCAL bytes rather than waiting on the upload — they are already
  // in hand, and coupling OCR to a network round trip makes a slow thing slower
  // and gives it a second, unrelated way to fail.
  const token = startIntake(ctx, "Reading the image…");
  const url = URL.createObjectURL(file);
  return runOcr(url)
    .then((text) => {
      if (!String(text || "").trim()) {
        // The artifact still landed — say what did and did not happen rather
        // than reporting a blanket failure over a successful upload.
        notifyIntake(ctx, { ok: false, error: "could not read any text from that image — the file was still added" }, token);
        return;
      }
      const res = mintTextblockFromText(text, ctx);
      if (!res) { notifyIntake(ctx, { ok: false, error: "could not create the textblock" }, token); return; }
      notifyIntake(ctx, { ok: true, textblockOccurrenceId: res.occurrenceId, chars: text.length }, token);
    })
    .catch((err) => {
      notifyIntake(ctx, { ok: false, error: `OCR failed: ${err?.message || "unknown"}` }, token);
    })
    .finally(() => URL.revokeObjectURL(url));
}

// Fetch what the link points at and build the page from it. The URL is NOT
// validated here — the SERVER holds the guard (utils/safeFetchUrl.js), because
// the server is the thing with network reach and a client-side check would be
// advisory at best.
function runImportUrl(ctx) {
  const { payload = {}, destination = {}, gridId, socket, onImportResult = null } = ctx;
  const url = payload.urls?.[0];
  if (!socket || !url) return;
  convertLinkToPage({ socket, gridId, url, parentId: destination.parentId ?? null })
    .then((res) => onImportResult?.(res));
}

// The audit's headline finding, answered: a dropped link became a card labelled
// with the raw URL. It becomes a real chip now — clickable, and carrying
// `meta.link` so Task 6's relink can find it and so it is indistinguishable
// from the chips an imported page is already made of.
//
// The write goes through `createTextblockInContainer` rather than minting here,
// which is what gets the chip the destination's filter values (a link dropped
// on today's column must carry today's date or the filter cannot see it).
function runLinkChip(ctx) {
  const {
    payload = {}, destinationOccurrence = null, gridId, userId, dispatch, socket,
    insertIndex = null, inline = false, onLinkChips = null,
  } = ctx;
  const urls = payload.urls || [];
  if (!urls.length || !destinationOccurrence) return;

  // Several links dropped at once become several chips — the classifier already
  // treats a block of URLs as ONE link payload, so the router must not assume
  // there is exactly one.
  const minted = [];
  for (const url of urls) {
    const shape = linkChipShape({ url, inline });
    const res = createTextblockInContainer({
      dispatch, socket, gridId, userId,
      containerOccurrence: destinationOccurrence,
      index: insertIndex,
      kind: shape.kind, label: shape.label, meta: shape.meta, textmap: shape.textmap,
    });
    if (res) minted.push(res);
  }
  // Same seam as `onPlaceholders`: the doc arm embeds what was minted at the
  // drop position, because a doc renders its textmap and would otherwise show
  // nothing.
  onLinkChips?.(minted);
}

// ── LINK → BOARD OPTION ────────────────────────────────────────────────────
//
// The grid has 34 option boards whose whole purpose is to be the pool behind a
// dropdown. Landing an untagged card on one produces something that LOOKS right
// and is invisible to every dropdown — so this mints a real OPTION: an instance
// carrying the board's own identity tag, which is exactly what a seeded option
// carries.
//
// The tag comes from `optionBoardStampFields`, which reads the BOARD's feed and
// the board's own value for it. Nothing here knows the word "boardCategory", or
// "movie", or which field is the tag — the same no-domain-knowledge line the
// renderer holds, and the reason this works on all 34 boards without a list.
//
// The link is kept on the option's `meta.link` so the source is still reachable,
// and so a later "Convert to page" on it can relink the way any other chip does.
function runLinkBoardOption(ctx) {
  const {
    payload = {}, destinationOccurrence = null, gridId, userId, dispatch, socket,
  } = ctx;
  const urls = payload.urls || [];
  const stamp = optionBoardStampFields(destinationOccurrence);
  if (!urls.length || !destinationOccurrence || !stamp) {
    // Reported, not swallowed: the shape promised something specific, and a
    // silent no-op here is indistinguishable from "the drop did nothing".
    notifyIntake(ctx, { ok: false, error: "this board does not define what its options are" });
    return;
  }

  const minted = [];
  for (const url of urls) {
    const shape = linkChipShape({ url, inline: false });
    const res = createLeafInstanceInParent({
      dispatch, socket, gridId, userId,
      parentOccurrence: destinationOccurrence,
      label: shape.label,
      initialFields: stamp,
      // The identity tag binds HIDDEN — it is what makes the option findable,
      // never something to read on the card. Same treatment addNewOption gives it.
      fieldBindings: Object.keys(stamp).map((fid, i) => ({ fieldId: fid, role: "input", order: i, hidden: true })),
    });
    if (res) minted.push(res);
  }
  notifyIntake(ctx, { ok: true, count: minted.length });
}

// Several links dropped together become ONE container of chips rather than N
// loose rows — the classifier already pre-selects this for a multi-link payload,
// which until now `filterToImplemented` re-pointed at the plain chip.
//
// It is a COMPOSITION of two things that already exist: mint the container, then
// run the chip route into it. No second link representation, no second mint path
// — and `createContainerInContainer` flips the parent's `allowChildContainers`,
// without which the renderer shows nothing (the 2026-07-31 "you got rid of my
// trackers" failure: data present, flag missing, nothing on screen).
// The dropped text as ONE textblock, unedited.
//
// "Verbatim" is the whole promise of this shape, so the only transformation is
// the one that would otherwise LOSE information: a blank line separates
// paragraphs in every text format a human pastes, and collapsing them into one
// paragraph is lossy. Single newlines are left inside their paragraph rather
// than becoming paragraphs of their own — a wrapped line is not a new one.
export function textToParagraphs(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\n+$/g, ""))
    .filter((p) => p.trim() !== "");
}

// A label so the block is findable in the tree and by occurrence search — the
// body is the content, but an unlabelled row reads as empty everywhere else.
function firstLineLabel(text, max = 60) {
  const line = String(text || "").trim().split("\n")[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Text → ONE textblock at the destination. Shared by the paste/drop arm and the
 * OCR arm so there is a single textblock mint; the two differ only in where the
 * text came from, which is not a reason for two implementations.
 *
 * Goes through `createTextblockInContainer` rather than minting here — that is
 * what stamps the destination's filter values, so a block dropped on today's
 * column carries today's date and the filter can see it.
 */
function mintTextblockFromText(text, ctx, { index } = {}) {
  const {
    destinationOccurrence = null, gridId, userId, dispatch, socket,
    insertIndex = null, onLinkChips = null,
  } = ctx;
  const paragraphs = textToParagraphs(text);
  if (!paragraphs.length || !destinationOccurrence) return null;

  const res = createTextblockInContainer({
    dispatch, socket, gridId, userId,
    containerOccurrence: destinationOccurrence,
    index: index !== undefined ? index : insertIndex,
    // "doc" is the app's non-inline textblock kind. `"block"` is a value this
    // app uses NOWHERE and would render fine right up until something read it.
    kind: "doc",
    label: firstLineLabel(text),
    textmap: {
      type: "doc",
      content: paragraphs.map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] })),
    },
  });
  // Same seam the chip route uses: a doc renders its TEXTMAP, so the doc arm
  // has to embed what was minted or the block is present in the data and
  // invisible on screen.
  if (res) onLinkChips?.([res]);
  return res;
}

function runTextTextblock(ctx) {
  const { payload = {} } = ctx;
  mintTextblockFromText(payload.text ?? payload.html ?? "", ctx);
}

// Every dropped file into ONE new container.
//
// The only structural difference from `runArtifacts` is the parent, and that is
// exactly why it does NOT call the caller's `onPlaceholders`: that seam wires
// the new ids into the DESTINATION, which for this shape would scatter the
// files beside the container instead of inside it. The splice is done here,
// against the container this route just minted.
function runFilesContainer(ctx) {
  const {
    files = [], destinationOccurrence = null, gridId, userId, dispatch, socket,
    insertIndex = null, occExtra = null, persist = null,
  } = ctx;
  if (!files.length || !destinationOccurrence) return;

  const made = createContainerInContainer({
    dispatch, socket, gridId, userId,
    containerOccurrence: destinationOccurrence,
    kind: "board",
    label: `${files.length} file${files.length === 1 ? "" : "s"}`,
    index: insertIndex,
  });
  // No home means nowhere to put them. Uploading anyway would land the files
  // loose at the destination — which is the OTHER shape, not this one.
  if (!made?.occurrenceId) return;

  // A shim rather than the real occurrence (the mint helper hands back ids
  // only). It carries the container's own id so the artifacts are stamped with
  // ITS filter values, and an empty `occurrences` so the splice below starts
  // from a known list.
  const container = { id: made.occurrenceId, gridId, userId, occurrences: [] };

  const placeholders = createArtifactPlaceholders(files, {
    gridId, userId, dispatch, occExtra, parentOccurrence: container,
  });
  let i = 0;
  for (const p of placeholders) {
    spliceChildIntoParent({
      dispatch, socket,
      // Accumulated, not re-read: each splice writes the whole array, so a
      // stale snapshot per file would clobber the previous one and only the
      // last file would remain. The same accumulation `feedSync` needs.
      parentOccurrence: { ...container, occurrences: placeholders.slice(0, i).map((x) => x.occurrenceId) },
      occurrenceId: p.occurrenceId,
    });
    i += 1;
  }
  uploadArtifactPlaceholders(placeholders, {
    gridId, userId, dispatch, socket, containerOccurrenceId: made.occurrenceId, persist,
  });
}

function runLinkContainer(ctx) {
  const {
    payload = {}, destinationOccurrence = null, gridId, userId, dispatch, socket,
    insertIndex = null,
  } = ctx;
  const urls = payload.urls || [];
  if (!urls.length || !destinationOccurrence) return;

  const made = createContainerInContainer({
    dispatch, socket, gridId, userId,
    containerOccurrence: destinationOccurrence,
    kind: "board",
    label: `${urls.length} links`,
    index: insertIndex,
  });
  if (!made?.occurrenceId) return;

  // The chips go in the NEW container. It is a shim rather than the real
  // occurrence because the mint helper does not hand one back — and that is
  // fine here: the container already carries the destination's filter values,
  // so its children resolve through the cascade rather than being pre-stamped
  // (the standing "trust the filter cascade" rule).
  runLinkChip({
    ...ctx,
    insertIndex: null,
    destinationOccurrence: { id: made.occurrenceId, gridId, userId, occurrences: [] },
  });
}

// ── FILE-CONTENT ROUTES ─────────────────────────────────────────────────────
//
// These two are the only routes that have to READ the dropped file before they
// can decide anything, which makes them the only asynchronous ones. Three
// consequences worth stating rather than discovering:
//
// 1. **They do not go through `onImportText`.** That caller-owned seam carries
//    the TEXT arm's already-resolved content; a file's content does not exist
//    yet when the sheet is answered. These own their own emit.
// 2. **The action scope does not span them, and does not need to.** The entire
//    write is one `import_text` emit — a raw `socket.emit`, not a `safeEmit` —
//    so it carries no `__actionId` either way, exactly like `runImportText`
//    above. The server mints the tree and broadcasts it; there is no client
//    write to group.
// 3. **Every failure reports through `onImportResult`.** A file that cannot be
//    read, is empty, or cannot legally become a table must say so — the shape
//    promised something specific, and silence would leave the user believing a
//    drop had landed.

/** `File.text()` where it exists, `FileReader` where it does not. */
function readFileText(file) {
  if (!file) return Promise.reject(new Error("no file"));
  if (typeof file.text === "function") return Promise.resolve(file.text());
  return new Promise((resolve, reject) => {
    if (typeof FileReader === "undefined") { reject(new Error("cannot read file")); return; }
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ""));
    fr.onerror = () => reject(fr.error || new Error("read failed"));
    fr.readAsText(file);
  });
}

/**
 * Send content to the server importer and correlate its ack.
 *
 * `title` names the ROOT container, which is what makes a dropped file arrive
 * under its own filename rather than under whatever its first heading — or, for
 * a CSV, its first COLUMN — happens to be called.
 */
function emitImportText(ctx, { content, format, title, parentId }) {
  const { gridId, socket, destination = {}, destinationOccurrence = null, onImportResult = null } = ctx;
  if (!socket?.emit) return;
  const requestId = `intake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  if (onImportResult) {
    const onResult = (res) => {
      if (res?.requestId && res.requestId !== requestId) return;
      socket.off?.("import_text_result", onResult);
      onImportResult(res);
    };
    socket.on?.("import_text_result", onResult);
  }
  socket.emit("import_text", {
    requestId,
    gridId,
    // A file drop resolves its destination as an OCCURRENCE (the container it
    // landed in); the text arm resolves a `destination.parentId`. Accept both
    // so one emit serves every caller. An EXPLICIT `parentId` overrides both —
    // `null` is a real answer there (the doc-page shape imports DETACHED and
    // re-homes the root under the page it then mints), so the check is
    // `undefined`, not falsiness.
    parentId: parentId !== undefined
      ? parentId
      : (destination.parentId ?? destinationOccurrence?.id ?? null),
    content,
    format,
    title,
  });
}

/** Shared shell: read the one file, convert it, emit — reporting every failure. */
function runFileImport(ctx, { convert, format }) {
  const { files = [], onImportResult = null } = ctx;
  const file = files[0];
  const fail = (error) => onImportResult?.({ ok: false, error });
  if (!file) { fail("no file to read"); return; }

  return readFileText(file)
    .then((text) => {
      const out = convert(text, file);
      if (!out.ok) { fail(out.error); return; }
      emitImportText(ctx, { content: out.content, format, title: out.title });
    })
    .catch((err) => fail(`could not read ${file.name || "the file"}: ${err?.message || err}`));
}

// `.md` → the container/textblock tree. The importer's markdown path is
// unchanged; this only closes the gap between a dropped file and it.
function runMarkdownFileImport(ctx) {
  return runFileImport(ctx, {
    format: "markdown",
    convert: (text, file) => {
      if (!String(text || "").trim()) return { ok: false, error: `${file.name || "the file"} is empty` };
      return { ok: true, content: text, title: baseName(file.name) };
    },
  });
}

// `.csv` / `.tsv` → a real table container, via the markdown pipe table the
// importer already knows how to build (see helpers/csvToTable.js for why).
function runCsvFileImport(ctx) {
  return runFileImport(ctx, {
    format: "markdown",
    convert: (text, file) => {
      const res = csvToMarkdownTable(text, file.name || "");
      if (res.ok) return { ok: true, content: res.markdown, title: baseName(file.name) };
      // Named, not generic: "it didn't work" leaves the user with no next move,
      // and both of these have one (drop it as a File instead).
      if (res.reason === "empty") return { ok: false, error: `${file.name || "the file"} has no rows` };
      return {
        ok: false,
        error: `${file.name || "That file"} has only ${res.columns || 1} column — a table needs at least 2. Drop it again and choose “File”.`,
      };
    },
  });
}

/** "Weekly plan.csv" → "Weekly plan" — the root container's name. */
function baseName(name) {
  return String(name || "").replace(/\.[^./\\]+$/, "").trim() || "Imported";
}

// Today's text/HTML path: hand the content to the server importer, which builds
// the container/textblock tree and broadcasts it back.
//
// When the caller supplies `onImportText` it owns the write — the drop handler
// already resolves a destination TITLE, wraps a homeless import in an Imports
// doc page, and reports per-entity stats in its toast. None of that is intake's
// business, and a second copy here would drift. Same seam as `onPlaceholders`
// and `onLegacyLink`.
// ── THE TWO TEXT-TREE SHAPES, AND WHY THEY WERE THE SAME THING ──────────────
//
// MEASURED BEFORE ANYTHING WAS WRITTEN, because the two shapes' own hints
// promised a difference the code did not have. `markdownToModuli` always
// returns a `role:"container" kind:"doc"` ROOT (`buildContainer(tree, …, true)`)
// — it has never minted a page. The ONLY page wrapper in the whole text path is
// `createImportsDocPage`, which the drop handler calls for a HOMELESS import
// (an empty-cell drop) so the root is reachable at all. So:
//
//   destination is a container/page  →  the tree lands in place, NO page
//   no destination (empty cell)      →  panel + Imports doc page, wrapper
//
// i.e. `text-doc-page` was `text-container-tree` in two of three destinations,
// and its "wrapped in a page" hint was true only for the third. Shipping the
// second tile as a copy of the first would have been a dead tile with a
// different label on it.
//
// So the pair is made honest from BOTH ends:
//   TEXT_CONTAINER_TREE  the tree in place — today's outcome, byte-identical,
//                        and now the PRESELECTED default so Enter still does
//                        exactly what it did.
//   TEXT_DOC_PAGE        the tree behind ONE page card you drill into. A page
//                        nested in a container renders as a representation chip
//                        (the layout cascade forces it), which is the whole
//                        point: 40 imported sections stop spilling across the
//                        board.
//
// The homeless case is untouched — `onImportText` still owns it, because the
// drop handler is the only layer that knows it just minted a panel to pin to.

/**
 * The imported tree, in place at the destination.
 *
 * Deliberately does NOT go through `onImportText`: that seam carries the
 * caller's WHOLE text behaviour including the homeless wrap, so routing this
 * through it would make the two text shapes indistinguishable again — the
 * thing this pair exists to fix.
 */
function runTextContainerTree(ctx) {
  const { payload = {}, destination = {}, destinationOccurrence = null, onImportResult = null } = ctx;
  const content = payload.html || payload.text || "";
  if (!content.trim()) return;
  const parentId = destination.parentId ?? destinationOccurrence?.id ?? null;
  // Fails CLOSED and says so. A container root with no parent is listed by
  // nobody and embedded in nothing — the "mints something invisible" class.
  // The classifier gates this shape out when there is no destination, so
  // reaching here means a caller passed a context the sheet was not offered on.
  if (!parentId) { onImportResult?.({ ok: false, error: "nowhere to put the imported tree" }); return; }
  emitImportText(ctx, { content, format: payload.html ? "html" : "text", parentId });
}

/**
 * The imported tree, wrapped in a doc page at the destination.
 *
 * HOMELESS STAYS THE CALLER'S: when there is no destination occurrence the
 * drop handler's `onImportText` runs unchanged — it mints the panel, imports
 * detached and wraps the root in an Imports doc page pinned to that panel.
 * None of that is intake's business and a second copy here would drift (the
 * same seam rule `onPlaceholders` and `onLegacyLink` follow).
 *
 * With a destination it owns the write, in this order and for this reason:
 * the import runs DETACHED (`parentId: null`) and the page is minted only
 * after the ack, so the page can be created in one shot already embedding a
 * root id that exists. Minting the page first would leave an empty page behind
 * whenever an import fails.
 */
function runTextDocPage(ctx) {
  const {
    payload = {}, destination = {}, destinationOccurrence = null, destinationModule = null,
    gridId, userId, dispatch, socket, insertIndex = null,
    onImportResult = null, onImportText = null,
  } = ctx;
  const content = payload.html || payload.text || "";
  if (!content.trim()) return;

  const canWrap = !!(destinationOccurrence && dispatch && gridId && userId);
  if (!canWrap) {
    if (onImportText) { onImportText(); return; }
    // No caller seam and nothing to wrap into. Say so rather than emitting an
    // import whose root nothing would reference.
    onImportResult?.({ ok: false, error: "nowhere to put the page" });
    return;
  }
  if (!socket?.emit) return;

  const label = destination.title || firstLineLabel(payload.text ?? "") || "Imported";

  emitImportText(
    { ...ctx, onImportResult: (res) => {
      if (!res?.ok || !res.rootOccurrenceId) { onImportResult?.(res || { ok: false, error: "import failed" }); return; }
      // `createPageInContainer` is the shipped mint (2026-07-29): it splices the
      // page into the destination, stamps the `dragInView: "representation"`
      // override, and flips the parent's `allowChildContainers` so a non-leaf
      // child renders at all. Reused rather than re-implemented — and
      // `containerModule` is passed because that flip writes the module's whole
      // `meta`, so omitting it would clobber every other key on it.
      const made = createPageInContainer({
        dispatch, socket, gridId, userId,
        containerOccurrence: destinationOccurrence,
        containerModule: destinationModule,
        kind: "doc",
        label,
        index: insertIndex,
      });
      if (!made?.occurrenceId) { onImportResult?.({ ok: false, error: "could not create the page" }); return; }
      // A doc page renders its TEXTMAP. Listing the root in `occurrences[]` and
      // stopping there is the listed-but-not-embedded failure this repo has
      // repaired twice — so both are written, in one patch.
      updateOccurrence({
        dispatch, socket,
        occurrence: {
          id: made.occurrenceId,
          occurrences: [res.rootOccurrenceId],
          textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: res.rootOccurrenceId } }] },
        },
        emit: true,
      });
      onImportResult?.({ ...res, pageOccurrenceId: made.occurrenceId });
    } },
    { content, format: payload.html ? "html" : "text", parentId: null },
  );
}
