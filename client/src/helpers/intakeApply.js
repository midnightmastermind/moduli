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
    // something `filterToImplemented` should have removed.
    console.warn(`[intake] no route for shape "${shapeId}" — nothing was written`);
    return { ok: false, shapeId, reason: "no-route" };
  }
  route.run(ctx);
  return { ok: true, shapeId };
}

// ── Routes ──────────────────────────────────────────────────────────────────

// Today's file path, unchanged: mint placeholders at the destination, then
// upload. Both halves come straight from `handleFileDrop`.
function runArtifacts(ctx) {
  const { files = [], gridId, userId, dispatch, socket,
    occExtra = null, persist = null, containerOccurrenceId = null,
    onPlaceholders = null } = ctx;
  if (!files.length) return;
  const placeholders = createArtifactPlaceholders(files, { gridId, userId, dispatch, occExtra });
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

// Today's text/HTML path: hand the content to the server importer, which builds
// the container/textblock tree and broadcasts it back.
function runImportText(ctx) {
  const { payload = {}, gridId, socket, destination = {}, onImportResult = null } = ctx;
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
