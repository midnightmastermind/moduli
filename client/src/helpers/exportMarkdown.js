// helpers/exportMarkdown.js
// An occurrence and everything under it, back to markdown (user, 2026-10-23: "an export to markdown button in the
// radial menu that takes my occurances and turns it back into markdown and exports it").
//
// The reverse of the importer (server/services/markdownImporter): a container or page is a heading and its
// contents one level down; a textblock is its text; a row is a list item with its field values; a table is a pipe
// table; a picture is `![]()`, any other file a link. A DOC shows what its text embeds, so a doc is exported by
// walking its text (embeds in place); a board/list exports the children it lists, in order.
import { resolveFileRef } from "./fileRef";

// A file's address, absolute, so the link still works once the .md leaves the app.
function fileUrl(ref) {
  if (!ref) return "";
  const u = resolveFileRef(ref) || "";
  return u.startsWith("/") && typeof window !== "undefined" && window.location?.origin ? window.location.origin + u : u;
}

const MAX_DEPTH = 24;

// ── TipTap JSON → markdown (also the doc toolbar's "MD" download) ──
const markText = (node) => {
  let t = node.text || "";
  for (const mark of node.marks || []) {
    if (mark.type === "bold") t = `**${t}**`;
    else if (mark.type === "italic") t = `*${t}*`;
    else if (mark.type === "strike") t = `~~${t}~~`;
    else if (mark.type === "code") t = `\`${t}\``;
    else if (mark.type === "link" && mark.attrs?.href) t = `[${t}](${mark.attrs.href})`;
  }
  return t;
};

/**
 * `embed(occurrenceId, depth)` returns the markdown for an embedded occurrence (a block) and
 * `inline(occurrenceId)` the text of an inline chip; both optional, so a bare doc still converts.
 */
export function tiptapToMarkdown(node, opts = {}, depth = 0) {
  if (!node) return "";
  const { embed, inline, headingBase = 0 } = opts;
  const kids = (list = node.content) => (list || []).map((c) => tiptapToMarkdown(c, opts, depth)).join("");
  switch (node.type) {
    case "doc": return kids();
    case "paragraph": { const c = kids(); return c ? c + "\n\n" : ""; }
    case "heading": {
      const level = Math.min(6, (node.attrs?.level || 1) + headingBase);
      return "#".repeat(level) + " " + kids().replace(/\n+$/, "") + "\n\n";
    }
    case "bulletList": return (node.content || []).map((li) => listItem(li, "- ", opts, depth)).join("") + (depth === 0 ? "\n" : "");
    case "orderedList": return (node.content || []).map((li, i) => listItem(li, `${(node.attrs?.start || 1) + i}. `, opts, depth)).join("") + (depth === 0 ? "\n" : "");
    case "taskList": return (node.content || []).map((li) => listItem(li, li.attrs?.checked ? "- [x] " : "- [ ] ", opts, depth)).join("") + (depth === 0 ? "\n" : "");
    case "listItem": case "taskItem": return listItem(node, "- ", opts, depth);
    case "blockquote": return kids().trim().split("\n").map((l) => (l ? "> " + l : ">")).join("\n") + "\n\n";
    case "codeBlock": return "```" + (node.attrs?.language || "") + "\n" + (node.content || []).map((c) => c.text || "").join("") + "\n```\n\n";
    case "horizontalRule": return "---\n\n";
    case "hardBreak": return "  \n";
    case "text": return markText(node);
    case "image": return `![${node.attrs?.alt || ""}](${node.attrs?.src || ""})\n\n`;
    case "table": {
      const rows = (node.content || []).map((row) => (row.content || []).map((cell) =>
        (cell.content || []).map((p) => tiptapToMarkdown(p, opts, depth)).join("").replace(/\n+/g, " ").trim().replace(/\|/g, "\\|")));
      return pipeTable(rows);
    }
    case "fieldPill": return `#${node.attrs?.fieldName || node.attrs?.fieldId || "field"}`;
    case "instancePill": return node.attrs?.instanceLabel || "";
    case "instanceTextblockInline": return inline?.(node.attrs?.occurrenceId) ?? "";
    case "moduleEmbed": case "instanceTextblock": return embed?.(node.attrs?.occurrenceId, depth) ?? "";
    case "wrapGroup": return kids();
    default: return kids();
  }
}

function listItem(li, prefix, opts, depth) {
  const indent = "  ".repeat(depth);
  const parts = (li.content || []).map((c) => (c.type === "bulletList" || c.type === "orderedList" || c.type === "taskList")
    ? tiptapToMarkdown(c, opts, depth + 1)
    : tiptapToMarkdown(c, opts, depth).replace(/\n+$/, "") + "\n");
  return indent + prefix + parts.join("").replace(/^\s+/, "");
}

function pipeTable(rows) {
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill("")];
  const line = (r) => "| " + pad(r).join(" | ") + " |";
  return [line(rows[0]), "| " + Array(width).fill("---").join(" | ") + " |", ...rows.slice(1).map(line)].join("\n") + "\n\n";
}

// ── occurrences → markdown ──
const nameOf = (occ, mod) => (typeof occ?.label === "string" && occ.label.trim()) || mod?.meta?.originalName || mod?.label || "";

function fieldValueText(field, raw, maps) {
  const v = raw && typeof raw === "object" && !Array.isArray(raw) && "value" in raw ? raw.value : raw;
  if (v == null || v === "" || (Array.isArray(v) && !v.length)) return null;
  const one = (x) => {
    if (field?.type === "occurrence") {
      const o = maps.occurrencesById[x];
      return o ? nameOf(o, maps.modulesById[o.moduleId]) || String(x) : String(x);
    }
    if (field?.type === "boolean") return x ? "yes" : "no";
    if (field?.type === "date" && typeof x === "string") return x.slice(0, 10);
    if (field?.type === "duration" && Number.isFinite(Number(x))) { const m = Number(x); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; }
    if (typeof x === "object") return x.label || x.address || JSON.stringify(x);
    return String(x);
  };
  return Array.isArray(v) ? v.map(one).join(", ") : one(v);
}

/** "Field: value" for each visible bound field that holds something. */
export function fieldSummary(occ, mod, maps) {
  const out = [];
  for (const b of mod?.fieldBindings || []) {
    if (b.hidden) continue;
    const f = maps.fieldsById[b.fieldId];
    if (!f || f.trashed) continue;
    const t = fieldValueText(f, occ.fields?.[b.fieldId], maps);
    if (t != null) out.push(`${f.name}: ${t}`);
  }
  return out;
}

function tableToMarkdown(occ, maps, render) {
  const t = occ.meta?.table;
  if (!t?.columns?.length) return "";
  const cell = (doc) => (doc ? render(doc).replace(/\n+/g, " ").trim().replace(/\|/g, "\\|") : "");
  const rows = [t.columns.map((c) => c.title || "")];
  for (let r = 0; r < (t.rowCount || 0); r++) rows.push(t.columns.map((_, c) => cell(t.cells?.[`${r}:${c}`])));
  return pipeTable(rows);
}

/**
 * Markdown for `occId` and everything under it.
 * @param maps { occurrencesById, modulesById, fieldsById }
 */
export function occurrenceToMarkdown(occId, maps) {
  const m = { occurrencesById: {}, modulesById: {}, fieldsById: {}, ...maps };
  const seen = new Set();

  const inline = (id) => {
    const o = m.occurrencesById[id];
    if (!o) return "";
    const mod = m.modulesById[o.moduleId];
    const text = o.textmap ? tiptapToMarkdown(o.textmap, { inline }).replace(/\n+/g, " ").trim() : nameOf(o, mod);
    const link = o.meta?.link || mod?.meta?.link;
    return link?.url ? `[${text || link.url}](${link.url})` : text;
  };

  const docText = (o, level) => tiptapToMarkdown(o.textmap, {
    inline,
    headingBase: Math.max(0, level - 1),
    embed: (id) => node(id, level, true),
  });

  // `level` = heading level for this occurrence's own name; `inDoc` = drawn inside a doc's text.
  function node(id, level, inDoc = false) {
    if (!id || seen.has(id) || seen.size > 5000) return "";
    const o = m.occurrencesById[id];
    if (!o) return "";
    seen.add(id);
    const mod = m.modulesById[o.moduleId] || {};
    // A header bound to a field (meta.headerLink) shows that field's value in the app — so does the export.
    const headerFid = mod.meta?.headerLink?.selfField || o.meta?.headerLink?.selfField || null;
    const headerText = headerFid ? fieldValueText(m.fieldsById[headerFid], o.fields?.[headerFid], m) : null;
    const name = headerText || nameOf(o, mod);
    const lvl = Math.min(6, level);
    const fields = fieldSummary(o, mod, m).filter((f) => !headerText || !f.startsWith(`${m.fieldsById[headerFid]?.name}: `));
    // Fields are sub-items under whatever they belong to (user, 2026-10-23: "include the fields … as subscript items").
    const fieldList = (indent = "") => fields.map((f) => `${indent}- ${f}\n`).join("");
    const heading = name ? "#".repeat(lvl) + " " + name + "\n\n" + (fields.length ? fieldList() + "\n" : "") : (fields.length ? fieldList() + "\n" : "");
    const role = mod.role;

    if (role === "artifact") {
      const url = fileUrl(mod.fileRef);
      const under = fields.length ? fieldList() + "\n" : "";
      if (mod.kind === "image") return `![${name}](${url})\n\n` + under;
      if (o.textmap && mod.kind === "markdown") return docText(o, level + 1) + under;
      return (url ? `[${name || "file"}](${url})\n\n` : (name ? name + "\n\n" : "")) + under;
    }
    if (role === "textblock") {
      const link = o.meta?.link || mod.meta?.link;
      const body = o.textmap ? docText(o, level + 1) : "";
      const under = fields.length ? fieldList() + "\n" : "";
      if (link?.url && !body.trim()) return `[${name || link.url}](${link.url})\n\n` + under;
      return body + under;
    }
    if (role === "instance") {
      const line = `- ${name || "Untitled"}\n` + fieldList("  ");
      const body = o.textmap ? docText(o, level + 1).trim() : "";
      return line + (body ? body.split("\n").map((l) => (l ? "  " + l : "")).join("\n") + "\n" : "") + (inDoc ? "\n" : "");
    }
    // A container or a page.
    if (mod.kind === "table") return heading + tableToMarkdown(o, m, (doc) => tiptapToMarkdown(doc, { inline }));
    if (mod.kind === "doc" && o.textmap) {
      const text = docText(o, level + 1);
      // Children the doc lists but its text does not embed still belong to it — they follow the text.
      const rest = (o.occurrences || []).filter((cid) => !seen.has(cid)).map((cid) => node(cid, level + 1)).join("");
      return heading + text + rest;
    }
    if (level - 1 > MAX_DEPTH) return heading;
    const parts = (o.occurrences || []).map((cid) => node(cid, level + 1));
    const rowsEnd = parts.length && /\n$/.test(parts[parts.length - 1]) && !/\n\n$/.test(parts[parts.length - 1]) ? "\n" : "";
    return heading + parts.join("") + rowsEnd;
  }

  return node(occId, 1).replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/** A file name from a title: letters, numbers, spaces, dashes. */
export function markdownFileName(title) {
  const base = String(title || "export").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "export";
  return `${base}.md`;
}

/** Download `text` as a .md file. */
export function downloadMarkdown(text, title) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = markdownFileName(title);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
