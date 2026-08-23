// utils/codexParse.js
//
// The two things about a codex file the generic markdown importer cannot know.
//
// 1. THE TAG LINE. All 75 files open with a line of bare hashtags —
//    `#reference #alchemy #daoism` — which is metadata, not prose. Left in the
//    body it becomes a textblock reading "#reference #alchemy #daoism" at the
//    top of every page.
//
// 2. WHICH BLOCKQUOTES ARE ANNOTATIONS. 460 blockquotes; 409 open with a
//    bracketed marker and are LLM commentary, 51 are ordinary quoted material
//    in the user's own notes. Marking all of them would label the user's
//    quotations as machine-written.
//
// Both are pure, so they are settled against the real corpus without writing
// anything.

/** A tag line is several `#word` tokens and NOTHING else on the line. */
const TAG_LINE_RE = /^\s*#[\w-]+(?:\s+#[\w-]+)*\s*$/;

/**
 * @returns {{ tags: string[], body: string }}
 *
 * ONLY THE FIRST non-empty line is considered. Annotations end with hashtags of
 * their own (measured on the corpus), and sweeping those in would attach words
 * an LLM chose to the user's note.
 *
 * `# GRID` is NOT a tag line — a hash followed by a space is a markdown
 * heading, and 72 of the files have one. The regex requires `#word` with no
 * space, which is what tells the two apart.
 */
export function splitTagLine(raw) {
  const text = String(raw ?? "");
  const lines = text.split("\n");
  const idx = lines.findIndex((l) => l.trim());
  if (idx === -1) return { tags: [], body: text };
  if (!TAG_LINE_RE.test(lines[idx])) return { tags: [], body: text };

  const tags = [...new Set(
    (lines[idx].match(/#[\w-]+/g) || []).map((t) => t.slice(1).toLowerCase())
  )];
  const body = lines.slice(idx + 1).join("\n");
  return { tags, body };
}

/** `**[annotation]** ...` -> `"annotation"`. An ordinary quote -> null. */
export const ANNOTATION_RE = /^\s*\*\*\[([^\]]{1,60})\]\*\*/;

export function annotationLabelOf(quoteText) {
  const m = ANNOTATION_RE.exec(String(quoteText ?? ""));
  return m ? m[1].trim() : null;
}
