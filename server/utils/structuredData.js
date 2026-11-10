// utils/structuredData.js
//
// WHAT A PAGE SAYS IT IS (smarter imports Task 6). A movie page, a recipe, a book listing usually describe
// themselves in JSON-LD (schema.org), and that description is better than anything read off the prose:
// it names the type, the title, the year, the author. Read in order of how much the page meant it:
//   1. JSON-LD <script type="application/ld+json"> — any node, including inside `@graph`, with `@id`
//      references resolved (a WordPress Article points at its author by id)
//   2. Open Graph meta tags (og:type, og:title, og:image, article:author, article:published_time)
//   3. the first <h1> inside <article>
// Pure, and it never throws: a malformed block is skipped and the next source is read.

const TYPE_ALIASES = {
  Movie: "Movie", Film: "Movie",
  Book: "Book",
  Recipe: "Recipe",
  Product: "Product",
  Person: "Person",
  Article: "Article", NewsArticle: "Article", BlogPosting: "Article", ScholarlyArticle: "Article", Report: "Article",
};
// When a graph holds several typed nodes (an Article, its author Person, the WebPage), the most specific wins.
const PRECEDENCE = ["Movie", "Book", "Recipe", "Product", "Article", "Person"];

const OG_TYPES = { "video.movie": "Movie", "book": "Book", "article": "Article", "profile": "Person", "product": "Product" };

const decode = (s) => String(s ?? "")
  .replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&").trim();
const strip = (s) => decode(String(s ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

function jsonLdNodes(html) {
  const nodes = [];
  const rx = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = rx.exec(html))) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const walk = (v) => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (!v || typeof v !== "object") return;
      nodes.push(v);
      if (Array.isArray(v["@graph"])) v["@graph"].forEach(walk);
    };
    walk(data);
  }
  return nodes;
}

const typesOf = (node) => (Array.isArray(node?.["@type"]) ? node["@type"] : [node?.["@type"]])
  .map((t) => TYPE_ALIASES[String(t || "").replace(/^.*[/#]/, "")]).filter(Boolean);

function deref(v, byId) {
  if (v && typeof v === "object" && !Array.isArray(v) && v["@id"] && Object.keys(v).length === 1) return byId.get(v["@id"]) || v;
  return v;
}
const first = (v) => (Array.isArray(v) ? v[0] : v);
function nameOf(v, byId) {
  const x = deref(first(v), byId);
  if (typeof x === "string") return strip(x) || undefined;
  return x?.name ? strip(x.name) : undefined;
}
function imageOf(v, byId) {
  const x = deref(first(v), byId);
  if (typeof x === "string") return x;
  return x?.url || x?.contentUrl || undefined;
}
const yearOf = (d) => { const m = /\b(1[89]\d\d|20\d\d)\b/.exec(String(d || "")); return m ? Number(m[1]) : undefined; };

function fromJsonLd(html) {
  const nodes = jsonLdNodes(html);
  const byId = new Map(nodes.filter((n) => n["@id"]).map((n) => [n["@id"], n]));
  let best = null, bestType = null;
  for (const n of nodes) {
    for (const t of typesOf(n)) {
      if (!bestType || PRECEDENCE.indexOf(t) < PRECEDENCE.indexOf(bestType)) { best = n; bestType = t; }
    }
  }
  if (!best) return null;
  const out = { type: bestType, fields: {} };
  const title = strip(best.name || best.headline || "");
  if (title) out.title = title;
  const author = nameOf(best.author || best.creator, byId);
  if (author) out.author = author;
  const date = best.datePublished || best.dateCreated || best.uploadDate;
  if (date) out.date = String(date);
  const image = imageOf(best.image || best.thumbnailUrl, byId);
  if (image) out.image = image;
  if (bestType === "Movie") {
    const y = yearOf(best.datePublished || best.dateCreated);
    if (y) out.fields.year = y;
    const director = nameOf(best.director, byId);
    if (director) out.fields.director = director;
  }
  if (bestType === "Book") {
    if (author) out.fields.author = author;
    const y = yearOf(best.datePublished);
    if (y) out.fields.year = y;
  }
  if (bestType === "Recipe" && Array.isArray(best.recipeIngredient)) {
    out.fields.ingredients = best.recipeIngredient.map(strip).filter(Boolean);
  }
  return out;
}

function metaTags(html) {
  const tags = {};
  for (const m of String(html).matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    const content = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (key && content != null && !(key in tags)) tags[key] = decode(content);
  }
  return tags;
}

/** @returns {{ type: null|string, title?, author?, date?, image?, fields: object }} */
export function readStructuredData(html, url = "") { // eslint-disable-line no-unused-vars
  const out = { type: null, fields: {} };
  const src = String(html || "");
  const ld = fromJsonLd(src);
  if (ld) Object.assign(out, ld, { fields: { ...ld.fields } });
  const og = metaTags(src);
  if (!out.type && og["og:type"]) out.type = OG_TYPES[og["og:type"].toLowerCase()] || null;
  if (!out.title && og["og:title"]) out.title = og["og:title"];
  if (!out.image && og["og:image"]) out.image = og["og:image"];
  if (!out.author && og["article:author"] && !/^https?:/i.test(og["article:author"])) out.author = og["article:author"];
  if (!out.date && og["article:published_time"]) out.date = og["article:published_time"];
  if (!out.title) {
    const h1 = /<article\b[\s\S]*?<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(src)?.[1];
    if (h1 && strip(h1)) out.title = strip(h1);
  }
  return out;
}
