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

// Very small, dependency-free HTML → markdown converter tuned for the
// shapes Wikipedia's REST html returns. Not a general-purpose tool;
// strips out infoboxes / nav / references / images by element class.
// Keeps headings, paragraphs, lists, bold/italic, inline code, and links.
function htmlToMarkdown(html, fallbackTitle) {
  // Strip script/style/figure/table/.infobox/.navbox/.references etc.
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  // Drop entire elements with these classes (greedy match within the element).
  for (const cls of ["infobox", "navbox", "navbox-styles", "references", "reflist", "metadata", "thumb", "noprint", "mw-editsection"]) {
    const re = new RegExp(`<([a-z]+)([^>]*class=["'][^"']*\\b${cls}\\b[^"']*["'][^>]*)>[\\s\\S]*?<\\/\\1>`, "gi");
    s = s.replace(re, "");
  }
  // <figure>, <table>, <img>, <sup class="reference"> — drop
  s = s.replace(/<figure[\s\S]*?<\/figure>/gi, "");
  s = s.replace(/<table[\s\S]*?<\/table>/gi, "");
  s = s.replace(/<img[^>]*>/gi, "");
  s = s.replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, "");
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
  // Drop remaining tags
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
  // Collapse 3+ newlines
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  // Prepend a top-level heading if not present
  if (!s.startsWith("#")) s = `# ${fallbackTitle}\n\n${s}`;
  return s;
}

function stripTags(s) {
  return String(s).replace(/<[^>]+>/g, "");
}
