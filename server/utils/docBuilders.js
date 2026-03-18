// utils/docBuilders.js
// TipTap document builder helpers used by createDefaultUserData.js

import fs from "fs";

// Convert inline markdown to TipTap content nodes.
// ***text*** → bold+italic, **text** → bold, *text* → italic.
// Note: "* text" at line start is a bullet POINT — handled in makeDocContent, not here.
export function inlineToTipTap(text) {
  const nodes = [];
  // Match *** or ** or * (greedy-longest first via alternation order)
  const regex = /(\*{3}|\*{2}|\*)([^*]+)\1/g;
  let lastIndex = 0;
  for (const match of text.matchAll(regex)) {
    if (match.index > lastIndex) {
      nodes.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }
    const marks = [];
    const len = match[1].length;
    if (len === 2 || len === 3) marks.push({ type: "bold" });
    if (len === 1 || len === 3) marks.push({ type: "italic" });
    nodes.push(marks.length
      ? { type: "text", text: match[2], marks }
      : { type: "text", text: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push({ type: "text", text: text.slice(lastIndex) });
  return nodes.length ? nodes : [{ type: "text", text: text || "" }];
}

// Convert raw markdown lines to a TipTap doc.
// Handles: * bullet / - bullet → bulletList, ## heading → heading node,
// **bold** / *italic* inline → marks, blank lines / "---" → flush/skip.
export function makeDocContent(lines) {
  const nodes = [];
  let bulletItems = [];

  function flushBullets() {
    if (bulletItems.length === 0) return;
    nodes.push({
      type: "bulletList",
      content: bulletItems.map(item => ({
        type: "listItem",
        content: [{ type: "paragraph", content: inlineToTipTap(item) }],
      })),
    });
    bulletItems = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") { flushBullets(); continue; }
    // Bullet point: * text or - text (asterisk/hyphen + space required)
    const bulletMatch = trimmed.match(/^[*-]\s+(.+)/);
    if (bulletMatch) { bulletItems.push(bulletMatch[1]); continue; }
    flushBullets();
    // Markdown heading: ## text (any level)
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      nodes.push({ type: "heading", attrs: { level: headingMatch[1].length }, content: inlineToTipTap(headingMatch[2]) });
      continue;
    }
    // Image: ![alt](url)
    const imageMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
    if (imageMatch) {
      nodes.push({ type: "image", attrs: { src: imageMatch[2], alt: imageMatch[1] || null, title: null } });
      continue;
    }
    // Regular paragraph (may contain **bold**, *italic*, ***both***)
    const content = inlineToTipTap(trimmed);
    if (content.some(n => n.text)) nodes.push({ type: "paragraph", content });
  }
  flushBullets();
  if (nodes.length === 0) nodes.push({ type: "paragraph", content: [{ type: "text", text: "" }] });
  return { type: "doc", content: nodes };
}

// Builds a merged TipTap document from multiple sections (title + section headings + content)
export function buildMergedDocTextmap(title, sections) {
  const content = [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: title }] },
  ];
  for (const section of sections) {
    if (section.heading) {
      content.push({ type: "heading", attrs: { level: section.headingLevel || 2 }, content: inlineToTipTap(section.heading) });
    }
    if (section.lines && section.lines.length > 0) {
      const bodyNodes = makeDocContent(section.lines).content
        .filter(n => n.type !== "paragraph" || (n.content && n.content.some(c => c.text && c.text.trim())));
      content.push(...bodyNodes);
    }
  }
  return { type: "doc", content };
}

// Parse stan.txt — [Section: Author] bracket format → [{ heading, lines }]
// Skips "Produced by" and "You might also like" blocks.
export function parseStanSections(filePath) {
  let raw = "";
  try { raw = fs.readFileSync(filePath, "utf-8"); } catch { return []; }
  const sections = [];
  let current = null;
  let skip = false;
  for (const line of raw.split("\n")) {
    const m = line.trim().match(/^\[(.+?)\]$/);
    if (m) {
      if (current?.lines.length) sections.push(current);
      const heading = m[1];
      if (heading.startsWith("Produced by")) { current = null; skip = false; continue; }
      skip = false;
      current = { heading, lines: [] };
    } else if (current) {
      const t = line.trim();
      if (t === "You might also like") { skip = true; continue; }
      if (skip) continue;
      if (t) current.lines.push(t);
    }
  }
  if (current?.lines.length) sections.push(current);
  return sections;
}

// Build container-level textmap: heading (default H2) + body nodes.
// headingContent: TipTap node array or plain string (auto-converted); bodyNodes: TipTap block node array
// headingLevel: 2 for morenotes/gospel/journal sections (default), 3 for stan verses
export function makeNotebookContainerDocContent(headingContent, bodyNodes, headingLevel = 2) {
  const hContent = Array.isArray(headingContent)
    ? headingContent
    : inlineToTipTap(String(headingContent));
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: headingLevel }, content: hContent },
      ...bodyNodes,
    ],
  };
}
