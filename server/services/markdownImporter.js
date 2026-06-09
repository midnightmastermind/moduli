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
import Module from "../models/Module.js";
import Occurrence from "../models/Occurrence.js";

const uid = () => crypto.randomUUID();

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
  const imgRe = /!\[([^\]]*)\]\(([^)]+)\)/g;
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

// `mintLink(label, url) → { occurrenceId, moduleId }` (optional). When provided,
// each [text](url) becomes an INLINE textblock occurrence (role:"textblock"
// kind:"inline" carrying meta.link) embedded via an `instanceTextblockInline`
// node — so the link renders as a clickable chip that flows in the sentence
// instead of an un-resolving inline link mark. When absent (bullet lists,
// non-prose) links stay as plain link marks.
function parseInline(text, mintLink) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    // Link: [text](url)
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)/.exec(text.slice(i));
    if (linkMatch) {
      if (mintLink) {
        const { occurrenceId, moduleId } = mintLink(linkMatch[1], linkMatch[2]);
        out.push({ type: "instanceTextblockInline", attrs: { occurrenceId, instanceId: moduleId } });
      } else {
        out.push({
          type: "text",
          text: linkMatch[1],
          marks: [{ type: "link", attrs: { href: linkMatch[2] } }],
        });
      }
      i += linkMatch[0].length;
      continue;
    }
    // Bold+italic ***x***
    const biMatch = /^\*\*\*([^*]+)\*\*\*/.exec(text.slice(i));
    if (biMatch) {
      out.push({ type: "text", text: biMatch[1], marks: [{ type: "bold" }, { type: "italic" }] });
      i += biMatch[0].length; continue;
    }
    // Bold **x**
    const boldMatch = /^\*\*([^*]+)\*\*/.exec(text.slice(i));
    if (boldMatch) {
      out.push({ type: "text", text: boldMatch[1], marks: [{ type: "bold" }] });
      i += boldMatch[0].length; continue;
    }
    // Italic *x*
    const italicMatch = /^\*([^*]+)\*/.exec(text.slice(i));
    if (italicMatch) {
      out.push({ type: "text", text: italicMatch[1], marks: [{ type: "italic" }] });
      i += italicMatch[0].length; continue;
    }
    // Inline code `x`
    const codeMatch = /^`([^`]+)`/.exec(text.slice(i));
    if (codeMatch) {
      out.push({ type: "text", text: codeMatch[1], marks: [{ type: "code" }] });
      i += codeMatch[0].length; continue;
    }
    // Plain text up to the next special token
    const nextSpecial = text.slice(i).search(/[\[*`]/);
    const stop = nextSpecial < 0 ? text.length : i + nextSpecial;
    const plain = text.slice(i, stop);
    if (plain) out.push({ type: "text", text: plain });
    if (stop === i) i++; // safety: never infinite-loop
    else i = stop;
  }
  return out.length ? out : [{ type: "text", text: "" }];
}

// ----- Block parser -----
// Produces a tree of { kind, level?, text?, content?, children? } nodes
// before we mint entities. Lets us decide structure separately from
// persistence.
function parseBlocks(markdown) {
  const lines = markdown.split(/\r?\n/);
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Heading
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: "heading", level: h[1].length, text: h[2].trim() });
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
    const blockImg = /^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/.exec(line);
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
    // Horizontal rule / blank — skip
    if (/^---+$/.test(line) || /^\s*$/.test(line)) { i++; continue; }
    // Paragraph — gather until blank/heading/list/code
    const paraLines = [line];
    i++;
    while (i < lines.length
      && !/^\s*$/.test(lines[i])
      && !/^#{1,6}\s/.test(lines[i])
      && !/^```/.test(lines[i])
      && !/^\s*[-*]\s+/.test(lines[i])
      && !/^\s*\d+\.\s+/.test(lines[i])
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

  function buildTextblock(content) {
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
    modules.push({
      id: moduleId, userId, gridId,
      role: "textblock", kind: "inline",
      label: label || "",
      meta: { link },
    });
    occurrences.push({
      id: occurrenceId, userId, gridId,
      moduleId, parentId: null,
      meta: { link },
      textmap: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: label || url }] }] },
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
    const columns = headers.map((title, idx) => ({
      id: `tcol_${idx}`,
      title: title || `Column ${idx + 1}`,
      width: 160,
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
      label: headers[0] || "Table",
    });
    occurrences.push({
      id: occurrenceId, userId, gridId,
      moduleId, parentId: null,
      fields: {},
      meta: { table: { columns, rowCount: rows.length, cells } },
    });
    return occurrenceId;
  }

  function buildContainer(node, parentOccId) {
    const moduleId = uid();
    const occurrenceId = uid();
    modules.push({
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
    });
    const childIds = [];
    // Image children render FULL-WIDTH (align:"full") in the textmap. Users can
    // re-align per-embed (float left/right) in the UI.
    const imageChildIds = new Set();
    // Each block becomes its OWN child: every paragraph → its own textblock,
    // every list → ONE textblock holding a bulletList, sub-sections → nested doc
    // containers, images → artifacts, tables → table containers. (Paragraphs are
    // NOT merged — the user wants one textblock per paragraph in the section.)
    for (const c of node.children || []) {
      if (c.kind === "container") {
        childIds.push(buildContainer(c, occurrenceId));
      } else if (c.kind === "paragraph") {
        childIds.push(buildTextblock(paragraphToBlocks(c.text, buildInlineLink)));
      } else if (c.kind === "board") {
        childIds.push(buildTextblock([{
          type: "bulletList",
          content: (c.items || [])
            .map((it) => ({ type: "listItem", content: [{ type: "paragraph", content: parseInline(String(it || "")) }] })),
        }]));
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
        childIds.push(buildTable({ headers: c.headers, rows: c.rows }));
      }
    }
    occurrences.push({
      id: occurrenceId, userId, gridId,
      moduleId, parentId: parentOccId || null,
      fields: {},
      // Structural parent link (ancestry / cleanup) …
      occurrences: childIds,
      // … plus the doc body: each child embedded inline so the section renders
      // as a document. Empty sections keep TipTap's non-empty-doc invariant.
      textmap: {
        type: "doc",
        content: childIds.length
          ? childIds.map((id) => {
              const attrs = { occurrenceId: id };
              if (imageChildIds.has(id)) attrs.align = "full"; // full-width image
              return { type: "moduleEmbed", attrs };
            })
          : [{ type: "paragraph" }],
      },
    });
    return occurrenceId;
  }

  // Prepend a "Source: <link>" textblock as the FIRST child of the root so the
  // imported doc opens with a clickable link back to the original article.
  if (sourceUrl) {
    tree.children = [{ kind: "sourceLink", url: sourceUrl, label: sourceLabel }, ...(tree.children || [])];
  }
  const rootOccurrenceId = buildContainer(tree, rootParentId);
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
