import { describe, it, expect } from "vitest";
import { decodeEntities } from "../utils/htmlEntities.js";
import { titleFromHtml } from "../utils/linkPreview.js";

describe("decodeEntities", () => {
  // Measured on the badgerherald article the reader work started from: its
  // <title> is "…exploring UW&#8217;s underground labyrinth &#8211; The Badger
  // Herald", and the reader printed those entities verbatim in its header.
  it("decodes the numeric entities a real page title carries", () => {
    expect(decodeEntities("UW&#8217;s labyrinth &#8211; The Badger Herald"))
      .toBe("UW’s labyrinth – The Badger Herald");
  });

  it("decodes hex entities", () => {
    expect(decodeEntities("UW&#x2019;s")).toBe("UW’s");
  });

  it("decodes the common named entities", () => {
    expect(decodeEntities("a&nbsp;b &lt;c&gt; &quot;d&quot; &rsquo; &mdash; &hellip;"))
      .toBe("a b <c> \"d\" ’ — …");
  });

  // ORDER IS THE BUG THIS PINS. `&amp;` must be decoded LAST: decoding it first
  // turns "&amp;lt;" — which is the literal TEXT "&lt;" — into "<".
  it("does not double-decode an escaped entity", () => {
    expect(decodeEntities("&amp;lt;")).toBe("&lt;");
    expect(decodeEntities("Tom &amp; Jerry")).toBe("Tom & Jerry");
  });

  // An unknown entity is left exactly as written rather than guessed at.
  it("leaves an unknown entity alone", () => {
    expect(decodeEntities("&notareal; &foo;")).toBe("&notareal; &foo;");
  });

  it("is safe on empty and non-string input", () => {
    expect(decodeEntities("")).toBe("");
    expect(decodeEntities(null)).toBe("");
  });
});

describe("titleFromHtml", () => {
  it("decodes the entities a page's <title> carries", () => {
    const html = `<html><head><title>exploring UW&#8217;s labyrinth &#8211; The Badger Herald</title></head></html>`;
    expect(titleFromHtml(html)).toBe("exploring UW’s labyrinth – The Badger Herald");
  });

  it("still collapses whitespace and returns '' when there is no title", () => {
    expect(titleFromHtml("<title>a\n  b</title>")).toBe("a b");
    expect(titleFromHtml("<html></html>")).toBe("");
  });
});
