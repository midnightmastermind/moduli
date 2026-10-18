// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { stripBookNavLinks } from "../helpers/bookNavLinks";

const doc = (html) => new DOMParser().parseFromString(`<html><body>${html}</body></html>`, "text/html");
const body = (d) => d.body.innerHTML.replace(/\s+/g, " ").trim();

describe("the book's own page-turn links come out", () => {
  it("removes a Previous | Next bar and the empty block it leaves", () => {
    const d = doc(`<p class="nav"><a href="ch1.html">Previous</a> | <a href="ch3.html">Next</a></p><p>The chapter starts here.</p>`);
    expect(stripBookNavLinks(d)).toBe(2);
    expect(body(d)).toBe("<p>The chapter starts here.</p>");
  });

  it("removes arrow-only links and an image link labelled Next", () => {
    const d = doc(`<div><a href="a.html">«</a> <a href="b.html"><img alt="Next page" src="n.gif"></a></div><p>Text</p>`);
    expect(stripBookNavLinks(d)).toBe(2);
    expect(body(d)).toBe("<p>Text</p>");
  });

  it("takes Contents only when it sits beside a page-turn link", () => {
    const d = doc(`<p><a href="p.html">Prev</a> · <a href="toc.html">Contents</a> · <a href="n.html">Next chapter</a></p>`);
    expect(stripBookNavLinks(d)).toBe(3);
    expect(body(d)).toBe("");
  });

  it("control: a contents page and the book's prose are left alone", () => {
    const html = `<h1>Contents</h1><p><a href="c1.html">Chapter One: The Next Day</a></p><p><a href="toc.html">Contents</a></p><p>He said: next time, go back.</p>`;
    const d = doc(html);
    expect(stripBookNavLinks(d)).toBe(0);
    expect(body(d)).toBe(body(doc(html)));
  });

  it("control: a link to another site is the author's, even if it says Next", () => {
    const d = doc(`<p><a href="https://example.com/next">Next</a></p>`);
    expect(stripBookNavLinks(d)).toBe(0);
  });

  it("control: a Next link inside a sentence is the book's prose and stays", () => {
    const html = `<p>Go on to the <a href="n.html">Next</a> part, or rest.</p>`;
    const d = doc(html);
    expect(stripBookNavLinks(d)).toBe(0);
    expect(body(d)).toBe(body(doc(html)));
  });
});
