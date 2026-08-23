# Codex Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 75 annotated markdown files in `/home/joshpoms/notebook/notes_codex_annotated` into 75 pages under a `Codex` folder that mirrors the source directory tree, with each note's prose as textblocks, its headings as containers, its LLM annotations as distinguishable quote blocks, and its `#hashtag` line as field values.

**Architecture:** A migration drives the EXISTING importer rather than a second one. `server/services/markdownImporter.markdownToModuli` already turns markdown into a module/occurrence tree with a `dryRun` mode; what it does not do is mint a PAGE (its root is always a `role:"container"`), separate an ANNOTATION from an ordinary quote, or read a tag line. Those three gaps are the work, and each is a small pure module tested on its own before the migration composes them.

**Tech Stack:** Node ESM, Mongoose, vitest. No new dependencies.

**Spec:** This document. The design decisions it rests on were taken by the user on 2026-08-23 and are recorded under "Decisions" below.

---

## Global Constraints

- **`poms grid` is live, protected data.** Every write goes through `server/migrations/` and `npm run migrate:poms`. Rehearse on `test grid 2` first (`--grid "test grid 2"`).
- **Dry-run before apply, and check the dry run against a NAMED expectation**, not just a count. The numbers to expect are in Task 0 below.
- **Idempotent and resumable.** A re-run must create nothing. The signature is the file's path RELATIVE to the corpus root — never its basename (measured: `Untitled 1.md` exists at the root AND in `untitled_notes/` with DIFFERENT content, and the same holds for 2, 3, 6, 7, 8).
- **`noDomainKnowledge.test.js` must keep passing.** Nothing in `client/` may learn the word "codex". This is data plus a migration; the renderer stays generic.
- **Do not deploy or apply while the user may be loading the grid** (CLAUDE.md 2026-08-20). A pm2 restart truncates an in-flight burst.
- **The corpus is READ-ONLY.** The migration never writes to `/home/joshpoms/notebook/`.

## Decisions (user, 2026-08-23)

1. **Mirror the folders, one page per file.** A `Codex` folder holding 8 subfolders and 75 pages.
2. **Annotations stay inline and stay distinguishable** — marked so a later pass can style, collapse or filter them without re-parsing prose.
3. **A new `Codex Tags` field.** The existing `Tags` field is MIXED — 45 live values that also drive board categories (`image`, `grocery`, `person`) — and adding 135 codex tags would swell every board-category picker (CLAUDE.md 2026-08-20 (5)).

**REFINEMENT ON (2), stated rather than silently substituted.** The user chose "marked textblocks". The importer already turns a blockquote into a `role:"artifact" kind:"quote"` block, which renders as a styled pull-quote — i.e. it ALREADY delivers the chosen intent (inline, visually distinct) and does it better than a marked textblock would. So annotations land as quote blocks carrying `meta.codexAnnotation`, and the marker is what makes them filterable. If the styled quote reads badly at 46-per-page (`voice_notes/lyrics.md`), the marker is what lets a later pass change the rendering without a re-import.

## What was measured before this plan was written

```
files                     75 markdown  (+ 1 profileoverview.txt, EXCLUDED — see Task 0)
folders                    root + 8 (writing, daytracker, dreams, organization,
                           portugal, tvshow, untitled_notes, voice_notes)
words                     62,351          median 340/file   max 8,764

content blocks          2,137 total
  headings                305      -> containers
  annotations             409      -> quote blocks, marked
  prose                 1,400      -> textblocks
  code / table           16 / 7
  median per file          11      max 326 (Untitled 3.md, which has NO headings)

tag line                  75 of 75 files carry one   135 distinct tags
                          #tech 21 · #spirituality 20 · #identity 18 · #philosophy 16 · #moduli 15

blockquotes               460 total — so 51 are ORDINARY QUOTES, not annotations
mis-split by the importer  54 of 460 (11.7%)   <- Task 2 exists because of this number
duplicate basenames        Untitled 1/2/3/6/7/8.md appear twice, content DIFFERS every time
```

**Expected volume: ~2,200 occurrences and ~2,200 modules.** That is larger than the bookmarks import (1,467) and is the single number worth re-checking against the dry run before applying.

---

### Task 0: Pin the corpus census as a test, and settle the two exclusions

The whole plan rests on the numbers above. If the corpus changes underneath it, every later task's expectation is silently wrong.

**Files:**
- Create: `server/utils/codexCorpus.js`
- Test: `server/__tests__/codexCorpus.test.js`

**Interfaces:**
- Produces: `CODEX_ROOT` (string), `listCodexFiles(root) -> [{ absPath, relPath, folder, basename }]`, sorted by `relPath`.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/codexCorpus.test.js
import { describe, it, expect } from "vitest";
import { listCodexFiles, CODEX_ROOT } from "../utils/codexCorpus.js";
import fs from "node:fs";

const present = fs.existsSync(CODEX_ROOT);

describe.skipIf(!present)("listCodexFiles", () => {
  const files = listCodexFiles(CODEX_ROOT);

  it("finds every markdown file and NOTHING else", () => {
    // profileoverview.txt is deliberately excluded: it is not markdown, and the
    // importer's parser is a markdown parser. Importing it would produce one
    // giant prose blob rather than a structured page.
    expect(files.length).toBe(75);
    expect(files.every(f => f.relPath.endsWith(".md"))).toBe(true);
  });

  it("keys each file by its RELATIVE path, because basenames repeat", () => {
    // Measured: `Untitled 1.md` exists at the root AND in untitled_notes/ with
    // different content. A basename signature would collide and the second file
    // would be silently skipped as "already imported".
    const dupes = files.filter(f => f.basename === "Untitled 1.md");
    expect(dupes.length).toBe(2);
    expect(new Set(dupes.map(f => f.relPath)).size).toBe(2);
  });

  it("reports the folder each file lives in, '' for the root", () => {
    expect(new Set(files.map(f => f.folder))).toEqual(new Set([
      "", "writing", "daytracker", "dreams", "organization",
      "portugal", "tvshow", "untitled_notes", "voice_notes",
    ]));
  });

  it("is sorted, so a resumed run walks the same order", () => {
    const paths = files.map(f => f.relPath);
    expect(paths).toEqual([...paths].sort());
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ../client/node_modules/.bin/vitest run __tests__/codexCorpus.test.js`
Expected: FAIL — `Cannot find module '../utils/codexCorpus.js'`

- [ ] **Step 3: Write the implementation**

```js
// server/utils/codexCorpus.js
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
export function listCodexFiles(root = CODEX_ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.endsWith(".md")) {
        const relPath = path.relative(root, abs);
        out.push({ absPath: abs, relPath, folder: path.dirname(relPath) === "." ? "" : path.dirname(relPath), basename: e.name });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd server && ../client/node_modules/.bin/vitest run __tests__/codexCorpus.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: A/B the test — prove it discriminates**

Change `e.name.endsWith(".md")` to `e.name.endsWith(".md") || e.name.endsWith(".txt")` and re-run.
Expected: the "finds every markdown file and NOTHING else" test FAILS (76 ≠ 75). Restore.

- [ ] **Step 6: Commit**

```bash
git add server/utils/codexCorpus.js server/__tests__/codexCorpus.test.js
git commit -m "feat(codex): the corpus census, keyed by relative path because basenames repeat"
```

---

### Task 1: Split the tag line and classify the annotations

**Files:**
- Create: `server/utils/codexParse.js`
- Test: `server/__tests__/codexParse.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `splitTagLine(raw) -> { tags: string[], body: string }` — tags WITHOUT the leading `#`, lowercased; `body` is the file with the tag line removed.
  - `ANNOTATION_RE` (RegExp) and `annotationLabelOf(quoteText) -> string|null` — the bracketed marker, or null when the blockquote is an ordinary quote.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/codexParse.test.js
import { describe, it, expect } from "vitest";
import { splitTagLine, annotationLabelOf } from "../utils/codexParse.js";

describe("splitTagLine", () => {
  it("takes the leading hashtag line and hands back the rest", () => {
    const { tags, body } = splitTagLine("#reference #alchemy #daoism\n\nFabrizio Pregadio: teacher\n");
    expect(tags).toEqual(["reference", "alchemy", "daoism"]);
    expect(body.trim()).toBe("Fabrizio Pregadio: teacher");
  });

  it("lowercases and de-duplicates", () => {
    expect(splitTagLine("#Tech #tech #TECH\n\nx").tags).toEqual(["tech"]);
  });

  it("leaves a MARKDOWN HEADING alone — '# GRID' is not a tag line", () => {
    // The discriminator that matters: a tag line is several `#word` tokens with
    // no space after the hash. `# GRID` is an h1 and must survive into the body,
    // or 72 files lose their title.
    const { tags, body } = splitTagLine("# GRID\n\nsome prose");
    expect(tags).toEqual([]);
    expect(body).toContain("# GRID");
  });

  it("takes only the FIRST line, not hashtags further down", () => {
    // Annotations end with hashtags too (measured). Sweeping those into the
    // page's tags would attach an LLM's chosen words to the user's note.
    const { tags } = splitTagLine("#tech\n\nprose\n\n> **[annotation]** ... #adhd #habits");
    expect(tags).toEqual(["tech"]);
  });

  it("returns no tags and an unchanged body when there is no tag line", () => {
    const { tags, body } = splitTagLine("just prose\n");
    expect(tags).toEqual([]);
    expect(body).toBe("just prose\n");
  });
});

describe("annotationLabelOf", () => {
  it("reads the bracketed marker", () => {
    expect(annotationLabelOf("**[annotation]** A quick reference note.")).toBe("annotation");
    expect(annotationLabelOf("**[vision document]** The plan.")).toBe("vision document");
  });

  it("returns null for an ORDINARY quote — 51 of the 460 are not annotations", () => {
    // Marking every blockquote would label the user's own quoted material as
    // machine commentary, which is the opposite of the point.
    expect(annotationLabelOf("The unexamined life is not worth living.")).toBeNull();
    expect(annotationLabelOf("**bold** but not a marker")).toBeNull();
  });

  it("only matches a marker at the START", () => {
    expect(annotationLabelOf("Some prose then **[annotation]** later")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ../client/node_modules/.bin/vitest run __tests__/codexParse.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```js
// server/utils/codexParse.js
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
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd server && ../client/node_modules/.bin/vitest run __tests__/codexParse.test.js`
Expected: PASS (8 tests)

- [ ] **Step 5: A/B every guard**

Run each mutation, confirm it lands, confirm exactly the intended test fails, restore:

| mutation | must fail |
|---|---|
| `TAG_LINE_RE` → `/^\s*#/` | the `# GRID` heading test |
| scan every line for tags instead of the first | the "only the FIRST line" test |
| drop the `new Set` de-dupe | the lowercase/de-dupe test |
| `ANNOTATION_RE` → `/\*\*\[([^\]]+)\]\*\*/` (unanchored) | the "only at the START" test |

- [ ] **Step 6: Commit**

```bash
git add server/utils/codexParse.js server/__tests__/codexParse.test.js
git commit -m "feat(codex): the tag line and the annotation marker, both pure"
```

---

### Task 2: Stop the importer tearing the tail off an annotation

**This task exists because of a measurement, not a hunch: 54 of the 460 blockquotes (11.7%) would be mangled.**

`server/services/markdownImporter.js:369` splits a trailing em-dash clause off a blockquote as an "— attribution" byline. That is right for a Wikipedia pull-quote and wrong for these annotations, which are ordinary prose full of em-dashes:

```
"...in productivity software. The system is deeply personal — then generalized
 for others. #tech #adhd #habits #moduli"
                     ^ everything after this becomes an "attribution" byline
```

**Files:**
- Modify: `server/services/markdownImporter.js:361-372`
- Test: `server/__tests__/markdownQuoteAttribution.test.js`

**Interfaces:**
- Consumes: `annotationLabelOf` from Task 1.
- Produces: no signature change. `parseBlocks` gains `annotation: string|null` on `kind:"quote"` blocks and skips the attribution split when it is set.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/markdownQuoteAttribution.test.js
import { describe, it, expect } from "vitest";
import { parseBlocks } from "../services/markdownImporter.js";

const quotes = (md) => parseBlocks(md).filter(b => b.kind === "quote");

describe("blockquote attribution", () => {
  it("KEEPS an annotation whole, em-dashes and all", () => {
    // 54 of the corpus's 460 blockquotes end in an em-dash clause under 80
    // chars. Splitting one tears the last sentence out of the commentary and
    // renders it as a byline.
    const md = "> **[annotation]** The system is deeply personal — then generalized for others.";
    const [q] = quotes(md);
    expect(q.attribution).toBe("");
    expect(q.text).toContain("then generalized for others");
  });

  it("still splits an ORDINARY quote's attribution — the control", () => {
    // Without this the fix is indistinguishable from deleting the feature, and
    // every Wikipedia pull-quote loses its byline.
    const [q] = quotes("> The unexamined life is not worth living. — Socrates");
    expect(q.attribution).toBe("Socrates");
    expect(q.text).toBe("The unexamined life is not worth living.");
  });

  it("marks an annotation and leaves an ordinary quote unmarked", () => {
    expect(quotes("> **[vision document]** A plan.")[0].annotation).toBe("vision document");
    expect(quotes("> Just a quote.")[0].annotation).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ../client/node_modules/.bin/vitest run __tests__/markdownQuoteAttribution.test.js`
Expected: FAIL — the first test reports `attribution: "then generalized for others."`

If `parseBlocks` is not exported, export it in this step (it is currently module-private).

- [ ] **Step 3: Write the implementation**

Replace the blockquote branch at `server/services/markdownImporter.js:361-372`:

```js
    if (/^\s*>\s?/.test(line)) {
      const qLines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        qLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      const text = qLines.join(" ").replace(/\s+/g, " ").trim();
      // AN ANNOTATION IS NOT A PULL-QUOTE, so it never gets an attribution.
      // These are prose written ABOUT the note, and prose contains em-dashes:
      // measured on the codex corpus, 54 of 460 blockquotes end in a short
      // em-dash clause, and every one of them would have its last sentence torn
      // off and rendered as "— …". The marker is what tells the two apart.
      const annotation = annotationLabelOf(text);
      let quote = text, attribution = "";
      if (!annotation) {
        const m = /^(.+?)\s*[—–]\s*([^—–]{2,80})$/.exec(text);
        if (m) { quote = m[1].trim(); attribution = m[2].trim(); }
      }
      if (quote) blocks.push({ kind: "quote", text: quote, attribution, annotation });
      continue;
    }
```

Add the import at the top of the file:

```js
import { annotationLabelOf } from "../utils/codexParse.js";
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd server && ../client/node_modules/.bin/vitest run __tests__/markdownQuoteAttribution.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the WHOLE server suite — this file is shared**

Run: `cd server && ../client/node_modules/.bin/vitest run`
Expected: PASS. `markdownImporter` is used by Wikipedia import, link-to-page and intake; a regression here breaks all three. If any existing quote test fails, the fix is wrong — an ordinary quote's behaviour must be byte-identical.

- [ ] **Step 6: Carry the marker onto the minted block**

At `server/services/markdownImporter.js:532`, the quote artifact's meta becomes:

```js
      meta: { quote: text || "", attribution: attribution || "", ...(annotation ? { codexAnnotation: annotation } : {}) },
```

Add a test asserting `meta.codexAnnotation` survives onto the occurrence, and that an ordinary quote has NO such key (a key present-and-empty reads as "this is an annotation with no label").

- [ ] **Step 7: Commit**

```bash
git add server/services/markdownImporter.js server/__tests__/markdownQuoteAttribution.test.js
git commit -m "fix(import): an annotation is not a pull-quote — 54 of 460 lost their last sentence"
```

---

### Task 3: Mint the folder tree and the Codex Tags field

**Files:**
- Create: `server/migrations/0202-codex-folders-and-tags.mjs`
- Test: `server/__tests__/codexFolders.test.js`

**Interfaces:**
- Consumes: `listCodexFiles` (Task 0), `splitTagLine` (Task 1).
- Produces: `planCodexFolders(files, { rootFolderId, manifestId, userId }) -> { folders: [...], byRelFolder: Map<string, folderId> }` and `collectCodexTags(files) -> string[]` (sorted, de-duplicated).

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/codexFolders.test.js
import { describe, it, expect } from "vitest";
import { planCodexFolders, collectCodexTags } from "../migrations/0202-codex-folders-and-tags.mjs";

const files = [
  { relPath: "a.md", folder: "" },
  { relPath: "writing/b.md", folder: "writing" },
  { relPath: "writing/c.md", folder: "writing" },
  { relPath: "dreams/d.md", folder: "dreams" },
];
const ctx = { rootFolderId: "ROOT", manifestId: "M", userId: "U" };

describe("planCodexFolders", () => {
  it("makes one Codex folder plus one per source subfolder — never one per FILE", () => {
    const { folders } = planCodexFolders(files, ctx);
    expect(folders.map(f => f.name)).toEqual(["Codex", "dreams", "writing"]);
  });

  it("parents Codex at the manifest root and the rest under Codex", () => {
    const { folders } = planCodexFolders(files, ctx);
    const codex = folders.find(f => f.name === "Codex");
    expect(codex.parentId).toBe("ROOT");
    expect(folders.filter(f => f.name !== "Codex").every(f => f.parentId === codex.id)).toBe(true);
  });

  it("maps a root-level file to the Codex folder itself", () => {
    const { byRelFolder, folders } = planCodexFolders(files, ctx);
    expect(byRelFolder.get("")).toBe(folders.find(f => f.name === "Codex").id);
    expect(byRelFolder.get("writing")).toBe(folders.find(f => f.name === "writing").id);
  });
});

describe("collectCodexTags", () => {
  it("gathers every tag once, sorted", () => {
    const withTags = [
      { tags: ["tech", "moduli"] }, { tags: ["tech"] }, { tags: ["dreams"] },
    ];
    expect(collectCodexTags(withTags)).toEqual(["dreams", "moduli", "tech"]);
  });

  it("returns an empty list for no tags — the control", () => {
    expect(collectCodexTags([{ tags: [] }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ../client/node_modules/.bin/vitest run __tests__/codexFolders.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write the migration's pure half**

```js
// server/migrations/0202-codex-folders-and-tags.mjs
/**
 * 0202 — the Codex folder tree and the field its tags go in.
 *
 * Split from the import itself (0203) on purpose: this one is small, reversible
 * and cheap to re-run, and it is the half that must be RIGHT before 2,200
 * occurrences are minted into it. A folder tree that lands wrong is one delete;
 * a 75-page import into the wrong folder is not.
 *
 * ── THE TAGS GET THEIR OWN FIELD ───────────────────────────────────────────
 *
 * User's call. The existing `Tags` field is MIXED — 45 live values, only nine
 * of which are wellness dimensions; the rest are board categories (`image`,
 * `grocery`, `person`) that drive real pickers (CLAUDE.md 2026-08-20 (5)).
 * Adding 135 codex tags would put them in every board-category dropdown.
 */
const uid = () => Math.random().toString(36).slice(2, 12);

export const id = "0202-codex-folders-and-tags";
export const describe =
  "Create the Codex folder (mirroring the notes_codex_annotated tree) and a `Codex Tags` multi-select field carrying the corpus's 135 tags.";

/** One folder for Codex, one per source subfolder. Never one per file. */
export function planCodexFolders(files, { rootFolderId, manifestId, userId }) {
  const codex = { id: uid(), userId, name: "Codex", parentId: rootFolderId, manifestId };
  const subs = [...new Set(files.map((f) => f.folder).filter(Boolean))].sort();
  const folders = [codex, ...subs.map((name) => ({ id: uid(), userId, name, parentId: codex.id, manifestId }))];
  const byRelFolder = new Map([["", codex.id]]);
  folders.slice(1).forEach((f) => byRelFolder.set(f.name, f.id));
  return { folders, byRelFolder };
}

/** Every tag in the corpus, once, sorted. */
export function collectCodexTags(parsed) {
  return [...new Set(parsed.flatMap((p) => p.tags || []))].sort();
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd server && ../client/node_modules/.bin/vitest run __tests__/codexFolders.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the `up()` half**

```js
export async function up({ gridId, grid, models, log, dryRun }) {
  const { Folder, Field, Manifest } = models;
  const { listCodexFiles, CODEX_ROOT } = await import("../utils/codexCorpus.js");
  const { splitTagLine } = await import("../utils/codexParse.js");
  const fs = await import("node:fs");

  if (!fs.existsSync(CODEX_ROOT)) { log(`  REFUSING: no corpus at ${CODEX_ROOT}`); return; }
  const manifest = await Manifest.findOne({ id: grid.manifestId }).lean();
  const rootFolderId = manifest?.rootFolderId;
  if (!rootFolderId) { log("  REFUSING: the grid's manifest has no root folder"); return; }

  // Idempotency: a Codex folder already under the root means this ran.
  const existing = await Folder.findOne({ manifestId: grid.manifestId, name: "Codex", parentId: rootFolderId }).lean();
  if (existing) { log("  Codex folder already exists — nothing to do"); return; }

  const files = listCodexFiles();
  const parsed = files.map((f) => ({ ...f, ...splitTagLine(fs.readFileSync(f.absPath, "utf8")) }));
  const { folders } = planCodexFolders(files, { rootFolderId, manifestId: grid.manifestId, userId: grid.userId });
  const tags = collectCodexTags(parsed);

  log(`  ${files.length} file(s) -> ${folders.length} folder(s): ${folders.map((f) => f.name).join(", ")}`);
  log(`  ${tags.length} distinct tag(s), e.g. ${tags.slice(0, 8).join(", ")}`);
  if (dryRun) { log("  (dry run — nothing written)"); return; }

  await Folder.insertMany(folders);
  await Field.create({
    id: uid(), userId: grid.userId, gridId, name: "Codex Tags", type: "select",
    meta: { multiSelect: true, optionsSource: { mode: "manual", values: tags } },
  });
  log(`  done — ${folders.length} folders, 1 field with ${tags.length} options`);
}
```

- [ ] **Step 6: Rehearse on test grid 2, then dry-run poms grid**

```bash
node --env-file=server/.env server/scripts/runMigrations.js --grid "test grid 2" --only 0202-codex-folders-and-tags
node --env-file=server/.env server/scripts/runMigrations.js --grid "test grid 2" --only 0202-codex-folders-and-tags --apply
node --env-file=server/.env server/scripts/runMigrations.js --grid "test grid 2" --only 0202-codex-folders-and-tags --force   # must report "already exists"
node --env-file=server/.env server/scripts/runMigrations.js --grid "poms grid" --only 0202-codex-folders-and-tags
```

Expected on the dry run, checked against a NAMED expectation rather than accepted as a count:
`75 file(s) -> 9 folder(s): Codex, daytracker, dreams, organization, portugal, tvshow, untitled_notes, voice_notes, writing` and `135 distinct tag(s)`.

- [ ] **Step 7: Apply to poms grid and commit**

```bash
node --env-file=server/.env server/scripts/runMigrations.js --grid "poms grid" --only 0202-codex-folders-and-tags --apply
node --env-file=server/.env server/scripts/checkGrid.js --grid "poms grid"     # 1 pre-existing error, 0 new
git add server/migrations/0202-codex-folders-and-tags.mjs server/__tests__/codexFolders.test.js
git commit -m "feat(codex): the folder tree and a Codex Tags field of its own"
```

---

### Task 4: One page per file

**Files:**
- Create: `server/utils/codexPage.js`
- Test: `server/__tests__/codexPage.test.js`

**Interfaces:**
- Consumes: `markdownToModuli` (existing), `splitTagLine` (Task 1).
- Produces: `planCodexPage({ gridId, userId, folderId, tagFieldId, relPath, rootOccurrenceId, tags }) -> { pageModule, pageOcc }`. Pure — Task 5 does the IO around it.

**THE GAP THIS CLOSES:** `markdownToModuli` always returns a `role:"container"` root — CLAUDE.md 2026-08-08 (8) records that *"the importer has NEVER minted a page"*. The user asked for pages, so the page wrapper is real work, and the ORDER is load-bearing: import first, mint the page only after the import returns, so the page is created already embedding a root id that exists. Minting first leaves an empty page behind every time an import fails.

- [ ] **Step 1: Write the failing test**

```js
// server/__tests__/codexPage.test.js
import { describe, it, expect, vi } from "vitest";
import { planCodexPage } from "../utils/codexPage.js";

describe("planCodexPage", () => {
  const base = { gridId: "g", userId: "u", folderId: "F", tagFieldId: "T",
                 relPath: "writing/mental health.md", rootOccurrenceId: "ROOT", tags: ["mental-health", "writing"] };

  it("names the page from the FILE, without its extension", () => {
    expect(planCodexPage(base).pageModule.label).toBe("mental health");
  });

  it("homes the page in its folder and EMBEDS the imported root", () => {
    // A doc renders its textmap, so listing the root without embedding it is
    // the listed-but-not-embedded class this repo has repaired five times.
    const { pageOcc } = planCodexPage(base);
    expect(pageOcc.parentId).toBe("F");
    expect(pageOcc.occurrences).toEqual(["ROOT"]);
  });

  it("stamps the tags into the Codex Tags field", () => {
    expect(planCodexPage(base).pageOcc.fields.T).toEqual({ value: ["mental-health", "writing"], flow: "in" });
  });

  it("signs the page with the RELATIVE path, so a re-run recognises it", () => {
    // Basenames repeat across folders with different content — a basename
    // signature would make the second file look already-imported.
    expect(planCodexPage(base).pageOcc.meta.codexPath).toBe("writing/mental health.md");
  });

  it("writes NO tag field when the file had none — not an empty array", () => {
    // An empty array reads as "tagged with nothing" in a multi-select and shows
    // an empty chip row; absent reads as untagged.
    const { pageOcc } = planCodexPage({ ...base, tags: [] });
    expect(pageOcc.fields.T).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ../client/node_modules/.bin/vitest run __tests__/codexPage.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```js
// server/utils/codexPage.js
//
// A codex file becomes a PAGE, and `markdownToModuli` cannot make one.
//
// That importer's root is always `role:"container"` — CLAUDE.md 2026-08-08 (8)
// records it in as many words: "the importer has NEVER minted a page". So the
// wrapper is this file's job.
//
// ORDER IS LOAD-BEARING: the markdown is imported FIRST and the page is minted
// only once the import has returned a root id. Minting the page first leaves an
// empty page behind every time an import fails.
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
  // "tagged with nothing" and renders an empty chip row.
  if (tags.length && tagFieldId) fields[tagFieldId] = { value: tags, flow: "in" };
  const pageOcc = {
    id: uid(), userId, gridId, moduleId: pageModule.id,
    parentId: folderId,
    // EMBEDDED, not merely listed — a doc renders its textmap, and a child that
    // is listed and not embedded is present in the data and invisible on screen.
    occurrences: [rootOccurrenceId],
    fields,
    // The signature is the RELATIVE path. Basenames repeat across folders with
    // DIFFERENT content (measured: Untitled 1/2/3/6/7/8.md), so a basename here
    // would make the second copy look already-imported and drop it.
    meta: { codexPath: relPath },
  };
  return { pageModule, pageOcc };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd server && ../client/node_modules/.bin/vitest run __tests__/codexPage.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: A/B every guard**

| mutation | must fail |
|---|---|
| `meta.codexPath = path.basename(relPath)` | the relative-path signature test |
| `occurrences: []` | the embed test |
| always write `fields[tagFieldId]` | the "no tag field when none" test |

- [ ] **Step 6: Commit**

```bash
git add server/utils/codexPage.js server/__tests__/codexPage.test.js
git commit -m "feat(codex): the page wrapper the markdown importer cannot mint"
```

---

### Task 5: The import migration

**Files:**
- Create: `server/migrations/0203-codex-import.mjs`
- Test: `server/__tests__/codexImport.test.js`

**Interfaces:**
- Consumes: everything from Tasks 0-4.
- Produces: nothing later depends on it.

- [ ] **Step 1: Write the failing test — resumability is the contract**

```js
// server/__tests__/codexImport.test.js
import { describe, it, expect } from "vitest";
import { planCodexRun } from "../migrations/0203-codex-import.mjs";

const files = [
  { relPath: "a.md", folder: "" },
  { relPath: "writing/b.md", folder: "writing" },
  { relPath: "untitled_notes/Untitled 1.md", folder: "untitled_notes" },
];

describe("planCodexRun", () => {
  it("skips files a previous run already imported", () => {
    const done = new Set(["a.md"]);
    expect(planCodexRun(files, done).todo.map(f => f.relPath))
      .toEqual(["untitled_notes/Untitled 1.md", "writing/b.md"]);
    expect(planCodexRun(files, done).alreadyDone).toBe(1);
  });

  it("does everything on a first run", () => {
    expect(planCodexRun(files, new Set()).todo).toHaveLength(3);
  });

  it("does NOTHING on a converged run — a re-run must create nothing", () => {
    const done = new Set(files.map(f => f.relPath));
    expect(planCodexRun(files, done).todo).toEqual([]);
  });

  it("tells a repeated BASENAME apart by its folder", () => {
    // `Untitled 1.md` exists at the root too, with different content. If the
    // root one is done, the untitled_notes one must STILL be pending.
    const two = [...files, { relPath: "Untitled 1.md", folder: "" }];
    const done = new Set(["Untitled 1.md"]);
    expect(planCodexRun(two, done).todo.map(f => f.relPath)).toContain("untitled_notes/Untitled 1.md");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd server && ../client/node_modules/.bin/vitest run __tests__/codexImport.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Write the migration**

```js
// server/migrations/0203-codex-import.mjs
/**
 * 0203 — 75 annotated notes become 75 pages.
 *
 * It DRIVES the existing importer rather than adding a second one:
 * `markdownToModuli` already turns markdown into a module/occurrence tree with
 * headings as containers and prose as textblocks. What it cannot do is mint a
 * page (0203 does, via `codexPage`), read a tag line (`codexParse`), or tell an
 * annotation from a quote (fixed in the importer itself by Task 2).
 *
 * ── RESUMABLE, and that is the whole safety of a 2,200-occurrence write ─────
 *
 * Every page is signed `meta.codexPath` with the file's path RELATIVE to the
 * corpus root. A run that dies at file 40 leaves 35, and a re-run does exactly
 * those. The relative path matters: `Untitled 1.md` exists at the root AND in
 * `untitled_notes/` with different content, so a basename signature would make
 * the second look already-imported and silently drop it.
 */
import { markdownToModuli } from "../services/markdownImporter.js";
import { listCodexFiles, CODEX_ROOT } from "../utils/codexCorpus.js";
import { splitTagLine } from "../utils/codexParse.js";
import { planCodexPage } from "../utils/codexPage.js";
import fs from "node:fs";

export const id = "0203-codex-import";
export const describe =
  "Import the 75 annotated notes as pages under the Codex folder — headings as containers, prose as textblocks, annotations as marked quote blocks, the tag line into Codex Tags.";

/** Which files still need doing. Pure, so resumability is testable. */
export function planCodexRun(files, alreadyDone) {
  const todo = files.filter((f) => !alreadyDone.has(f.relPath));
  return { todo, alreadyDone: files.length - todo.length };
}

export async function up({ gridId, grid, models, log, dryRun }) {
  const { Occurrence, Module, Field, Folder, Manifest } = models;
  if (!fs.existsSync(CODEX_ROOT)) { log(`  REFUSING: no corpus at ${CODEX_ROOT}`); return; }

  const manifest = await Manifest.findOne({ id: grid.manifestId }).lean();
  const codexFolder = await Folder.findOne({ manifestId: grid.manifestId, name: "Codex", parentId: manifest?.rootFolderId }).lean();
  if (!codexFolder) { log("  REFUSING: no Codex folder — run 0202 first"); return; }
  const subFolders = await Folder.find({ manifestId: grid.manifestId, parentId: codexFolder.id }).lean();
  const folderFor = new Map([["", codexFolder.id], ...subFolders.map((f) => [f.name, f.id])]);

  const tagField = await Field.findOne({ gridId, name: "Codex Tags" }).lean();
  if (!tagField) { log("  REFUSING: no `Codex Tags` field — run 0202 first"); return; }

  const files = listCodexFiles();
  const done = new Set((await Occurrence.find({ gridId, "meta.codexPath": { $exists: true } }).lean())
    .map((o) => o.meta.codexPath));
  const { todo, alreadyDone } = planCodexRun(files, done);
  log(`  ${files.length} file(s): ${todo.length} to import, ${alreadyDone} already done`);

  if (dryRun) {
    // Plan ONE file for real so the shape is known before 75 are written.
    if (todo[0]) {
      const { tags, body } = splitTagLine(fs.readFileSync(todo[0].absPath, "utf8"));
      const res = await markdownToModuli({ gridId, userId: grid.userId, markdown: body, title: todo[0].basename.replace(/\.md$/, ""), dryRun: true });
      log(`  e.g. ${todo[0].relPath}: ${res.stats.occurrences} occurrence(s) ` +
          `(${res.stats.containers} containers, ${res.stats.textblocks} textblocks, ${res.stats.artifacts} artifacts), tags: ${tags.join(", ") || "none"}`);
    }
    log("  (dry run — nothing written)");
    return;
  }

  let pages = 0, occs = 0, failed = [];
  for (const f of todo) {
    const folderId = folderFor.get(f.folder);
    if (!folderId) { failed.push(`${f.relPath} (no folder)`); continue; }
    const { tags, body } = splitTagLine(fs.readFileSync(f.absPath, "utf8"));
    const title = f.basename.replace(/\.md$/, "");
    let res;
    try {
      // IMPORT FIRST. The page is minted only once there is a root id to embed.
      res = await markdownToModuli({ gridId, userId: grid.userId, markdown: body, title, dryRun: false });
    } catch (e) { failed.push(`${f.relPath} (${e.message})`); continue; }

    const { pageModule, pageOcc } = planCodexPage({
      gridId, userId: grid.userId, folderId, tagFieldId: tagField.id,
      relPath: f.relPath, rootOccurrenceId: res.rootOccurrenceId, tags,
    });
    await Module.create(pageModule);
    await Occurrence.create(pageOcc);
    await Occurrence.updateOne({ id: res.rootOccurrenceId, gridId }, { $set: { parentId: pageOcc.id } });
    pages++; occs += res.stats.occurrences + 1;
    if (pages % 10 === 0) log(`     …${pages}/${todo.length} pages, ${occs} occurrences`);
  }
  log(`  done — ${pages} page(s), ${occs} occurrence(s)`);
  if (failed.length) log(`  ${failed.length} FAILED (re-run to retry): ${failed.slice(0, 5).join("; ")}`);
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd server && ../client/node_modules/.bin/vitest run __tests__/codexImport.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: A/B resumability**

Change `files.filter((f) => !alreadyDone.has(f.relPath))` to `files` and re-run. Expected: the "does NOTHING on a converged run" and "skips files already imported" tests FAIL. Restore.

- [ ] **Step 6: Rehearse the whole thing on test grid 2**

```bash
node --env-file=server/.env server/scripts/runMigrations.js --grid "test grid 2" --only 0202-codex-folders-and-tags --apply
node --env-file=server/.env server/scripts/runMigrations.js --grid "test grid 2" --only 0203-codex-import
node --env-file=server/.env server/scripts/runMigrations.js --grid "test grid 2" --only 0203-codex-import --apply
node --env-file=server/.env server/scripts/runMigrations.js --grid "test grid 2" --only 0203-codex-import --force   # must report "0 to import, 75 already done"
node --env-file=server/.env server/scripts/checkGrid.js --grid "test grid 2"
```

Expected: `75 page(s)`, roughly **2,200 occurrences** (Task 0's census predicts 2,137 content blocks plus 75 page wrappers plus per-file roots), **0 integrity errors**.

**If the occurrence count is wildly off the census, STOP and find out why before touching poms grid.** A number that disagrees with an independently-derived expectation is the signal this repo has been saved by repeatedly.

- [ ] **Step 7: Commit**

```bash
git add server/migrations/0203-codex-import.mjs server/__tests__/codexImport.test.js
git commit -m "feat(codex): 75 notes become 75 pages, resumable on the relative path"
```

---

### Task 6: Apply to poms grid and read the result back

- [ ] **Step 1: Dry-run against a named expectation**

```bash
node --env-file=server/.env server/scripts/runMigrations.js --grid "poms grid" --only 0203-codex-import
```

Expected: `75 file(s): 75 to import, 0 already done`, and the sample line naming a real file with a plausible occurrence count.

- [ ] **Step 2: Apply**

```bash
node --env-file=server/.env server/scripts/runMigrations.js --grid "poms grid" --only 0203-codex-import --apply
```

- [ ] **Step 3: Read the result back OUT OF MONGO — not off the log**

Write `server/scripts/_codexverify.mjs` asserting, on poms grid:

```
pages with meta.codexPath           == 75
distinct meta.codexPath values      == 75            <- no basename collision
pages whose parentId is a Codex folder == 75
pages listing exactly one root child == 75           <- embedded, not stranded
occurrences carrying meta.codexAnnotation  ~409      <- the annotations are marked
quote blocks with a non-empty attribution   small    <- Task 2 held; a big number means it did not
pages carrying Codex Tags values     == 75
Tags field option count              UNCHANGED       <- the existing field was not touched
```

- [ ] **Step 4: Integrity + a second pass**

```bash
node --env-file=server/.env server/scripts/checkGrid.js --grid "poms grid"        # 1 pre-existing error, 0 new
node --env-file=server/.env server/scripts/runMigrations.js --grid "poms grid" --only 0203-codex-import --force
```

Expected: `0 to import, 75 already done`.

- [ ] **Step 5: Restart pm2 — the warm cache is authoritative for reads**

```bash
ssh deploy@viafluere.com 'pm2 restart moduli'
```

Without it the client re-reads the pre-migration state and the Codex folder appears empty (CLAUDE.md 2026-08-01 (19)).

- [ ] **Step 6: LOOK AT IT**

Open the Codex folder in a browser. Check one page from each of three shapes, because they fail differently:
- `Untitled 6.md` — 2 blocks, tags, one annotation. The simple case.
- `philosopherstone.md` — 16 headings. Proves headings became containers.
- `voice_notes/lyrics.md` — 46 annotations. Proves the annotation rendering is bearable at volume; if it is not, that is a styling pass, and `meta.codexAnnotation` is what makes it possible without re-importing.

- [ ] **Step 7: Record it in CLAUDE.md and commit**

---

## Risks, stated rather than discovered later

1. **~2,200 occurrences AND ~2,200 modules.** Modules are cloned per row on this grid, so a delete of any codex page strands its module unless it goes through `server/utils/migrationDelete.js`. Larger than the bookmarks import.
2. **`Untitled 3.md` is 326 blocks with NO headings** — one page with 303 textblocks and no structure. It will be a very long page. Not a defect; worth seeing before deciding whether it wants splitting.
3. **The importer is SHARED.** Task 2 changes `markdownImporter.js`, which Wikipedia import, link-to-page and intake all use. The full server suite must pass, and an ordinary quote's behaviour must be byte-identical.
4. **135 new select options.** Contained to the new field by decision (3), but it is still a large option list in one picker.
5. **The corpus is not in the repo.** Every test skips when `CODEX_ROOT` is absent, so this suite is green on a machine without the notebook — which means it proves nothing there. That is the honest cost of testing against real user data.
