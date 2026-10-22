// modules/FileTextReaders.jsx
// ============================================================================
// Readers for files whose content is TEXT: code, CSV/TSV tables, markdown and
// plain text. User, 2026-10-22: "we should show the book reader and have a code
// reader as well. csv should be a table already ... markdown as well" — and on
// the choice: keep the FILE, show it as a table / formatted text wherever it is
// embedded, read from the file itself. (The intake sheet still asks; its
// Import-as-a-tree / Table shapes are unchanged.)
//
// The content is fetched from the file, never copied into the occurrence, so an
// edit to the file is what you see. Markdown is rendered with `marked` and
// cleaned with DOMPurify before it touches the page — the file is whatever was
// dropped, and a dropped file must not be able to run script here. Both load
// on first use.
// ============================================================================
import React, { useEffect, useMemo, useRef, useState } from "react";
import { resolveFileRef } from "../helpers/fileRef.js";
import "highlight.js/styles/atom-one-dark.css";

// Extension → highlight.js language id. Common cases only; anything not in
// the map falls through to highlightAuto.
export const EXT_TO_LANG = {
  js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java",
  c: "c", h: "c", cpp: "cpp", hpp: "cpp", cs: "csharp", swift: "swift",
  kt: "kotlin", scala: "scala", php: "php", pl: "perl", lua: "lua",
  sh: "bash", bash: "bash", zsh: "bash", fish: "bash",
  json: "json", yaml: "yaml", yml: "yaml", toml: "ini", ini: "ini",
  xml: "xml", html: "xml", svg: "xml",
  css: "css", scss: "scss", sass: "scss", less: "less",
  md: "markdown", markdown: "markdown",
  sql: "sql", graphql: "graphql", dockerfile: "dockerfile",
  vue: "xml", svelte: "xml",
};

const extOf = (s) => {
  const m = /\.([A-Za-z0-9]+)$/.exec(String(s || ""));
  return m ? m[1].toLowerCase() : "";
};

/** The language for a file. The ORIGINAL name first: a Drive ref (gdrive:<conn>:<id>) has no extension. */
export function langForFile(originalName, fileRef) {
  return EXT_TO_LANG[extOf(originalName)] || EXT_TO_LANG[extOf(fileRef)] || null;
}

/**
 * Which reader a file gets, or null for none. "markdown" is also the catch-all kind for any upload the
 * server does not recognise (a .docx, a .zip), so under that kind only NAMED text formats get a reader —
 * fetching anything else as text would paint binary.
 */
export function fileReaderKind(kind, name) {
  if (kind === "code") return "code";
  if (kind === "pdf" || kind === "ebook") return "book";
  if (kind !== "markdown") return null;
  const ext = extOf(name);
  if (ext === "csv") return "csv";
  if (ext === "tsv") return "tsv";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "txt" || ext === "text" || ext === "log") return "text";
  return null;
}

/** CSV/TSV → rows of cells. Quotes may hold the delimiter, a newline, or a doubled quote. */
export function parseDelimited(text, delim = ",") {
  const rows = [];
  let row = [], cell = "", q = false;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Markdown → sanitized HTML. */
export async function renderMarkdownSafe(md) {
  const [{ marked }, { default: DOMPurify }] = await Promise.all([import("marked"), import("dompurify")]);
  return DOMPurify.sanitize(marked.parse(String(md || ""), { async: false }));
}

function useFileText(src) {
  const [state, setState] = useState({ text: null, error: null });
  useEffect(() => {
    if (!src) return undefined;
    let live = true;
    setState({ text: null, error: null });
    fetch(src)
      .then((r) => (r.ok ? r.text() : Promise.reject(r.status)))
      .then((text) => { if (live) setState({ text, error: null }); })
      .catch(() => { if (live) setState({ text: null, error: "Could not load the file" }); });
    return () => { live = false; };
  }, [src]);
  return state;
}

const Note = ({ children }) => <div className="file-reader-note">{children}</div>;

function CodeReader({ src, originalName, fileRef }) {
  const { text, error } = useFileText(src);
  const [hljs, setHljs] = useState(null);
  useEffect(() => {
    let live = true;
    import("highlight.js").then((m) => { if (live) setHljs(() => m.default); });
    return () => { live = false; };
  }, []);
  const lang = langForFile(originalName, fileRef);
  const html = useMemo(() => {
    if (text == null || !hljs) return null;
    try { return lang && hljs.getLanguage(lang) ? hljs.highlight(text, { language: lang, ignoreIllegals: true }).value : hljs.highlightAuto(text).value; }
    catch { return null; }
  }, [text, hljs, lang]);
  if (error) return <Note>{error}</Note>;
  if (text == null) return <Note>Loading…</Note>;
  return (
    <pre className="file-reader-code hljs">
      {html != null ? <code dangerouslySetInnerHTML={{ __html: html }} /> : <code>{text}</code>}
    </pre>
  );
}

function TableReader({ src, delim }) {
  const { text, error } = useFileText(src);
  const rows = useMemo(() => (text == null ? null : parseDelimited(text, delim)), [text, delim]);
  if (error) return <Note>{error}</Note>;
  if (!rows) return <Note>Loading…</Note>;
  if (!rows.length) return <Note>Empty file</Note>;
  const [head, ...body] = rows;
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => Array.from({ length: width }, (_, i) => r[i] ?? "");
  return (
    <table className="file-reader-table">
      <thead><tr>{pad(head).map((c, i) => <th key={i}>{c}</th>)}</tr></thead>
      <tbody>{body.map((r, ri) => <tr key={ri}>{pad(r).map((c, i) => <td key={i}>{c}</td>)}</tr>)}</tbody>
    </table>
  );
}

function MarkdownReader({ src }) {
  const { text, error } = useFileText(src);
  const [html, setHtml] = useState(null);
  useEffect(() => {
    if (text == null) return undefined;
    let live = true;
    renderMarkdownSafe(text).then((h) => { if (live) setHtml(h); }).catch(() => { if (live) setHtml(null); });
    return () => { live = false; };
  }, [text]);
  if (error) return <Note>{error}</Note>;
  if (html == null) return <Note>Loading…</Note>;
  return <div className="file-reader-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

function TextReader({ src }) {
  const { text, error } = useFileText(src);
  if (error) return <Note>{error}</Note>;
  if (text == null) return <Note>Loading…</Note>;
  return <pre className="file-reader-text">{text}</pre>;
}

/** Mount children only once the box has been on screen — a board of files must not fetch them all. */
export function MountWhenVisible({ children, className = "", style }) {
  const ref = useRef(null);
  const [seen, setSeen] = useState(typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (seen || !ref.current) return undefined;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: "300px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return <div ref={ref} className={className} style={style}>{seen ? children : null}</div>;
}

/** The text reader for `readerKind` (code / csv / tsv / markdown / text). Books are BookReader's. */
export default function FileTextReader({ readerKind, fileRef, originalName }) {
  const src = fileRef ? resolveFileRef(fileRef) : null;
  if (!src) return <Note>No file</Note>;
  if (readerKind === "code") return <CodeReader src={src} originalName={originalName} fileRef={fileRef} />;
  if (readerKind === "csv") return <TableReader src={src} delim="," />;
  if (readerKind === "tsv") return <TableReader src={src} delim={"\t"} />;
  if (readerKind === "markdown") return <MarkdownReader src={src} />;
  if (readerKind === "text") return <TextReader src={src} />;
  return null;
}
