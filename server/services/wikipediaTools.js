// services/wikipediaTools.js
//
// Wikipedia lookup tools. Used both by the /api/v1/research/wikipedia/*
// endpoints (direct human/integration access) and by the Jarvis
// assistant tool catalog.
//
// We hit Wikipedia's public REST API + the older MediaWiki search API.
// No auth needed. Rate limits are generous (no key required for our
// scale). All calls send a descriptive User-Agent per Wikipedia ToS.

import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { load as cheerioLoad } from "cheerio";

const UA = "Moduli/1.0 (https://moduli.local; jarvis-assistant) node-fetch";
const API_BASE = "https://en.wikipedia.org/w/api.php";
const REST_BASE = "https://en.wikipedia.org/api/rest_v1";

// Boilerplate to remove from a Wikipedia article body BEFORE markdown conversion.
// cheerio selectors handle nesting reliably (unlike the old regex converter,
// which leaked [edit] links, captions, and stray brackets).
const WIKI_STRIP_SELECTORS = [
  "style", "script", "link", "noscript", "meta",
  ".mw-editsection", ".mw-editsection-bracket", ".mw-jump-link",
  "sup.reference", ".reference", ".reflist", ".references", "ol.references",
  ".navbox", ".navbox-styles", ".vertical-navbox", ".sidebar", ".sistersitebox",
  ".infobox", "table.infobox", ".hatnote", ".dablink", ".ambox", ".navbar",
  ".metadata", ".noprint", ".mw-empty-elt", ".toc", "#toc", ".portal",
  ".shortdescription", ".mw-kartographer-maplink", ".mwe-math-mathml-a11y",
  ".gallery", "[role='navigation']", "figure .magnify", ".thumbcaption .magnify",
  "span.mw-editsection", ".error", ".mw-selflink",
].join(",");

// Convert Wikipedia article HTML → clean markdown using cheerio (reliable
// element removal) + turndown (correct, nesting-aware HTML→MD). Replaces the
// regex converter for the import path: no [edit] links, no leaked brackets, no
// data-mw garbage, proper nested lists, real headings.
export function wikiHtmlToMarkdown(html, title = "") {
  const $ = cheerioLoad(html);
  $(WIKI_STRIP_SELECTORS).remove();
  // Anchors whose only text is "edit" (section edit links that survived).
  $("a").each((_, a) => {
    const t = ($(a).text() || "").trim().toLowerCase();
    if (t === "edit" || t === "edit source") $(a).remove();
  });
  // Drop reference superscript markers like [1] left as plain anchors/sups.
  $("sup").each((_, s) => { if (/^\[\d+\]$/.test(($(s).text() || "").trim())) $(s).remove(); });

  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
    hr: "---",
  });
  td.use(gfm);
  // Figures → a BLOCK image whose alt is the caption, so the importer mints an
  // artifact (image + caption as its label) instead of leaking the caption out
  // as its own stray textblock.
  td.addRule("figure", {
    filter: ["figure"],
    replacement: (_content, node) => {
      const img = node.querySelector("img");
      if (!img) return "";
      let src = img.getAttribute("src") || "";
      if (!src) return "";
      if (src.startsWith("//")) src = "https:" + src;
      const capEl = node.querySelector("figcaption");
      const cap = ((capEl && capEl.textContent) || img.getAttribute("alt") || "")
        .replace(/\s+/g, " ").trim();
      return `\n\n![${cap}](${src})\n\n`;
    },
  });
  // Links: resolve wiki-internal → absolute; drop intra-page anchors + cruft.
  td.addRule("wikiLinks", {
    filter: "a",
    replacement: (content, node) => {
      const text = (content || "").trim();
      if (!text) return "";
      let href = node.getAttribute("href") || "";
      if (!href || href.startsWith("#")) return text;
      if (href.startsWith("./")) href = "https://en.wikipedia.org/wiki/" + href.slice(2);
      else if (href.startsWith("/wiki/")) href = "https://en.wikipedia.org" + href;
      else if (href.startsWith("//")) href = "https:" + href;
      else if (!/^https?:\/\//i.test(href)) return text;
      return `[${text}](${href.split("#")[0]})`;
    },
  });
  // Real content tables (e.g. Wikipedia `.wikitable` discography / works lists) →
  // a GFM pipe table the importer turns into a kind:"table" container. WITHOUT this
  // rule, turndown-plugin-gfm `keep`s any table whose first row isn't a pure heading
  // row (e.g. it has a <caption>, or mixed th/td) and emits the RAW <table> HTML
  // verbatim — which then rendered as literal "<table class='wikitable'>…</table>"
  // text in a textblock (the DOM leak the user saw). Cells use text only (the
  // importer's table cells are plain text anyway). A <caption> becomes an H3 above
  // the table so its title survives. MUST be added BEFORE `wikiPullQuote` so
  // quote-box tables still route to the blockquote rule — turndown's `add` unshifts,
  // so the LATER-added rule wins (`wikiPullQuote` stays in front for `.quotebox`).
  td.addRule("wikiTable", {
    filter: "table",
    replacement: (_content, node) => {
      const cellText = (c) => (c.textContent || "").replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
      const matrix = Array.from(node.querySelectorAll("tr"))
        .map((tr) => Array.from(tr.querySelectorAll("th, td")).map(cellText))
        .filter((r) => r.length);
      if (!matrix.length) return "";
      const cols = Math.max(...matrix.map((r) => r.length));
      const pad = (r) => { const c = r.slice(); while (c.length < cols) c.push(""); return c; };
      const line = (cells) => `| ${pad(cells).join(" | ")} |`;
      const sep = `| ${Array(cols).fill("---").join(" | ")} |`;
      const capEl = node.querySelector("caption");
      const cap = capEl ? (capEl.textContent || "").replace(/\s+/g, " ").trim() : "";
      const tableMd = [line(matrix[0]), sep, ...matrix.slice(1).map(line)].join("\n");
      return `\n\n${cap ? `### ${cap}\n\n` : ""}${tableMd}\n\n`;
    },
  });
  // Pull-quotes: Wikipedia's {{Quote box}}/{{Cquote}} render as `.quotebox` /
  // `.cquote` (often a <table>, NOT a <blockquote>), so turndown would mangle them
  // into a GFM table. Convert them to a real `> ` blockquote (+ "— attribution")
  // so markdownToModuli mints a kind:"quote" artifact. Plain <blockquote> already
  // converts via turndown's default rule.
  td.addRule("wikiPullQuote", {
    filter: (node) => {
      const cls = (node.getAttribute && (node.getAttribute("class") || "")) || "";
      return /(^|\s)(quotebox|cquote)(\s|$)/.test(cls);
    },
    replacement: (_content, node) => {
      const qEl = node.querySelector("blockquote, .quotebox-quote, p, td");
      const citeEl = node.querySelector("cite, .quotebox-title, .quotebox-cite, footer");
      let quote = ((qEl && qEl.textContent) || node.textContent || "").replace(/\s+/g, " ").trim();
      let attribution = ((citeEl && citeEl.textContent) || "").replace(/\s+/g, " ").trim();
      if (attribution && quote.endsWith(attribution)) quote = quote.slice(0, -attribution.length).trim();
      quote = quote.replace(/[“”«»❝❞]/g, "").replace(/^["']|["']$/g, "").replace(/\s*[—–]\s*$/, "").trim();
      if (!quote) return "";
      return attribution ? `\n\n> ${quote} — ${attribution}\n\n` : `\n\n> ${quote}\n\n`;
    },
  });
  let md = td.turndown($.html());
  // Protocol-relative URLs (//upload.wikimedia.org/…) → https so images/links work.
  md = md.replace(/\]\(\/\//g, "](https://");
  // Title H1 if the body doesn't already lead with one.
  if (title && !/^#\s/.test(md)) md = `# ${title}\n\n${md}`;
  md = md.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+$/gm, "").trim();
  return md;
}

// Extract the article's infobox (Born / Occupations / Spouses / Labels / Website /
// …) into rows BEFORE wikiHtmlToMarkdown strips it. Each `<tr>` with a header cell
// + a value cell becomes one { label, value } row; `<br>` and list items are turned
// into readable separators (cheerio's .text() otherwise concatenates them). The
// importer renders these as a kind:"table" container (see markdownImporter).
export function extractInfobox(html) {
  if (!html) return null;
  const $ = cheerioLoad(html);
  const box = $(".infobox").first();
  if (!box.length) return null;
  // Strip non-content nodes BEFORE reading `.text()`. cheerio's `.text()` dumps the
  // contents of `<style>`/`<script>` verbatim, so Wikipedia's embedded
  // `<style>.mw-parser-output …{}</style>` leaked raw CSS into cell values (the
  // "per-person-output { … }" garbage). Reference superscripts ([1]) + edit links go too.
  box.find("style, script, .reference, sup.reference, .mw-editsection, .noprint, .sortkey").remove();
  const rows = [];
  box.find("tr").each((_, tr) => {
    const $tr = $(tr);
    const th = $tr.children("th").first();
    const td = $tr.children("td").first();
    if (!th.length || !td.length) return;
    $(td).find("br").replaceWith(" · ");
    $(td).find("li").each((_, li) => $(li).append(", "));
    const label = ($(th).text() || "").replace(/\s+/g, " ").trim();
    const value = ($(td).text() || "")
      .replace(/\s+/g, " ")
      .replace(/\s*·\s*/g, " · ")
      .replace(/,\s*,/g, ", ")
      .replace(/[,·]\s*$/g, "")
      .trim();
    if (label && value && label.length <= 40) rows.push({ label, value });
  });
  return rows.length ? rows : null;
}

function ua() { return { "User-Agent": UA, "Accept": "application/json" }; }

// Search Wikipedia for the best matches for a query.
// Returns: [{ title, snippet, url, pageid }]
export async function search(query, { limit = 5 } = {}) {
  if (!query) return [];
  const url = `${API_BASE}?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=${limit}&format=json&origin=*`;
  const res = await fetch(url, { headers: ua() });
  if (!res.ok) throw new Error(`Wikipedia search ${res.status}`);
  const j = await res.json();
  const hits = j?.query?.search || [];
  return hits.map(h => ({
    title: h.title,
    snippet: (h.snippet || "").replace(/<[^>]+>/g, ""),
    pageid: h.pageid,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(h.title.replace(/ /g, "_"))}`,
  }));
}

// Lede summary (extract + thumbnail + description). Uses the REST API.
// Returns: { title, description, extract, url, thumbnail? }
export async function summary(title) {
  if (!title) throw new Error("title required");
  const url = `${REST_BASE}/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  const res = await fetch(url, { headers: ua() });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Wikipedia summary ${res.status}`);
  }
  const j = await res.json();
  return {
    title: j.title,
    description: j.description || null,
    extract: j.extract || "",
    url: j.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    thumbnail: j.thumbnail?.source || null,
    // Full-res lead photo (the .infobox image, which the article-HTML path
    // strips). The importer uses this as the page's main image.
    originalimage: j.originalimage?.source || null,
  };
}

// Full article as markdown. We use the REST html endpoint and convert
// to markdown via a small purpose-built converter — enough fidelity
// for the Phase A importer (headings, paragraphs, lists, links, bold,
// italic, code). Phase B will use an LLM for prose chunks.
//
// Returns: { title, markdown, url }
export async function fullMarkdown(title) {
  if (!title) throw new Error("title required");
  // Use the action=parse RENDERED html (clean, like the live page) instead of
  // the Parsoid REST /page/html — Parsoid embeds data-mw JSON wikitext + RDFa
  // that leaks into the output as raw garbage ({{hlist|…}}, "spouse":{"wt":…}).
  // prop=text returns the article body html with ordinary /wiki/ links.
  const api = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=text&format=json&formatversion=2&redirects=1`;
  const res = await fetch(api, { headers: { ...ua() } });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Wikipedia parse ${res.status}`);
  }
  const j = await res.json();
  const html = j?.parse?.text;
  const resolved = j?.parse?.title || title;
  if (!html) return null;
  // cheerio (clean removal) + turndown (nesting-aware HTML→MD). markdownToModuli
  // downstream turns this into doc containers + textblocks.
  let md = wikiHtmlToMarkdown(html, resolved);

  // Lead image — Wikipedia's main photo lives in the .infobox, which
  // wikiHtmlToMarkdown strips, so the article body has no main image. Pull it
  // from the REST summary and inject it right after the H1 title as a block
  // image, so the importer mints it as the page's MAIN image (and can wrap the
  // intro paragraph beside it). Best-effort: a missing summary never blocks.
  try {
    const s = await summary(resolved);
    const lead = s?.originalimage || s?.thumbnail;
    // Infobox → a pipe table the importer turns into a kind:"table" container.
    const info = extractInfobox(html);
    const esc = (t) => String(t).replace(/\|/g, "\\|");
    // EMPTY header cells: the infobox renders as a bare key/value table with no
    // header title (the importer keeps empty headers as-is → no "Field"/"Value"
    // titles, no container label). It's a facts card, not a titled table.
    const infoTable = info
      ? ["| | |", "| --- | --- |", ...info.map((r) => `| ${esc(r.label)} | ${esc(r.value)} |`)].join("\n")
      : "";
    const parts = [];
    if (lead && !md.includes(lead)) parts.push(`![${resolved}](${lead})`);
    if (infoTable) parts.push(infoTable);
    if (parts.length) {
      const leadBlock = `\n\n${parts.join("\n\n")}\n`;
      if (/^#\s[^\n]*\n/.test(md)) md = md.replace(/^(#\s[^\n]*\n)/, `$1${leadBlock}`);
      else md = `${parts.join("\n\n")}\n\n${md}`;
    }
  } catch { /* summary/infobox are optional enrichment */ }

  return {
    title: resolved,
    markdown: md,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(resolved.replace(/ /g, "_"))}`,
  };
}

// Outbound ARTICLE links from an article, in document order, de-duped and
// filtered to real article-namespace titles (skips File:/Help:/Category:/etc.
// and self-links). Powers "make a page on X AND the surrounding links" — the
// caller fans these out into one import per chosen title.
const NON_ARTICLE_NS = /^(File|Image|Help|Category|Template|Wikipedia|Portal|Special|Talk|User|Module|Draft|MediaWiki|Book):/i;
export async function links(title, max = 10) {
  if (!title) throw new Error("title required");
  const url = `${REST_BASE}/page/html/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  const res = await fetch(url, { headers: { ...ua(), "Accept": "text/html" } });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Wikipedia html ${res.status}`);
  }
  const html = await res.text();
  const cap = Math.min(Math.max(Number(max) || 10, 1), 50);
  const self = title.replace(/_/g, " ").toLowerCase();
  const seen = new Set();
  const out = [];
  const re = /href=["'](?:\.\/|\/wiki\/)([^"'#]+)(?:#[^"']*)?["']/gi;
  let m;
  while (out.length < cap && (m = re.exec(html)) !== null) {
    let t;
    try { t = decodeURIComponent(m[1]); } catch { t = m[1]; }
    t = t.replace(/_/g, " ").trim();
    if (!t || NON_ARTICLE_NS.test(t)) continue;
    const key = t.toLowerCase();
    if (key === self || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return { title, links: out };
}

// Dependency-free HTML → markdown converter.
//
// Originally tuned for the shape Wikipedia's REST endpoint returns;
// now generalized via an options bag so the drag-to-import pipeline
// (Phase A of the import docket — see client/src/CLAUDE.md item 6.5)
// can opt to KEEP images + tables + figures, which the AI-summary
// path strips by default.
//
// Options:
//   keepImages: true   — emit `![alt](src)` markdown for <img>; absolute
//                        URLs are preserved verbatim (no upload yet).
//   keepTables: true   — emit a TipTap-table-style placeholder block per
//                        <table> so the importer can route them; Phase A
//                        leaves the raw HTML in a fenced ```html``` block
//                        (markdownImporter recognises this as a textblock
//                        codeBlock node — fast path).
//   keepFigures: true  — preserve <figure> + <figcaption> as image + a
//                        caption paragraph underneath.
//   stripClasses: [..] — additional CSS classes whose elements are
//                        dropped wholesale (defaults to the Wikipedia
//                        boilerplate set).
//
// Defaults match the original Wikipedia-summary stripping behavior so
// existing callers (fullMarkdown / the assistant tool catalog) stay
// byte-identical.
export function htmlToMarkdown(html, fallbackTitle = "", opts = {}) {
  const {
    keepImages = false,
    keepTables = false,
    keepFigures = false,
    stripClasses = ["infobox", "navbox", "navbox-styles", "references", "reflist", "metadata", "thumb", "noprint", "mw-editsection"],
  } = opts;

  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Drop entire elements with these classes (greedy match within the element).
  for (const cls of stripClasses) {
    const re = new RegExp(`<([a-z]+)([^>]*class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*)>[\\s\\S]*?<\\/\\1>`, "gi");
    s = s.replace(re, "");
  }
  // <sup class="reference"> always dropped — citation superscripts add
  // visual noise and the importer can't do anything useful with them.
  s = s.replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, "");

  // Figures — convert to `![alt](src)\n\n_caption_\n\n` when keepFigures,
  // else drop entirely. Done BEFORE the bare <img> handler so figures
  // contribute their figcaption. The src/alt extraction uses two
  // independent regexes against the img tag string — attribute order
  // in HTML is not guaranteed, so doing them as separate matches is
  // more robust than a single positional regex.
  if (keepFigures) {
    s = s.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, (_, inner) => {
      const imgTagM = inner.match(/<img[^>]*>/i);
      const imgTag = imgTagM?.[0] || "";
      const srcM = imgTag.match(/\bsrc=["']([^"']+)["']/i);
      const altM = imgTag.match(/\balt=["']([^"']*)["']/i);
      const src = srcM?.[1] || "";
      const alt = altM?.[1] || "";
      const capM = inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
      const cap = capM ? stripTags(capM[1]).replace(/\s+/g, " ").trim() : "";
      if (!src) return cap ? `\n_${cap}_\n\n` : "";
      return `\n![${alt}](${src})\n\n${cap ? `_${cap}_\n\n` : ""}`;
    });
  } else {
    s = s.replace(/<figure[\s\S]*?<\/figure>/gi, "");
  }

  // Tables — extracted to a placeholder token BEFORE later inline-mark /
  // tag-stripping passes (which would otherwise mangle the raw HTML
  // inside the fence: `<strong>` → `**` etc., `<td>` deleted by
  // stripTags). The token is swapped back to a fenced ```html block
  // at the very end. When keepTables is false, tables are dropped.
  const tableStash = [];
  if (keepTables) {
    s = s.replace(/<table[\s\S]*?<\/table>/gi, (m) => {
      const idx = tableStash.length;
      tableStash.push(m);
      return `\n\n__MODULI_TABLE_STASH_${idx}__\n\n`;
    });
  } else {
    s = s.replace(/<table[\s\S]*?<\/table>/gi, "");
  }

  // Bare <img> — convert when keepImages, else drop. Same independent-
  // regex trick as the figure case for attribute-order robustness.
  if (keepImages) {
    s = s.replace(/<img[^>]*>/gi, (m) => {
      const srcM = m.match(/\bsrc=["']([^"']+)["']/i);
      const altM = m.match(/\balt=["']([^"']*)["']/i);
      const src = srcM?.[1] || "";
      const alt = altM?.[1] || "";
      if (!src) return "";
      return `\n![${alt}](${src})\n\n`;
    });
  } else {
    s = s.replace(/<img[^>]*>/gi, "");
  }

  // Headings
  s = s.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n# ${stripTags(t).trim()}\n\n`);
  s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n## ${stripTags(t).trim()}\n\n`);
  s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n### ${stripTags(t).trim()}\n\n`);
  s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => `\n#### ${stripTags(t).trim()}\n\n`);
  // Lists
  s = s.replace(/<\/?(ul|ol)[^>]*>/gi, "\n");
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `- ${stripTags(t).replace(/\s+/g, " ").trim()}\n`);
  // Inline marks
  s = s.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => `**${stripTags(t)}**`);
  s = s.replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => `*${stripTags(t)}*`);
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, t) => `\`${stripTags(t)}\``);
  // Links — resolve wiki-internal links to ABSOLUTE Wikipedia URLs so the
  // imported chips actually open the right article. The REST HTML uses `./X`
  // (relative to /wiki/); rendered pages use `/wiki/X`. Intra-page `#anchors`
  // and unknown relatives drop to plain text (no broken links).
  s = s.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => {
    const text = stripTags(t).trim();
    if (!text) return "";
    if (href.startsWith("#")) return text;
    let url = href;
    if (url.startsWith("./")) url = `https://en.wikipedia.org/wiki/${url.slice(2)}`;
    else if (url.startsWith("/wiki/")) url = `https://en.wikipedia.org${url}`;
    else if (url.startsWith("//")) url = `https:${url}`;
    else if (!/^https?:\/\//i.test(url)) return text; // unknown relative → plain text
    return `[${text}](${url})`;
  });
  // Paragraphs
  s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, t) => `\n${stripTags(t).replace(/\s+/g, " ").trim()}\n\n`);

  // Drop remaining tags. Tables are still stashed as placeholders at
  // this point (extracted earlier), so stripTags can run freely over
  // the entire string without corrupting the raw table HTML.
  s = stripTags(s);

  // Decode common entities
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  // Restore table stashes — now safe because tag-stripping is done.
  // Wrap each in a ```html fenced block; markdownImporter Phase A
  // recognises the fence as a textblock codeBlock node, preserving
  // the table as a faithful preview until the user / AI promotes it
  // to a kind:"table" container.
  if (tableStash.length) {
    s = s.replace(/__MODULI_TABLE_STASH_(\d+)__/g, (_, idx) => {
      const raw = tableStash[Number(idx)] || "";
      return `\`\`\`html\n${raw}\n\`\`\``;
    });
  }
  // Collapse 3+ newlines
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  // Prepend a top-level heading if not present
  if (fallbackTitle && !s.startsWith("#")) s = `# ${fallbackTitle}\n\n${s}`;
  return s;
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, "");
}
