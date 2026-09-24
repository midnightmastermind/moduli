import { describe, it, expect } from "vitest";
import { classifyShare } from "../services/shareClassify.js";

const file = (filename, mimetype, size = 100) => ({ filename, mimetype, size });

describe("classifyShare", () => {
  it("names a calendar by mime type", () => {
    expect(classifyShare({ files: [file("m.ics", "text/calendar")] }).type).toBe("ics");
  });

  it("names a calendar by EXTENSION when the mime type is generic", () => {
    // Android frequently shares .ics as application/octet-stream.
    expect(classifyShare({ files: [file("m.ics", "application/octet-stream")] }).type).toBe("ics");
  });

  it("names images, video, audio and pdf", () => {
    expect(classifyShare({ files: [file("a.jpg", "image/jpeg")] }).type).toBe("image");
    expect(classifyShare({ files: [file("a.mp4", "video/mp4")] }).type).toBe("video");
    expect(classifyShare({ files: [file("a.m4a", "audio/mp4")] }).type).toBe("audio");
    expect(classifyShare({ files: [file("a.pdf", "application/pdf")] }).type).toBe("pdf");
  });

  it("falls back to `file` for anything else, so the catch-all can match", () => {
    expect(classifyShare({ files: [file("a.zip", "application/zip")] }).type).toBe("file");
  });

  it("names a link and exposes the url", () => {
    const r = classifyShare({ url: "https://example.com/x", title: "X" });
    expect(r.type).toBe("link");
    expect(r.props.url).toBe("https://example.com/x");
    expect(r.props.title).toBe("X");
  });

  it("finds a bare url shared as TEXT — Android shares links that way", () => {
    expect(classifyShare({ text: "https://example.com/x" }).type).toBe("link");
  });

  it("names prose as text and exposes firstLine", () => {
    const r = classifyShare({ text: "Hello there\nsecond line" });
    expect(r.type).toBe("text");
    expect(r.props.firstLine).toBe("Hello there");
  });

  it("a file wins over accompanying text — the file is the payload", () => {
    expect(classifyShare({ files: [file("a.jpg", "image/jpeg")], text: "look" }).type).toBe("image");
  });

  // T1: files wins over url when both present
  it("files wins over url when both are present", () => {
    const r = classifyShare({ files: [file("a.jpg", "image/jpeg")], url: "https://example.com/x" });
    expect(r.type).toBe("image");
    expect(r.props.filename).toBe("a.jpg");
    expect(r.props.url).toBeUndefined();
  });

  // T2: extensionless file with text/calendar mime classifies as ics
  it("an extensionless file with mimeType text/calendar classifies as ics", () => {
    expect(classifyShare({ files: [file("calendar", "text/calendar")] }).type).toBe("ics");
  });

  // T3: URL with trailing punctuation yields clean props.url
  it("a URL with trailing punctuation yields a clean props.url", () => {
    const r = classifyShare({ url: "https://example.com/x." });
    expect(r.type).toBe("link");
    expect(r.props.url).toBe("https://example.com/x");
  });

  // F2: Find URL anywhere in text
  it("finds a URL anywhere in text, not only as the entire string", () => {
    const r = classifyShare({ text: "Article Title\nhttps://example.com/x" });
    expect(r.type).toBe("link");
    expect(r.props.url).toBe("https://example.com/x");
    expect(r.props.text).toBe("Article Title\nhttps://example.com/x");
  });

  // F3: Accept webcal: scheme
  it("accepts webcal: as a link scheme", () => {
    const r = classifyShare({ url: "webcal://example.com/calendar.ics" });
    expect(r.type).toBe("link");
    expect(r.props.url).toBe("webcal://example.com/calendar.ics");
  });

  // F5: link props has text field
  it("link props includes text field set to null when no text provided", () => {
    const r = classifyShare({ url: "https://example.com/x" });
    expect(r.type).toBe("link");
    expect(r.props).toHaveProperty("text");
    expect(r.props.text).toBe(null);
  });

  it("link props includes original text when URL found in text", () => {
    const r = classifyShare({ text: "Check this out https://example.com/x" });
    expect(r.type).toBe("link");
    expect(r.props.text).toBe("Check this out https://example.com/x");
  });
});
