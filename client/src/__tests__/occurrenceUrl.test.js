// The iframe view is offered because a row HAS a url — never because anything
// learned what a "bookmark" is. That is the rule `noDomainKnowledge` enforces,
// and this resolver is where it is kept.
import { describe, it, expect } from "vitest";
import { occurrenceUrl, hasViewableUrl } from "../helpers/occurrenceUrl";

const F = { u: { id: "u", name: "URL" }, w: { id: "w", name: "Website" },
            n: { id: "n", name: "Notes" }, t: { id: "t", name: "Title" } };
const ctx = { fieldsById: F };

describe("occurrenceUrl", () => {
  it("finds a link chip's url and says where it came from", () => {
    const o = { meta: { link: { kind: "url", url: "https://a.example" } } };
    expect(occurrenceUrl(o, ctx)).toEqual({ url: "https://a.example", from: "link" });
  });

  it("prefers the OCCURRENCE's link over the module's — delegated, not re-derived", () => {
    const o = { meta: { link: { kind: "url", url: "https://mine.example" } } };
    const m = { meta: { link: { kind: "url", url: "https://template.example" } } };
    expect(occurrenceUrl(o, { ...ctx, module: m }).url).toBe("https://mine.example");
  });

  it("ignores an in-app occurrence link — that is a jump, not a web page", () => {
    const o = { meta: { link: { kind: "occurrence", url: "abc123" } } };
    expect(occurrenceUrl(o, ctx)).toBeNull();
  });

  it("finds a url in a FIELD", () => {
    const o = { fields: { u: { value: "https://b.example" } } };
    expect(occurrenceUrl(o, ctx)).toMatchObject({ url: "https://b.example", from: "field", fieldId: "u" });
  });

  it("prefers a NAMED url field over a stray url in prose", () => {
    // Without the preference the answer depends on key order, which is not a
    // decision — a Person would open whichever field Mongo returned first.
    const o = { fields: { n: { value: "see https://stray.example for more" },
                          w: { value: "https://website.example" } } };
    expect(occurrenceUrl(o, ctx).fieldId).toBe("w");
  });

  it("ranks URL above Website when a row carries both", () => {
    const o = { fields: { w: { value: "https://site.example" }, u: { value: "https://url.example" } } };
    expect(occurrenceUrl(o, ctx).fieldId).toBe("u");
  });

  it("reads a url out of an ARRAY value", () => {
    const o = { fields: { u: { value: ["https://first.example", "https://second.example"] } } };
    expect(occurrenceUrl(o, ctx).url).toBe("https://first.example");
  });

  it("falls back to a remote fileRef", () => {
    expect(occurrenceUrl({}, { ...ctx, module: { fileRef: "https://cdn.example/a.pdf" } }))
      .toEqual({ url: "https://cdn.example/a.pdf", from: "fileRef" });
  });

  it("ignores a LOCAL fileRef — a path on disk is not a web page", () => {
    expect(occurrenceUrl({}, { ...ctx, module: { fileRef: "notes/morenotes.md" } })).toBeNull();
  });

  it("ignores a non-http value, so `mailto:` and bare text never open a frame", () => {
    const o = { fields: { u: { value: "mailto:a@b.c" }, t: { value: "just a title" } } };
    expect(occurrenceUrl(o, ctx)).toBeNull();
  });

  it("an occurrence with nothing is null — the control", () => {
    // Without this, a resolver that returned a truthy default would pass every
    // test above and offer the view on every row in the grid.
    expect(occurrenceUrl({ fields: {} }, ctx)).toBeNull();
    expect(occurrenceUrl(null, ctx)).toBeNull();
  });

  it("hasViewableUrl agrees with the resolver", () => {
    expect(hasViewableUrl({ fields: { u: { value: "https://x.example" } } }, ctx)).toBe(true);
    expect(hasViewableUrl({ fields: {} }, ctx)).toBe(false);
  });
});
