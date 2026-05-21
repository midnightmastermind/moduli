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
function parseInline(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    // Link: [text](url)
    const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)/.exec(text.slice(i));
    if (linkMatch) {
      out.push({
        type: "text",
        text: linkMatch[1],
        marks: [{ type: "link", attrs: { href: linkMatch[2] } }],
      });
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
    // List (unordered or ordered) — collect contiguous lines
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) {
        items.push(lines[i].replace(/^\s*(?:[-*]|\d+\.)\s+/, "").trim());
        i++;
      }
      blocks.push({ kind: "list", items });
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
  return root;
}

// ----- Mint entities from the tree -----
function mintEntities(tree, { gridId, userId, rootParentId }) {
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

  function buildInstanceLeaf(label) {
    const moduleId = uid();
    const occurrenceId = uid();
    modules.push({
      id: moduleId, userId, gridId,
      role: "instance", kind: "list",
      label,
    });
    occurrences.push({
      id: occurrenceId, userId, gridId,
      moduleId, parentId: null,
      fields: {},
    });
    return occurrenceId;
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

  function buildContainer(node, parentOccId) {
    const moduleId = uid();
    const occurrenceId = uid();
    modules.push({
      id: moduleId, userId, gridId,
      role: "container", kind: "list",
      label: node.label || "Section",
    });
    const childIds = [];
    for (const c of node.children || []) {
      if (c.kind === "container") {
        childIds.push(buildContainer(c, occurrenceId));
      } else if (c.kind === "list") {
        for (const item of c.items) {
          childIds.push(buildInstanceLeaf(item));
        }
      } else if (c.kind === "paragraph") {
        childIds.push(buildTextblock([{ type: "paragraph", content: parseInline(c.text) }]));
      } else if (c.kind === "codeBlock") {
        childIds.push(buildTextblock([{
          type: "codeBlock",
          attrs: c.lang ? { language: c.lang } : {},
          content: [{ type: "text", text: c.text }],
        }]));
      } else if (c.kind === "htmlBlock") {
        childIds.push(buildHtmlPreviewBlock(c.html));
      } else if (c.kind === "image") {
        childIds.push(buildArtifactImage({ alt: c.alt, src: c.src }));
      }
    }
    occurrences.push({
      id: occurrenceId, userId, gridId,
      moduleId, parentId: parentOccId || null,
      fields: {},
      occurrences: childIds,
    });
    return occurrenceId;
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
export async function markdownToModuli({ gridId, parentId = null, userId, markdown, dryRun = false, title = null }) {
  const blocks = parseBlocks(markdown);
  const tree = blocksToTree(blocks, title);
  const planned = mintEntities(tree, { gridId, userId, rootParentId: parentId });

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
