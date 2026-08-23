// utils/codexCorpus.js
//
// Where the codex is, and what counts as part of it.
//
// The corpus lives OUTSIDE the repo — it is the user's own notebook, not
// checked in — so the path is overridable and every consumer must cope with it
// being absent (the tests skip rather than fail on a machine without it).
import fs from "node:fs";
import path from "node:path";

export const CODEX_ROOT =
  process.env.CODEX_ROOT || "/home/joshpoms/notebook/notes_codex_annotated";

/**
 * Every markdown file in the corpus, sorted by relative path.
 *
 * THE KEY IS `relPath`, NOT THE BASENAME. Measured on the real corpus:
 * `Untitled 1.md` exists at the root and in `untitled_notes/`, with different
 * content, and the same is true of 2, 3, 6, 7 and 8. Keying on the basename
 * would make the second one look already-imported and drop it silently.
 *
 * `profileoverview.txt` is excluded: the importer's parser is a MARKDOWN
 * parser, and a .txt file would come through as one undifferentiated prose
 * blob. Bringing it in is a separate decision, not a side effect of this one.
 */
// CODE-UNIT ORDER, not `localeCompare`. A test caught this: collation depends on
// the ICU build, so `localeCompare` can order the same corpus differently on two
// machines — and the whole point of sorting here is that a resumed run walks the
// SAME sequence as the run it is resuming.
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function listCodexFiles(root = CODEX_ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort(byName)) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".md")) {
        const relPath = path.relative(root, abs);
        const dirName = path.dirname(relPath);
        out.push({ absPath: abs, relPath, folder: dirName === "." ? "" : dirName, basename: e.name });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0));
}
