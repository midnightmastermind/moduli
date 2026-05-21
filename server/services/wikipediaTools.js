// services/wikipediaTools.js
//
// Wikipedia lookup tools. Used both by the /api/v1/research/wikipedia/*
// endpoints (direct human/integration access) and by the Jarvis
// assistant tool catalog.
//
// We hit Wikipedia's public REST API + the older MediaWiki search API.
// No auth needed. Rate limits are generous (no key required for our
// scale). All calls send a descriptive User-Agent per Wikipedia ToS.

const UA = "Moduli/1.0 (https://moduli.local; jarvis-assistant) node-fetch";
const API_BASE = "https://en.wikipedia.org/w/api.php";
const REST_BASE = "https://en.wikipedia.org/api/rest_v1";

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
  const url = `${REST_BASE}/page/html/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  const res = await fetch(url, { headers: { ...ua(), "Accept": "text/html" } });
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Wikipedia html ${res.status}`);
  }
  const html = await res.text();
  const md = htmlToMarkdown(html, title);
  return {
    title,
    markdown: md,
    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
  };
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
  // Links — preserve external URLs; strip wiki-internal /wiki/* into bare text
  s = s.replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, t) => {
    const text = stripTags(t).trim();
    if (!text) return "";
    if (href.startsWith("/wiki/")) return text;
    if (href.startsWith("#")) return text;
    return `[${text}](${href})`;
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
