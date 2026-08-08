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
import { createTextblockInContainer, createContainerInContainer, createLeafInstanceInParent } from "./CommitHelpers";
import { optionBoardStampFields } from "./boardOption";

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
  [S.TEXT_DOC_PAGE.id]: { run: runImportText, note: "import_text → a doc page (today's behaviour)" },

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
    const fallback = INTAKE_SHAPES.FILE_ARTIFACT;
    return { ...classification, shapes: [fallback], preselected: fallback.id };
  }
  const preselected = shapes.some((s) => s.id === classification?.preselected)
    ? classification.preselected
    : shapes[0].id;
  return { ...classification, shapes, preselected };
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
    onIntakeResult = null,
  } = ctx;
  const urls = payload.urls || [];
  const stamp = optionBoardStampFields(destinationOccurrence);
  if (!urls.length || !destinationOccurrence || !stamp) {
    // Reported, not swallowed: the shape promised something specific, and a
    // silent no-op here is indistinguishable from "the drop did nothing".
    onIntakeResult?.({ ok: false, error: "this board does not define what its options are" });
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
  onIntakeResult?.({ ok: true, count: minted.length });
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
function emitImportText(ctx, { content, format, title }) {
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
    // so one emit serves every caller.
    parentId: destination.parentId ?? destinationOccurrence?.id ?? null,
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
function runImportText(ctx) {
  const { payload = {}, gridId, socket, destination = {}, onImportResult = null, onImportText = null } = ctx;
  if (onImportText) { onImportText(); return; }
  if (!socket) return;
  const content = payload.html || payload.text || "";
  if (!content.trim()) return;
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
    parentId: destination.parentId ?? null,
    content,
    format: payload.html ? "html" : "text",
  });
}
