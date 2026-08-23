// utils/codexPage.js
//
// A codex file becomes a PAGE, and `markdownToModuli` cannot make one.
//
// That importer's root is always `role:"container"` — CLAUDE.md 2026-08-08 (8)
// records it in as many words: "the importer has NEVER minted a page". So the
// wrapper is this file's job.
//
// ORDER IS LOAD-BEARING at the call site: the markdown is imported FIRST and
// the page is minted only once the import has returned a root id. Minting the
// page first leaves an empty page behind every time an import fails.
import path from "node:path";

const uid = () => Math.random().toString(36).slice(2, 12);

/**
 * The page wrapper for one already-imported file. Pure.
 *
 * @returns {{ pageModule, pageOcc }}
 */
export function planCodexPage({ gridId, userId, folderId, tagFieldId, relPath, rootOccurrenceId, tags = [] }) {
  const label = path.basename(relPath, ".md");
  const pageModule = {
    id: uid(), userId, gridId, role: "page", kind: "doc", label,
    fieldBindings: tagFieldId ? [{ fieldId: tagFieldId, role: "input" }] : [],
    meta: {},
  };

  const fields = {};
  // An EMPTY ARRAY is not the same as absent: in a multi-select it reads as
  // "tagged with nothing" and renders an empty chip row on the page header.
  if (tags.length && tagFieldId) fields[tagFieldId] = { value: tags, flow: "in" };

  const pageOcc = {
    id: uid(), userId, gridId, moduleId: pageModule.id,
    parentId: folderId,
    // EMBEDDED, not merely listed — a doc renders its textmap, and a child that
    // is listed and not embedded is present in the data and invisible on
    // screen. This repo has repaired that class from five directions.
    occurrences: [rootOccurrenceId],
    fields,
    // The signature is the RELATIVE path. Basenames repeat across folders with
    // DIFFERENT content (measured: Untitled 1/2/3/6/7/8.md), so a basename here
    // would make the second copy look already-imported and drop it silently.
    meta: { codexPath: relPath },
  };
  return { pageModule, pageOcc };
}
