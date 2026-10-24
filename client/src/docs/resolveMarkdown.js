// docs/resolveMarkdown.js — raw markdown sitting in a document's text, resolved into formatting.
//
// Typing `### ` or `**x**` is resolved by the editor's input rules as you type. Text that ARRIVES already written —
// a paste, an import, a line typed before a level existed — keeps its `#`s and `*`s as characters (user, 2026-10-24,
// on the CPS application: "#### Reflection Questions" and "*…*" stayed raw, and an empty pasted table drew a box).
// This turns such lines and runs into what they mean. Pure, over TipTap JSON, idempotent.
//
//   a paragraph starting `#`..`######` + space   → heading of that level
//   consecutive paragraphs starting `- ` `* ` `+ ` → a bullet list; `1. ` `2) ` → a numbered list
//   a paragraph starting `> `                      → a quote
//   a ``` line … a ``` line                        → a code block (the lines between, verbatim)
//   `**x**` `__x__` → bold · `*x*` `_x_` → italic · `` `x` `` → code · `~~x~~` → strike (inside text, never across)
//   a table with no text in it                     → removed (after a paste only)
// `skip` (a set of top-level indexes) leaves blocks alone — the line being edited.

const INLINE = [
  { re: /\*\*([^*\n]+?)\*\*/, mark: "bold" },
  { re: /__([^_\n]+?)__/, mark: "bold" },
  { re: /~~([^~\n]+?)~~/, mark: "strike" },
  { re: /`([^`\n]+)`/, mark: "code" },
  { re: /(^|[^*\w])\*([^*\s][^*\n]*?)\*(?![*\w])/, mark: "italic", lead: true },
  { re: /(^|[^_\w])_([^_\s][^_\n]*?)_(?![_\w])/, mark: "italic", lead: true },
];

/** Split one text node by inline markdown; returns the replacement nodes. */
function resolveTextNode(node) {
  if (node.type !== "text" || !node.text) return [node];
  if ((node.marks || []).some((m) => m.type === "code" || m.type === "link")) return [node];
  for (const { re, mark, lead } of INLINE) {
    const m = re.exec(node.text);
    if (!m) continue;
    const prefix = lead ? m[1] : "";
    const inner = lead ? m[2] : m[1];
    const start = m.index + prefix.length;
    const end = m.index + m[0].length;
    const marks = node.marks || [];
    const piece = (text, extra) => (text ? [{ ...node, text, ...(extra || marks.length ? { marks: [...marks, ...(extra ? [{ type: extra }] : [])] } : {}) }] : []);
    const before = node.text.slice(0, start);
    const after = node.text.slice(end);
    const strip = (n) => { const o = { ...n }; if (!o.marks?.length) delete o.marks; return o; };
    return [
      ...resolveTextNode({ ...node, text: before }).filter((n) => n.text),
      ...piece(inner, mark).map(strip),
      ...resolveTextNode({ ...node, text: after }).filter((n) => n.text),
    ];
  }
  return [node];
}

function resolveInline(content) {
  if (!Array.isArray(content)) return content;
  const out = [];
  for (const n of content) out.push(...(n.type === "text" ? resolveTextNode(n) : [n]));
  // merge adjacent text with identical marks
  const merged = [];
  for (const n of out) {
    const prev = merged[merged.length - 1];
    if (prev?.type === "text" && n.type === "text" && JSON.stringify(prev.marks || []) === JSON.stringify(n.marks || [])) prev.text += n.text;
    else merged.push({ ...n });
  }
  return merged;
}

const plainText = (node) => (node.text || "") + (node.content || []).map(plainText).join("");

/** Remove `n` leading characters from a paragraph's inline content. */
function dropLeading(content, n) {
  const out = [];
  let left = n;
  for (const c of content || []) {
    if (left > 0 && c.type === "text") {
      if (c.text.length <= left) { left -= c.text.length; continue; }
      out.push({ ...c, text: c.text.slice(left) }); left = 0; continue;
    }
    out.push(c);
  }
  return out;
}

const HEADING = /^\s{0,3}(#{1,6})\s+(?=\S)/;
const BULLET = /^\s{0,3}[-*+]\s+(?=\S)/;
const NUMBERED = /^\s{0,3}(\d{1,3})[.)]\s+(?=\S)/;
const QUOTE = /^\s{0,3}>\s?(?=\S)/;

function tableIsEmpty(t) { return !plainText(t).trim() && !JSON.stringify(t).includes('"type":"image"'); }

function resolveBlock(node) {
  if (node.type === "paragraph" || node.type === "heading") {
    const content = resolveInline(node.content);
    if (node.type === "paragraph") {
      const text = plainText({ content });
      const h = HEADING.exec(text);
      if (h) return { type: "heading", attrs: { level: h[1].length }, content: dropLeading(content, h[0].length) };
    }
    return content === node.content ? node : { ...node, ...(content ? { content } : {}) };
  }
  if (Array.isArray(node.content) && node.type !== "codeBlock" && node.type !== "table") {
    return { ...node, content: resolveBlocks(node.content).blocks };  // nested blocks: never drops tables
  }
  return node;
}

/** Resolve a list of block nodes; `skip` = indexes left as they are. */
export function resolveBlocks(blocks, skip = new Set(), { dropEmptyTables = false } = {}) {
  const out = [];
  let changed = false;
  for (let i = 0; i < blocks.length; i++) {
    const node = blocks[i];
    if (skip.has(i)) { out.push(node); continue; }
    // Only a PASTE drops an empty table (a web form's layout box); one you just inserted is about to be filled.
    if (dropEmptyTables && node.type === "table" && tableIsEmpty(node)) { changed = true; continue; }
    if (node.type === "paragraph") {
      const text = plainText(node);
      // A fenced block: ``` (optionally a language) … ``` — the lines between are code, verbatim.
      const fence = /^\s{0,3}```\s*([\w+-]*)\s*$/.exec(text);
      if (fence) {
        let j = i + 1;
        while (j < blocks.length && !skip.has(j) && !(blocks[j].type === "paragraph" && /^\s{0,3}```\s*$/.test(plainText(blocks[j])))) j++;
        if (j < blocks.length && !skip.has(j)) {
          const code = blocks.slice(i + 1, j).map(plainText).join("\n");
          out.push({ type: "codeBlock", attrs: { language: fence[1] || null }, ...(code ? { content: [{ type: "text", text: code }] } : {}) });
          changed = true;
          i = j;
          continue;
        }
      }
      // A run of list lines becomes one list.
      const listKind = BULLET.test(text) ? "bulletList" : NUMBERED.test(text) ? "orderedList" : null;
      if (listKind) {
        const re = listKind === "bulletList" ? BULLET : NUMBERED;
        const items = [];
        let j = i;
        let startAt = null;
        while (j < blocks.length && !skip.has(j) && blocks[j].type === "paragraph" && re.test(plainText(blocks[j]))) {
          const m = re.exec(plainText(blocks[j]));
          if (startAt == null && listKind === "orderedList") startAt = Number(m[1]);
          items.push({ type: "listItem", content: [{ type: "paragraph", content: resolveInline(dropLeading(blocks[j].content, m[0].length)) }] });
          j++;
        }
        out.push(listKind === "orderedList" ? { type: "orderedList", attrs: { start: startAt || 1 }, content: items } : { type: "bulletList", content: items });
        changed = true;
        i = j - 1;
        continue;
      }
      const q = QUOTE.exec(text);
      if (q) {
        out.push({ type: "blockquote", content: [resolveBlock({ ...node, content: dropLeading(node.content, q[0].length) })] });
        changed = true;
        continue;
      }
    }
    const r = resolveBlock(node);
    if (JSON.stringify(r) !== JSON.stringify(node)) changed = true;
    out.push(r);
  }
  return { blocks: out, changed };
}

/** A whole TipTap doc, resolved. Returns { doc, changed }. */
export function resolveMarkdownDoc(doc, { skip, dropEmptyTables = false } = {}) {
  if (!doc || !Array.isArray(doc.content)) return { doc, changed: false };
  const { blocks, changed } = resolveBlocks(doc.content, skip || new Set(), { dropEmptyTables });
  return { doc: changed ? { ...doc, content: blocks } : doc, changed };
}
