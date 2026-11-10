// server/__tests__/structuredData.test.js — plan Task 6: what a page says it is.
import { describe, it, expect } from "vitest";
import { readStructuredData } from "../utils/structuredData.js";

// Shaped like IMDb's title page: one Movie JSON-LD block, written by hand from a real page's structure.
const MOVIE = `<html><head><title>A Guide to Recognizing Your Saints (2006) - IMDb</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Movie",
"url":"/title/tt0473488/","name":"A Guide to Recognizing Your Saints","image":"https://m.media-amazon.com/images/M/poster.jpg",
"datePublished":"2006-10-27","director":[{"@type":"Person","url":"/name/nm0583860/","name":"Dito Montiel"}],
"genre":["Crime","Drama"]}</script></head><body><h1>A Guide to Recognizing Your Saints</h1></body></html>`;

// WordPress / Yoast: everything in one @graph, the author referenced by @id.
const WP = `<html><head><script type="application/ld+json" class="yoast-schema-graph">{"@context":"https://schema.org","@graph":[
{"@type":"WebPage","@id":"https://ex.test/post/#webpage","name":"The Post – Ex Site"},
{"@type":["Article","BlogPosting"],"@id":"https://ex.test/post/#article","headline":"Notes on the &amp; sign",
 "author":{"@id":"https://ex.test/#/schema/person/1"},"datePublished":"2024-03-01T10:00:00+00:00",
 "image":{"@id":"https://ex.test/post/#primaryimage"}},
{"@type":"ImageObject","@id":"https://ex.test/post/#primaryimage","url":"https://ex.test/img/lead.jpg"},
{"@type":"Person","@id":"https://ex.test/#/schema/person/1","name":"Jane Writer"}]}</script></head><body></body></html>`;

const OG_ONLY = `<html><head><meta content="An OG title" property="og:title"><meta property="og:image" content="https://ex.test/og.png">
<meta property="og:type" content="article"><meta property="article:published_time" content="2025-01-02"></head></html>`;

const MALFORMED = `<html><head><script type="application/ld+json">{"@type":"Movie","name":"Cut off</script>
<meta property="og:title" content="Still read"></head></html>`;

describe("readStructuredData", () => {
  it("a JSON-LD Movie: type, title, year, director, poster", () => {
    const sd = readStructuredData(MOVIE);
    expect(sd.type).toBe("Movie");
    expect(sd.title).toBe("A Guide to Recognizing Your Saints");
    expect(sd.fields).toMatchObject({ year: 2006, director: "Dito Montiel" });
    expect(sd.image).toBe("https://m.media-amazon.com/images/M/poster.jpg");
  });

  it("an @graph Article: the author and image found by @id, the most specific type wins", () => {
    const sd = readStructuredData(WP);
    expect(sd.type).toBe("Article");
    expect(sd.title).toBe("Notes on the & sign");
    expect(sd.author).toBe("Jane Writer");
    expect(sd.date).toBe("2024-03-01T10:00:00+00:00");
    expect(sd.image).toBe("https://ex.test/img/lead.jpg");
  });

  it("no JSON-LD: title, image, type and date from Open Graph", () => {
    const sd = readStructuredData(OG_ONLY);
    expect(sd).toMatchObject({ type: "Article", title: "An OG title", image: "https://ex.test/og.png", date: "2025-01-02" });
  });

  it("malformed JSON-LD falls through to Open Graph and does not throw", () => {
    const sd = readStructuredData(MALFORMED);
    expect(sd.type).toBe(null);
    expect(sd.title).toBe("Still read");
  });

  it("nothing at all: the article's first heading", () => {
    expect(readStructuredData("<body><article><h1>Plain <b>heading</b></h1><p>x</p></article></body>").title).toBe("Plain heading");
  });
});
