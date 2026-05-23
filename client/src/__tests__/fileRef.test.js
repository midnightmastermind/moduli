import { describe, it, expect } from "vitest";
import { resolveFileRef, isExternalFileRef, isExternalArtifact } from "../helpers/fileRef";

describe("resolveFileRef", () => {
  it("returns null for null / undefined / empty", () => {
    expect(resolveFileRef(null)).toBeNull();
    expect(resolveFileRef(undefined)).toBeNull();
    expect(resolveFileRef("")).toBeNull();
  });

  it("passes http/https URLs through unchanged (drag-to-import case)", () => {
    expect(resolveFileRef("https://example.com/x.jpg")).toBe("https://example.com/x.jpg");
    expect(resolveFileRef("http://example.com/x.jpg")).toBe("http://example.com/x.jpg");
  });

  it("passes data URIs through unchanged", () => {
    const d = "data:image/png;base64,iVBORw0K";
    expect(resolveFileRef(d)).toBe(d);
  });

  it("passes blob URIs through unchanged", () => {
    const b = "blob:http://localhost:5173/abc-123";
    expect(resolveFileRef(b)).toBe(b);
  });

  it("passes absolute paths (leading /) through unchanged", () => {
    expect(resolveFileRef("/uploads/x.jpg")).toBe("/uploads/x.jpg");
    expect(resolveFileRef("/api/v1/x")).toBe("/api/v1/x");
  });

  it("prepends /uploads/ to relative refs (legacy local-upload case)", () => {
    expect(resolveFileRef("kittens.jpg")).toBe("/uploads/kittens.jpg");
    expect(resolveFileRef("folder/file.png")).toBe("/uploads/folder/file.png");
  });

  it("is case-insensitive for URL schemes", () => {
    expect(resolveFileRef("HTTPS://x.com/a.jpg")).toBe("HTTPS://x.com/a.jpg");
    expect(resolveFileRef("Http://x.com/a.jpg")).toBe("Http://x.com/a.jpg");
  });
});

describe("isExternalFileRef", () => {
  it("recognizes http / https / data / blob refs as external", () => {
    expect(isExternalFileRef("https://wikimedia.org/x.jpg")).toBe(true);
    expect(isExternalFileRef("http://example.com/x.jpg")).toBe(true);
    expect(isExternalFileRef("data:image/png;base64,abc")).toBe(true);
    expect(isExternalFileRef("blob:http://localhost/abc")).toBe(true);
  });
  it("treats relative + server-absolute refs as internal", () => {
    expect(isExternalFileRef("user/abc.jpg")).toBe(false);
    expect(isExternalFileRef("/uploads/abc.jpg")).toBe(false);
  });
  it("returns false for null / empty", () => {
    expect(isExternalFileRef(null)).toBe(false);
    expect(isExternalFileRef("")).toBe(false);
  });
});

describe("isExternalArtifact", () => {
  it("trusts meta.external when present", () => {
    expect(isExternalArtifact({ meta: { external: true }, fileRef: "user/x.jpg" })).toBe(true);
    expect(isExternalArtifact({ meta: { external: false }, fileRef: "https://x.com/a.jpg" })).toBe(false);
  });
  it("falls back to fileRef detection when meta.external is unset", () => {
    expect(isExternalArtifact({ fileRef: "https://wikimedia.org/x.jpg" })).toBe(true);
    expect(isExternalArtifact({ fileRef: "user/abc.jpg" })).toBe(false);
  });
  it("returns false for null / no fileRef", () => {
    expect(isExternalArtifact(null)).toBe(false);
    expect(isExternalArtifact({})).toBe(false);
  });
});
