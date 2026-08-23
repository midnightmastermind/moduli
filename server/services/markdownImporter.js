// services/markdownImporter.js
//
// Phase A of the document-import pipeline (docs/assistant-plan.md §X).
// Deterministic markdown → Moduli entities. No LLM. Conversion rules:
//
//   # / ## / ### headings  → container (role:container, kind:list)
//                            nested by heading depth
//   * / - / 1. list items  → instance (role:instance, kind:list)
//   ![alt](src)             → artifact (role:artifact, kind:image)
//                            with fileRef:<src>. Block-level images
//                            mint an artifact; inline images stay as
//                            TipTap image marks inside the textblock.
//   ```html ... ```         → textblock with raw HTML preview (htmlBlock).
//                            Used by the drag-to-import HTML pipeline to
//                            preserve <table> structure verbatim.
//   ```code``` blocks       → textblock containing a code block
//   prose paragraphs        → textblock (role:textblock, kind:doc)
//                            with TipTap JSON in textmap
//   ---                     → ignored (section separator)
//
// Inline marks (**bold**, *italic*, `code`, [text](url)) are converted
// to TipTap marks so they render correctly in the existing editor.
//
// Phase B (LLM-powered) will handle unstructured prose by asking the
// assistant to plan a tree before we mint anything. That lives in
// services/llmImporter.js (deferred).
//
// Returns { modules: [...], occurrences: [...], rootOccurrenceId, dryRun }.
// Caller broadcasts the entities via socket so connected tabs sync.

import crypto from "crypto";
import { annotationLabelOf } from "../utils/codexParse.js";
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";

const uid = () => crypto.randomUUID();

// Trailing boilerplate sections we DON'T import — pure citation/navigation cruft
// (the "random line with a dash + link" the user saw was the External-links
// `- [Official website] [![Edit this at Wikidata]…]` bullet). "See also" is kept
// on purpose (the user wants those as links).
const SECTION_DENYLIST = new Set([
  "notes", "references", "external links", "further reading",
  "citations", "sources", "bibliography", "footnotes", "see also footnotes",
]);
const isDenylistedSection = (label) => SECTION_DENYLIST.has(String(label || "").trim().toLowerCase());

// ----- Inline mark parser -----
// Walks a line and emits TipTap text nodes with bold/italic/code/link
// marks. Order matters: ***x*** (both), **x** (bold), *x* (italic),
// `x` (code), [x](y) (link).
// Splits a pipe-table row like `| a | b | c |` into trimmed cell
// strings. Tolerates the leading/trailing `|` being omitted (GitHub
// flavored markdown allows that). Escaped `\|` is preserved as a
// literal `|` inside a cell.
function splitTableRow(line) {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cur = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "\\" && t[i + 1] === "|") { cur += "|"; i++; continue; }
    if (ch === "|") { cells.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

// Splits a prose paragraph into a sequence of top-level TipTap blocks,
// extracting each `![alt](src)` as its own block-level image node between
// paragraph nodes. The Image extension in the editor is configured
// inline:false (see client/src/ui/Editor.jsx:291), so inline images
// can't live inside a paragraph's content — we have to break the
// paragraph around them. Returns an array of TipTap block nodes; each
// non-image chunk runs through `parseInline` for marks (bold/italic/
// code/link). Whitespace-only chunks are dropped so we don't mint empty
// paragraphs around an image.
function paragraphToBlocks(text, mintLink) {
  const blocks = [];
  const imgRe = /!\[([^\]]*)\]\(((?:[^()]|\([^)]*\))*)\)/g;
  let lastIdx = 0;
  let m;
  while ((m = imgRe.exec(text)) !== null) {
    const before = text.slice(lastIdx, m.index).replace(/\s+$/g, "");
    if (before) blocks.push({ type: "paragraph", content: parseInline(before, mintLink) });
    blocks.push({ type: "image", attrs: { src: m[2], alt: m[1] || null } });
    lastIdx = m.index + m[0].length;
  }
  const tail = text.slice(lastIdx).replace(/^\s+/g, "");
  if (tail) blocks.push({ type: "paragraph", content: parseInline(tail, mintLink) });
  // No image found AND no tail → the original paragraph; preserve it as one node.
  if (!blocks.length) blocks.push({ type: "paragraph", content: parseInline(text, mintLink) });
  return blocks;
}

// Apply text marks to a list of inline nodes. Atom nodes (link chips) can't
// carry text marks, so they pass through unchanged — the emphasis is dropped but
// the LINK STILL RESOLVES (the whole point). Without this, an emphasis-wrapped
// link like `*[The Eminem Show](url)*` rendered as the literal text
// `[The Eminem Show](url)` because the old italic rule's `[^*]+` swallowed the
// whole `[text](url)` before the link rule ever saw it.
function applyMarks(nodes, marks) {
  return nodes.map((n) => {
    if (n.type !== "text") return n;
    const merged = (n.marks || []).slice();
    for (const m of marks) if (!merged.some((x) => x.type === m.type)) merged.push(m);
    return { ...n, marks: merged };
  });
}

// Wikipedia's rendered HTML often yields links whose visible text is
// whitespace-only (annotated "See also" links, discography/co-headlining list
// entries) → `[ ](/wiki/Article_Name)`. The regex below matches a blank label,
// so the chip came out empty. When the label is blank, derive a readable label
// from the URL slug (for /wiki/X the slug IS the article name).
function deriveLinkLabel(label, url) {
  const t = String(label || "").trim();
  if (t) return t;
  const u = String(url || "");
  let m = u.match(/\/wiki\/([^?#]+)/) || u.match(/\/([^/?#]+)\/?(?:[?#]|$)/);
  if (m) {
    try {
      const slug = decodeURIComponent(m[1]).replace(/_/g, " ").trim();
      if (slug) return slug;
    } catch { /* malformed escape — fall through */ }
  }
  return u || "link";
}

// `mintLink(label, url) → { occurrenceId, moduleId }` (optional). When provided,
// each [text](url) becomes an INLINE textblock occurrence (role:"textblock"
// kind:"inline" carrying meta.link) embedded via an `instanceTextblockInline`
// node — so the link renders as a clickable chip that flows in the sentence
// instead of an un-resolving inline link mark. When absent (non-prose) links
// stay as plain link marks. Bold/italic spans RECURSE through parseInline so a
// link nested inside emphasis is still detected and minted.
function parseInline(text, mintLink) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    // Link: [text](url) — tried FIRST so it wins over a surrounding emphasis run.
    // The url group allows ONE level of balanced parens so Wikipedia titles like
    // `…/Encore_(Eminem_album)` aren't truncated at the first `)` (which left a
    // stray trailing `)` after the chip — "The Monster Tour)").
    const linkMatch = /^\[([^\]]+)\]\(((?:[^()]|\([^)]*\))*)\)/.exec(rest);
    if (linkMatch) {
      if (mintLink) {
        const { occurrenceId, moduleId } = mintLink(linkMatch[1], linkMatch[2]);
        out.push({ type: "instanceTextblockInline", attrs: { occurrenceId, instanceId: moduleId } });
      } else {
        out.push({
          type: "text",
          text: deriveLinkLabel(linkMatch[1], linkMatch[2]),
          marks: [{ type: "link", attrs: { href: linkMatch[2] } }],
        });
      }
      i += linkMatch[0].length;
      continue;
    }
    // Bold+italic ***x*** — non-greedy + RECURSE (inner may hold a link).
    const biMatch = /^\*\*\*([\s\S]+?)\*\*\*/.exec(rest);
    if (biMatch) {
      out.push(...applyMarks(parseInline(biMatch[1], mintLink), [{ type: "bold" }, { type: "italic" }]));
      i += biMatch[0].length; continue;
    }
    // Bold **x**
    const boldMatch = /^\*\*([\s\S]+?)\*\*/.exec(rest);
    if (boldMatch) {
      out.push(...applyMarks(parseInline(boldMatch[1], mintLink), [{ type: "bold" }]));
      i += boldMatch[0].length; continue;
    }
    // Italic *x*
    const italicMatch = /^\*([\s\S]+?)\*/.exec(rest);
    if (italicMatch) {
      out.push(...applyMarks(parseInline(italicMatch[1], mintLink), [{ type: "italic" }]));
      i += italicMatch[0].length; continue;
    }
    // Inline code `x`
    const codeMatch = /^`([^`]+)`/.exec(rest);
    if (codeMatch) {
      out.push({ type: "text", text: codeMatch[1], marks: [{ type: "code" }] });
      i += codeMatch[0].length; continue;
    }
    // Plain text up to the next special token
    const nextSpecial = rest.search(/[\[*`]/);
    const stop = nextSpecial < 0 ? text.length : i + nextSpecial;
    const plain = text.slice(i, stop);
    if (plain) out.push({ type: "text", text: plain });
    if (stop === i) i++; // safety: never infinite-loop
    else i = stop;
  }
  return out.length ? out : [{ type: "text", text: "" }];
}

// Strip inline markdown emphasis/link syntax down to plain text — used for
// container HEADER labels (a heading like `### 1997–1999: … *The Slim Shady LP*`
// should read as clean text, not show literal `*` asterisks).
// A column is only as readable as its widest fixed element — the header. Clamped
// so one long header cannot squeeze the data columns to nothing.
const TABLE_LABEL = "List";
const TABLE_HEADING_LEVEL = 4;

function headerWidth(title) {
  const n = String(title ?? "").length;
  // Roomier than the first pass (user, 2026-08-14: "make it wider"). The floor
  // matters most — it is what every short header lands on.
  return Math.max(150, Math.min(360, 28 + n * 9));
}

function stripInlineMd(s) {
  return String(s)
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, "$1")
    .replace(/\*\*\*([^*]+)\*\*\*/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

// Build a section's doc-body content array from its ordered child occurrence ids,
// folding block images into `wrapGroup`s with an adjacent prose textblock host so
// the prose reflows beside the image. Images are buffered (Wikipedia emits the
// image BEFORE its prose) and flushed onto the next textblock as one or more
// stacked neighbors — a single host can wrap MULTIPLE images. Non-prose children
// (sub-sections, tables) flush any pending images as full-width standalone embeds
// first, preserving reading order. Leftover images at the end go standalone too.
function buildSectionBody(childIds, { imageChildIds, textblockChildIds, asideId = null, asideMemberIds = [] }) {
  const embed = (id, extra) => ({ type: "moduleEmbed", attrs: { occurrenceId: id, ...(extra || {}) } });
  const memberSet = new Set(asideMemberIds); // lead image + infobox table → live inside the aside container
  const content = [];
  let pendingImgs = [];
  const flushStandalone = () => {
    for (const id of pendingImgs) content.push(embed(id, { align: "full" }));
    pendingImgs = [];
  };
  // Lead aside (main image stacked over the infobox) pairs with the FIRST prose
  // textblock in a `wrapGroup` — neighbor-first `[aside, firstTextblock]`,
  // `side:right`. The client always wraps when a neighbor exists (the real-float
  // L; WrapGroupNode ignores any legacy `wrap` attr), and the draggable seam
  // owns column width (neighborWidth is just the start).
  let asidePairedTextblockId = null;
  if (asideId) {
    asidePairedTextblockId = childIds.find(
      (id) => textblockChildIds.has(id) && !memberSet.has(id) && id !== asideId
    ) || null;
    if (asidePairedTextblockId) {
      content.push({
        type: "wrapGroup",
        attrs: { side: "right", anchorIndex: 0, neighborWidth: 320 },
        content: [embed(asideId), embed(asidePairedTextblockId)],
      });
    } else {
      content.push(embed(asideId, { align: "full" })); // no prose to pair → standalone
    }
  }
  for (const id of childIds) {
    if (memberSet.has(id)) continue; // rendered inside the lead aside, not the main flow
    if (id === asideId || id === asidePairedTextblockId) continue; // already placed in the lead column
    if (imageChildIds.has(id)) { pendingImgs.push(id); continue; }
    if (textblockChildIds.has(id) && pendingImgs.length) {
      // Section image(s) fold in front of the following prose textblock —
      // neighbor-first so the float wraps the host's prose (L-shape, reflows
      // natively). neighborWidth is the floated column's start width.
      content.push({
        type: "wrapGroup",
        attrs: { side: "right", anchorIndex: 0, neighborWidth: 260 },
        content: [...pendingImgs.map((imgId) => embed(imgId)), embed(id)],
      });
      pendingImgs = [];
    } else {
      // a textblock with no pending images, or any other child kind —
      // flush buffered images (standalone) so reading order is preserved.
      flushStandalone();
      content.push(embed(id));
    }
  }
  flushStandalone();
  return content;
}

// ----- Block parser -----
// Produces a tree of { kind, level?, text?, content?, children? } nodes
// before we mint entities. Lets us decide structure separately from
// persistence.
export function parseBlocks(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: "heading", level: h[1].length, text: stripInlineMd(h[2].trim()) });
      i++;
      continue;
    }
    // Fenced code block
    if (/^```/.test(line)) {
      const lang = line.replace(/^```/, "").trim() || null;
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { codeLines.push(lines[i]); i++; }
      i++; // skip closing ```
      // Special case: ```html ... ``` is the table-passthrough format
      // the drag-to-import HTML pipeline emits (htmlToMarkdown stashes
      // raw <table> markup here). Tag it so mintEntities can route to
      // a textblock that renders the HTML as a raw-preview chunk.
      if (lang === "html") {
        blocks.push({ kind: "htmlBlock", html: codeLines.join("\n") });
      } else {
        blocks.push({ kind: "codeBlock", lang, text: codeLines.join("\n") });
      }
      continue;
    }
    // Block-level image — a line whose entire content is `![alt](src)`.
    // Mint an artifact module so the importer produces a real media
    // node, not just an inline alt-text reference. Inline images
    // inside a prose paragraph stay handled by parseInline (Phase B).
    const blockImg = /^\s*!\[([^\]]*)\]\(((?:[^()]|\([^)]*\))*)\)\s*$/.exec(line);
    if (blockImg) {
      blocks.push({ kind: "image", alt: blockImg[1], src: blockImg[2] });
      i++;
      continue;
    }
    // Pipe table — header row, separator row, then body rows. Promotes
    // to a kind:"table" container (the other half of the Phase B table
    // path; the ```html``` fence fallback in `htmlToMarkdown` still
    // covers tables that don't survive HTML → markdown conversion).
    // Recognition: line starts with `|`, next line is the separator
    // (`| --- | --- |` or alignment variants). Anything else with a
    // leading `|` falls through to the paragraph branch unchanged.
    if (/^\s*\|/.test(line) && i + 1 < lines.length
        && /^\s*\|?\s*:?-{3,}:?(\s*\|\s*:?-{3,}:?)+\s*\|?\s*$/.test(lines[i + 1])) {
      const headerCells = splitTableRow(line);
      i += 2; // skip header + separator
      const bodyRows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i]) && lines[i].trim() !== "") {
        bodyRows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", headers: headerCells, rows: bodyRows });
      continue;
    }
    // List (unordered or ordered) — collect contiguous lines
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
        items.push(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim());
        i++;
      }
      blocks.push({ kind: "board", items });
      continue;
    }
    // Blockquote — contiguous `> ` lines (Wikipedia quotes via turndown) become a
    // dedicated `kind:"quote"` ARTIFACT (a styled quote block), not a paragraph
    // with literal `>` text. A trailing em/en-dash attribution ("— Author") is
    // split off so the renderer can show it under the quote.
    if (/^\s*>\s?/.test(line)) {
      const qLines = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        qLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      const text = qLines.join(" ").replace(/\s+/g, " ").trim();
      // AN ANNOTATION IS NOT A PULL-QUOTE, so it never gets an attribution.
      // These are prose written ABOUT a note, and prose contains em-dashes:
      // measured on the codex corpus, 54 of 460 blockquotes end in a short
      // em-dash clause, and every one would have its last sentence torn off and
      // rendered as "— …". The bracketed marker is what tells the two apart.
      const annotation = annotationLabelOf(text);
      let quote = text, attribution = "";
      if (!annotation) {
        const m = /^(.+?)\s*[—–]\s*([^—–]{2,80})$/.exec(text);
        if (m) { quote = m[1].trim(); attribution = m[2].trim(); }
      }
      if (quote) blocks.push({ kind: "quote", text: quote, attribution, annotation });
      continue;
    }
    // Horizontal rule / blank — skip
    if (/^---+$/.test(line) || /^\s*$/.test(line)) { i++; continue; }
    // Paragraph — gather until blank/heading/list/code/quote
    const paraLines = [line];
    i++;
    while (i < lines.length
      && !/^\s*$/.test(lines[i])
      && !/^#{1,6}\s/.test(lines[i])
      && !/^```/.test(lines[i])
      && !/^\s*[-*]\s+/.test(lines[i])
      && !/^\s*\d+\.\s+/.test(lines[i])
      && !/^\s*>\s?/.test(lines[i])
      && !/^---+$/.test(lines[i])
    ) {
      paraLines.push(lines[i]); i++;
    }
    blocks.push({ kind: "paragraph", text: paraLines.join(" ").trim() });
  }
  return blocks;
}

// ----- Convert blocks to a structure tree (containers + children) -----
// Headings establish nesting. Everything between two headings is the
// content of the first one.
function blocksToTree(blocks, rootTitle) {
  const root = { kind: "container", level: 0, label: rootTitle || "Imported", children: [] };
  const stack = [root];

  const peek = () => stack[stack.length - 1];

  for (const b of blocks) {
    if (b.kind === "heading") {
      // Pop until parent's level < this heading's level.
      while (stack.length > 1 && peek().level >= b.level) stack.pop();
      const node = { kind: "container", level: b.level, label: b.text, children: [] };
      peek().children.push(node);
      stack.push(node);
    } else {
      peek().children.push(b);
    }
  }
  // If the whole document sits under a single leading H1 (e.g. "# Eminem"),
  // use that heading as the root — no redundant "Imported"/title wrapper around
  // it (the page already carries the article title).
  if (root.children.length === 1 && root.children[0].kind === "container") {
    return root.children[0];
  }
  return root;
}

// ----- Mint entities from the tree -----
function mintEntities(tree, { gridId, userId, rootParentId, sourceUrl = null, sourceLabel = null }) {
  const modules = [];
  const occurrences = [];

  function buildTextblock(content, occMeta) {
    const moduleId = uid();
    const occurrenceId = uid();
    modules.push({
      id: moduleId, userId, gridId,
      role: "textblock", kind: "doc",
      label: "",
    });
    occurrences.push({
      id: occurrenceId, userId, gridId,
      moduleId, parentId: null, // parent set when added to container.occurrences
      textmap: { type: "doc", content },
      ...(occMeta ? { meta: occMeta } : {}),
    });
    return occurrenceId;
  }

  // Inline link → its own role:"textblock" kind:"inline" occurrence carrying
  // meta.link. Embedded into the surrounding paragraph via an
  // `instanceTextblockInline` node (see parseInline). The client renders it as a
  // clickable chip that flows in the sentence. Returns BOTH ids so the inline
  // node can carry occurrenceId (render/resolve) + instanceId (drag payload).
  function buildInlineLink(label, url) {
    const moduleId = uid();
    const occurrenceId = uid();
    const link = { kind: "url", url };
    const display = deriveLinkLabel(label, url);
    modules.push({
      id: moduleId, userId, gridId,
      role: "textblock", kind: "inline",
      label: display,
      meta: { link },
    });
    occurrences.push({
      id: occurrenceId, userId, gridId,
      moduleId, parentId: null,
      meta: { link },
      textmap: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: display }] }] },
    });
    return { occurrenceId, moduleId };
  }

  // A plain inline mini-textblock (role:"textblock" kind:"inline") carrying the
  // item's content (inline marks + link chips preserved via parseInline). Used as
  // the CONTENT of each bullet list item so every bullet is its own editable /
  // draggable mini-block while still living inside ONE list textblock.
  function buildInlineTextblock(text) {
    const moduleId = uid();
    const occurrenceId = uid();
    modules.push({ id: moduleId, userId, gridId, role: "textblock", kind: "inline", label: "" });
    occurrences.push({
      id: occurrenceId, userId, gridId, moduleId, parentId: null,
      textmap: { type: "doc", content: [{ type: "paragraph", content: parseInline(String(text || ""), buildInlineLink) }] },
    });
    return { occurrenceId, moduleId };
  }

  // Source-link textblock — a regular doc textblock whose paragraph holds a
  // leading "Source: " label + an inline link mini-textblock (instanceTextblockInline)
  // pointing at the original article URL. Prepended as the FIRST child of the
  // import root so the doc opens with a clickable link back to the source.
  function buildSourceLinkTextblock(url, label) {
    const { occurrenceId: linkOccId, moduleId: linkModId } = buildInlineLink(label || "View original ↗", url);
    return buildTextblock([{
      type: "paragraph",
      content: [
        { type: "text", text: "Source: " },
        { type: "instanceTextblockInline", attrs: { occurrenceId: linkOccId, instanceId: linkModId } },
      ],
    }]);
  }


  // Artifact leaf — a real role:"artifact" module with kind:"image"
  // (the dispatched renderer in modules/ArtifactCard.jsx). `fileRef`
  // holds the absolute URL for now; a future upload step can mirror
  // remote URLs into the user's /uploads dir, but the renderer
  // already serves absolute http(s):// urls via plain <img src>.
  function buildArtifactImage({ alt, src }) {
    const moduleId = uid();
    const occurrenceId = uid();
    modules.push({
      id: moduleId, userId, gridId,
      role: "artifact", kind: "image",
      label: alt || "",
      fileRef: src,
    });
    occurrences.push({
      id: occurrenceId, userId, gridId,
      moduleId, parentId: null,
      fields: {},
    });
    return occurrenceId;
  }

  // Quote → a role:"artifact" kind:"quote" occurrence. The quote text +
  // attribution live on module.meta (no fileRef); the client ArtifactCard renders
  // a styled pull-quote block (big quote mark + italic text + "— attribution").
  function buildArtifactQuote({ text, attribution, annotation }) {
    const moduleId = uid();
    const occurrenceId = uid();
    modules.push({
      id: moduleId, userId, gridId,
      role: "artifact", kind: "quote",
      label: (text || "").slice(0, 60),
      // `codexAnnotation` is written ONLY when there is one. A key that is
      // present-and-empty would read as "an annotation with no label", so an
      // ordinary quote must not carry it at all — that absence is what lets a
      // later pass filter, collapse or restyle the commentary without parsing
      // prose again.
      meta: {
        quote: text || "", attribution: attribution || "",
        ...(annotation ? { codexAnnotation: annotation } : {}),
      },
    });
    occurrences.push({
      id: occurrenceId, userId, gridId,
      moduleId, parentId: null,
      fields: {},
    });
    return occurrenceId;
  }

  // Raw-HTML preview textblock. The drag-to-import HTML pipeline
  // routes <table> chunks through this so the imported page can
  // show the table content verbatim until the user/AI promotes it
  // to a kind:"table" container. Stored as a single text node so
  // the existing textblock renderer doesn't try to interpret tags.
  function buildHtmlPreviewBlock(html) {
    const moduleId = uid();
    const occurrenceId = uid();
    modules.push({
      id: moduleId, userId, gridId,
      role: "textblock", kind: "doc",
      label: "",
      meta: { htmlPreview: true },
    });
    occurrences.push({
      id: occurrenceId, userId, gridId,
      moduleId, parentId: null,
      textmap: {
        type: "doc",
        content: [{
          type: "codeBlock",
          attrs: { language: "html" },
          content: [{ type: "text", text: html }],
        }],
      },
    });
    return occurrenceId;
  }

  // Table — a real kind:"table" container whose ContainerTable renderer
  // reads meta.table.{columns,rowCount,cells} (see
  // client/src/modules/containers/ContainerTable.jsx). Each cell is
  // stored as a TipTap doc fragment; for imports we start with plain
  // text in a paragraph (the user can promote to embeds later).
  function buildTable({ headers, rows }) {
    const moduleId = uid();
    const occurrenceId = uid();
    // Header cells arrive as raw markdown (`**Item**`) — the same strip the
    // heading path already uses, or the table renders literal asterisks and the
    // container is LABELLED "**Item**" (user, 2026-08-14).
    const cleanHeaders = headers.map((t) => (t == null ? null : stripInlineMd(String(t)).trim()));
    const columns = cleanHeaders.map((title, idx) => ({
      id: `tcol_${idx}`,
      // An explicitly EMPTY header cell stays empty (no "Column N" fallback) — the
      // infobox is emitted with blank headers so it renders without a header title.
      title: title != null ? title : `Column ${idx + 1}`,
      // Width TRACKS THE HEADER, because ContainerTable scales columns
      // PROPORTIONALLY to fit — a flat 160 gives "Key Vitamins & Nutrients" the
      // same room as "Item" and truncates it (the header renders in an <input>,
      // which cannot wrap the way a body cell does).
      width: headerWidth(title),
      displayFieldId: null,
      sort: null,
      filter: null,
      fieldVisibility: null,
      hideLabel: false,
    }));
    const cells = {};
    rows.forEach((row, r) => {
      row.forEach((value, c) => {
        if (c >= columns.length) return; // ignore extra cells past column count
        const text = String(value || "");
        cells[`${r}:${c}`] = text
          ? { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
          : { type: "doc", content: [{ type: "paragraph" }] };
      });
    });
    modules.push({
      id: moduleId, userId, gridId,
      role: "container", kind: "table",
      // The label is NOT the first header. Reusing `headers[0]` titled the
      // container after a COLUMN ("Item"), which reads as a mislabel next to the
      // section heading above it — the table is a list of rows, not an "Item"
      // (user, 2026-08-14: "make it say #### list"). Level 4 keeps it below the
      // section that contains it.
      label: TABLE_LABEL,
      meta: { headingLevel: TABLE_HEADING_LEVEL },
    });
    occurrences.push({
      id: occurrenceId, userId, gridId,
      moduleId, parentId: null,
      fields: {},
      meta: { table: { columns, rowCount: rows.length, cells } },
    });
    return occurrenceId;
  }

  // Lead "aside" — a doc container that stacks the main image + the infobox table
  // vertically. It becomes the side-by-side neighbor of the article's intro
  // textblock (see buildSectionBody). Per the user: image (artifact) + infobox
  // (kind:table) "both in a doc container … on the right of the first textblock."
  function buildAsideContainer(memberIds, label) {
    const moduleId = uid();
    const occurrenceId = uid();
    modules.push({
      id: moduleId, userId, gridId,
      role: "container", kind: "doc",
      // Labeled with the article subject ("Eminem") — an empty label rendered as a
      // generic "Container" header; the aside IS the subject's lead card. headingLevel
      // 2 so the lead card reads SMALLER than the article's H1 root header (the user:
      // "the header size should be switched between eminem and those other two, H1/H2").
      label: label || "",
      meta: { allowChildContainers: true, leadAside: true, headingLevel: 2 },
    });
    occurrences.push({
      id: occurrenceId, userId, gridId,
      moduleId, parentId: null,
      fields: {},
      occurrences: memberIds,
      textmap: { type: "doc", content: memberIds.map((id) => ({ type: "moduleEmbed", attrs: { occurrenceId: id, align: "full" } })) },
    });
    return occurrenceId;
  }

  function buildContainer(node, parentOccId, isRoot = false) {
    const moduleId = uid();
    const occurrenceId = uid();
    const moduleObj = {
      id: moduleId, userId, gridId,
      // Every section is a DOC container — it renders as a document (its textmap),
      // Children: grouped rich textblocks (prose + bullet lists + inline marks/
      // links), block images (artifacts), tables, and sub-sections — embedded
      // inline via moduleEmbed nodes so it reads top-to-bottom like the article.
      role: "container", kind: "doc",
      label: node.label || "Section",
      // Section-hierarchy headers: follow the markdown heading depth directly —
      // `#`=H1, `##`=H2, … (the synthetic root, level 0, renders as H1). The
      // container header renders at this level (see ModuleContainer).
      meta: { allowChildContainers: true, headingLevel: Math.min(node.level || 1, 6) },
    };
    modules.push(moduleObj);
    const childIds = [];
    // Image children that found no prose host render FULL-WIDTH (align:"full").
    const imageChildIds = new Set();
    // Prose textblocks (paragraphs + bullet lists) can HOST a block-wrap: an
    // adjacent image folds into a `wrapGroup` so the prose reflows beside it.
    const textblockChildIds = new Set();
    // Table containers — tracked so the ROOT can pull the lead infobox table into
    // the aside alongside the main image.
    const tableChildIds = new Set();
    // CONSECUTIVE prose paragraphs MERGE into ONE textblock (a chunk of running
    // prose is a single tall block — the user: "ours has 2 textblocks for that
    // chunk when the article shows 1"). A single tall host also wraps the lead
    // image fully (the L-notch reclaims width underneath). Any STRUCTURAL block
    // (list/code/image/table/sub-section/quote) flushes the running prose first so
    // reading order is preserved. Lists/code/etc. stay their own blocks.
    let pendingPara = [];
    const flushPara = () => {
      if (!pendingPara.length) return;
      const tbId = buildTextblock(pendingPara);
      childIds.push(tbId);
      textblockChildIds.add(tbId);
      pendingPara = [];
    };
    for (const c of node.children || []) {
      if (c.kind === "paragraph") {
        // Accumulate this paragraph's blocks (paragraphToBlocks may split out inline
        // images into their own nodes within the same textblock); a blank-line gap
        // between paragraphs is preserved as separate paragraph nodes in the block.
        pendingPara.push(...paragraphToBlocks(c.text, buildInlineLink));
        continue;
      }
      if (c.kind === "quote") {
        // The quote stays its OWN artifact block (a styled pull-quote occurrence),
        // but it's embedded INSIDE the lead-up textblock (the prose that introduces
        // it, e.g. "…who said:") via a moduleEmbed — so the quote flows right after
        // its lead-in instead of becoming a detached sibling block. Does NOT flush.
        const qId = buildArtifactQuote({ text: c.text, attribution: c.attribution, annotation: c.annotation });
        pendingPara.push({ type: "moduleEmbed", attrs: { occurrenceId: qId, align: "full" } });
        continue;
      }
      if (c.kind === "board") {
        // A bullet list JOINS the running prose chunk (same textblock as the
        // lead-in paragraph) so the bullets indent under their intro instead of
        // becoming a detached block (user: "the 2 textblocks should be one block —
        // the indentation would be off with the bulletpoints"). Each ITEM's content
        // is still its own editable/draggable mini-textblock (instanceTextblockInline).
        // Does NOT flush — a STRUCTURAL block (container/code/image/table) still does.
        const listItems = (c.items || []).map((it) => {
          // Parse the item inline (mints link chips for any [text](url)). A bullet
          // that holds a link chip CANNOT be wrapped in a mini-textblock: the inline
          // renderer (`textmapToInlineText`) flattens a mini-textblock to PLAIN TEXT
          // only, silently dropping the nested `instanceTextblockInline` chip — so a
          // discography entry `[Album](url) (1999)` rendered as just " (1999)" and a
          // pure-link "See also" entry rendered EMPTY. Those items render their inline
          // content (text + clickable chips) DIRECTLY in the list item, like prose does.
          const inline = parseInline(String(it || ""), buildInlineLink);
          if (inline.some((n) => n.type === "instanceTextblockInline")) {
            return { type: "listItem", content: [{ type: "paragraph", content: inline }] };
          }
          // Plain-text items stay their own editable/draggable mini-textblock.
          const { occurrenceId: miniOccId, moduleId: miniModId } = buildInlineTextblock(it);
          return {
            type: "listItem",
            content: [{ type: "paragraph", content: [
              { type: "instanceTextblockInline", attrs: { occurrenceId: miniOccId, instanceId: miniModId } },
            ] }],
          };
        });
        pendingPara.push({ type: "bulletList", content: listItems });
        continue;
      }
      flushPara(); // a non-prose STRUCTURAL block ends the running prose chunk
      if (c.kind === "container") {
        if (isDenylistedSection(c.label)) continue; // skip citation/nav cruft sections
        const subId = buildContainer(c, occurrenceId);
        childIds.push(subId);
      } else if (c.kind === "codeBlock") {
        childIds.push(buildTextblock([{
          type: "codeBlock",
          attrs: c.lang ? { language: c.lang } : {},
          content: [{ type: "text", text: c.text }],
        }]));
      } else if (c.kind === "htmlBlock") {
        childIds.push(buildHtmlPreviewBlock(c.html));
      } else if (c.kind === "sourceLink") {
        childIds.push(buildSourceLinkTextblock(c.url, c.label));
      } else if (c.kind === "image") {
        const imgId = buildArtifactImage({ alt: c.alt, src: c.src });
        childIds.push(imgId);
        imageChildIds.add(imgId);
      } else if (c.kind === "table") {
        const tblId = buildTable({ headers: c.headers, rows: c.rows });
        childIds.push(tblId);
        tableChildIds.add(tblId);
      }
    }
    flushPara(); // trailing prose chunk → one textblock
    // ROOT only: pull the lead image + the infobox table right after it into an
    // aside doc container that renders beside the intro textblock.
    let asideId = null;
    let asideMemberIds = [];
    // Only when the lead image is immediately followed by a table (the Wikipedia
    // infobox case) — a plain lead image with no infobox keeps the normal
    // image-beside-prose wrap, so generic imports aren't restructured.
    if (isRoot) {
      const firstImg = childIds.find((id) => imageChildIds.has(id));
      const next = firstImg ? childIds[childIds.indexOf(firstImg) + 1] : null;
      if (firstImg && next && tableChildIds.has(next)) {
        asideMemberIds = [firstImg, next];
        // The infobox table is built generically with an empty label (its header
        // cells are `| | |`), so it renders the fallback "Container" header. Give
        // the lead infobox a clear "Info" header instead (per user). Scoped to
        // this lead-infobox table only — every other imported table keeps its
        // own header[0]/empty label.
        const infoboxOcc = occurrences.find((o) => o.id === next);
        const infoboxMod = infoboxOcc && modules.find((m) => m.id === infoboxOcc.moduleId);
        if (infoboxMod) infoboxMod.label = "Info";
        asideId = buildAsideContainer(asideMemberIds, node.label);
        // The aside is paired with the first prose textblock in a two-COLUMN
        // wrapGroup (see buildSectionBody) — NOT a parent-level float. No
        // `meta.leadFloat` (the float didn't place them next to each other).
        // Give the aside a STRUCTURAL parent link in the root's occurrences[].
        // It's otherwise referenced ONLY via the root's textmap (the wrapGroup
        // embed), so it had no `parentId`/`occurrences[]` edge — making it an
        // ancestry/cascade-delete orphan AND invisible to any consumer that
        // walks the occurrence tree without parsing textmaps (e.g. the
        // subtree-scoped folder-page PREVIEW, which then rendered an empty
        // second column with the lead image unreachable). buildSectionBody
        // skips `id === asideId` in its main loop, so this does NOT double-render.
        childIds.push(asideId);
      }
    }
    occurrences.push({
      id: occurrenceId, userId, gridId,
      moduleId, parentId: parentOccId || null,
      fields: {},
      // Structural parent link (ancestry / cleanup) …
      occurrences: childIds,
      // … plus the doc body: each child embedded inline so the section renders
      // as a document. Block images fold into a `wrapGroup` with the NEXT prose
      // textblock (the host) so the text reflows beside the image — and a single
      // host can carry MULTIPLE images stacked on its side. Wikipedia puts each
      // section's image BEFORE its prose, so images are buffered until the next
      // textblock flushes them in as neighbors; the article's lead image
      // (injected right after the H1) thus wraps the intro paragraph. Images with
      // no following prose host fall back to a full-width standalone embed.
      textmap: {
        type: "doc",
        content: childIds.length
          ? buildSectionBody(childIds, { imageChildIds, textblockChildIds, asideId, asideMemberIds })
          : [{ type: "paragraph" }],
      },
    });
    return occurrenceId;
  }

  // Append a "Source: <link>" textblock as the LAST child of the root so the
  // article link sits at the BOTTOM of the doc (the top is the main image +
  // intro, not the Wikipedia link).
  if (sourceUrl) {
    tree.children = [...(tree.children || []), { kind: "sourceLink", url: sourceUrl, label: sourceLabel }];
  }
  const rootOccurrenceId = buildContainer(tree, rootParentId, true);
  return { modules, occurrences, rootOccurrenceId };
}

/**
 * Top-level entry. Returns { ok, dryRun, modules, occurrences,
 * rootOccurrenceId, stats }.
 *
 * - dryRun: don't write to Mongo — just plan and return what WOULD be
 *   created. Useful for "preview" workflows from the assistant.
 */
export async function markdownToModuli({ gridId, parentId = null, userId, markdown, dryRun = false, title = null, sourceUrl = null }) {
  const blocks = parseBlocks(markdown);
  const tree = blocksToTree(blocks, title);
  const planned = mintEntities(tree, { gridId, userId, rootParentId: parentId, sourceUrl, sourceLabel: title ? `${title} — Wikipedia ↗` : null });

  if (!dryRun) {
    // Insert in dependency order: modules first (no FK between them),
    // then occurrences. Parent occurrences reference children by id in
    // their `occurrences[]` array, so we can insert occurrences in any
    // order — the order here is parent-after-children which matches
    // the tree build order (parents push themselves AFTER recursing).
    if (planned.modules.length) await Module.insertMany(planned.modules);
    if (planned.occurrences.length) await Occurrence.insertMany(planned.occurrences);

    // If a parentId was given, append the new root to that parent's
    // occurrences[] so the new subtree shows up in the UI tree.
    if (parentId) {
      await Occurrence.findOneAndUpdate(
        { id: parentId, userId },
        { $push: { occurrences: planned.rootOccurrenceId } },
      );
    }
  }

  return {
    ok: true,
    dryRun,
    rootOccurrenceId: planned.rootOccurrenceId,
    modules: planned.modules,
    occurrences: planned.occurrences,
    stats: {
      modules: planned.modules.length,
      occurrences: planned.occurrences.length,
      containers: planned.modules.filter(m => m.role === "container").length,
      instances: planned.modules.filter(m => m.role === "instance").length,
      textblocks: planned.modules.filter(m => m.role === "textblock").length,
      artifacts: planned.modules.filter(m => m.role === "artifact").length,
    },
  };
}
