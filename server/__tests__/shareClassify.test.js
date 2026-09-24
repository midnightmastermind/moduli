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
});
