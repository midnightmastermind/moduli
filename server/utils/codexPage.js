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
 * The page's name.
 *
 * NOT just `basename minus .md`. The corpus contains a file literally called
 * `.md` — a real note (a saved rewards number) whose filename has no stem — and
 * stripping the extension leaves an EMPTY STRING, which renders as a nameless
 * page: a blank row in the tree that cannot be told from the others.
 *
 * The fallbacks are ordered by how much they know about the note: its own first
 * H1 (that file's says `# Untitled (.md)`, which is what the annotator chose),
 * then the raw filename, then a constant. Each is better than a blank.
 */
export function codexTitle(relPath, body = "") {
  const stripped = path.basename(relPath, ".md");
  if (stripped && stripped !== ".md") return stripped;
  const h1 = /^#\s+(.+)$/m.exec(String(body || ""));
  if (h1) return h1[1].trim();
  const raw = path.basename(relPath);
  return raw || "Untitled";
}

/**
 * The page wrapper for one already-imported file. Pure.
 *
 * @returns {{ pageModule, pageOcc }}
 */
export function planCodexPage({ gridId, userId, folderId, tagFieldId, relPath, rootOccurrenceId, tags = [], body = "" }) {
  const label = codexTitle(relPath, body);
  const pageModule = {
    // `kind: "board"`, NOT "doc", and the difference is the whole page.
    //
    // `PageDoc` renders the occurrence's TEXTMAP through a TipTap editor and
    // never looks at `occurrences[]`. A doc page listing a child therefore
    // renders BLANK — the content is present in the data and invisible on
    // screen, which is the listed-but-not-embedded class this repo has repaired
    // five times. `PageBoard` renders the child containers, which is exactly
    // what this page holds: one imported root.
    //
    // `0199` reached the same answer for the Bookmarks page. I shipped "doc"
    // anyway and a browser probe caught it.
    id: uid(), userId, gridId, role: "page", kind: "board", label,
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
    // LISTED, which is how a BOARD page renders its children. (On a `doc` page
    // this same array is ignored and the textmap is what draws — see the kind
    // above.)
    occurrences: [rootOccurrenceId],
    fields,
    // The signature is the RELATIVE path. Basenames repeat across folders with
    // DIFFERENT content (measured: Untitled 1/2/3/6/7/8.md), so a basename here
    // would make the second copy look already-imported and drop it silently.
    meta: { codexPath: relPath },
  };
  return { pageModule, pageOcc };
}
