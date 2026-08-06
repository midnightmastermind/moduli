// Migration 0043's PURE half — the rules that decide what gets converted and
// what kind the artifact gets. Unit-tested with no database, because the risky
// part of this migration is the predicate, not the writes.
//
// The kind rule is inverted from the obvious one, and it was MEASURED, not
// guessed: of the 213 media strings on poms grid, 178 have no recognizable
// extension (bing image-search, pravatar and openlibrary URLs all end in an
// opaque token). Sniffing kind from the extension would have mis-typed the
// large majority. A media-role binding IS the occurrence's picture, so `image`
// is the default and an extension only overrides it when we recognize it.
import { describe, it, expect } from "vitest";
import { planMediaConversion, kindForRef, isExternalRef } from "../migrations/0043-media-fields-to-artifacts.mjs";

const F_MEDIA = "f-poster";

function owner(id, value, { moduleId = "m-movie" } = {}) {
  return { id, moduleId, label: id, fields: value === undefined ? {} : { [F_MEDIA]: { value } } };
}
const MOVIE_MODULE = { id: "m-movie", label: "Movie", fieldBindings: [{ fieldId: F_MEDIA, role: "media" }] };

describe("kindForRef", () => {
  it("defaults to image when the extension is unrecognizable", () => {
    // The real shapes on the live grid — an opaque token, not a file type.
    expect(kindForRef("https://tse2.mm.bing.net/th?id=OIP.bVhZj9k")).toBe("image");
    expect(kindForRef("https://i.pravatar.cc/300")).toBe("image");
    expect(kindForRef("https://covers.openlibrary.org/b/id/8231856-L")).toBe("image");
  });

  it("honours an extension we DO recognize", () => {
    expect(kindForRef("user/2026-08/clip.mp4")).toBe("video");
    expect(kindForRef("user/2026-08/note.pdf")).toBe("pdf");
    expect(kindForRef("user/2026-08/take.m4a")).toBe("audio");
    expect(kindForRef("https://x.test/poster.JPG")).toBe("image");
  });

  it("ignores a query string when reading the extension", () => {
    expect(kindForRef("https://x.test/clip.mp4?token=abc.def")).toBe("video");
  });

  it("never throws on junk", () => {
    expect(kindForRef("")).toBe("image");
    expect(kindForRef(null)).toBe("image");
  });
});

describe("isExternalRef", () => {
  it("separates absolute URLs from our own upload paths", () => {
    expect(isExternalRef("https://x.test/a.jpg")).toBe(true);
    expect(isExternalRef("data:image/png;base64,AAA")).toBe(true);
    expect(isExternalRef("user/2026-08/a.jpg")).toBe(false);
  });
});

describe("planMediaConversion", () => {
  it("converts a string value on a media-bound module", () => {
    const { conversions } = planMediaConversion({
      occurrences: [owner("o1", "https://x.test/inception.jpg")],
      modules: [MOVIE_MODULE],
    });
    expect(conversions).toHaveLength(1);
    expect(conversions[0]).toMatchObject({
      ownerOccId: "o1", ownerModuleId: "m-movie", mediaFieldId: F_MEDIA,
      ref: "https://x.test/inception.jpg", kind: "image", external: true,
    });
  });

  it("IS IDEMPOTENT — a value already naming an artifact occurrence is skipped", () => {
    const { conversions, skipped } = planMediaConversion({
      occurrences: [
        owner("o1", "art1"),
        { id: "art1", moduleId: "m-art", fields: {} },
      ],
      modules: [MOVIE_MODULE, { id: "m-art", role: "artifact", kind: "image", fileRef: "x.jpg" }],
    });
    expect(conversions).toHaveLength(0);
    expect(skipped[0].why).toBe("already an artifact id");
  });

  it("does NOT skip a string that merely looks like an id but resolves to a non-artifact", () => {
    const { conversions } = planMediaConversion({
      occurrences: [owner("o1", "o-other"), { id: "o-other", moduleId: "m-movie", fields: {} }],
      modules: [MOVIE_MODULE],
    });
    expect(conversions).toHaveLength(1);
  });

  it("ignores occurrences whose module binds no media field", () => {
    const { conversions } = planMediaConversion({
      occurrences: [{ id: "o1", moduleId: "m-plain", fields: { [F_MEDIA]: { value: "x.jpg" } } }],
      modules: [{ id: "m-plain", fieldBindings: [{ fieldId: F_MEDIA, role: "input" }] }],
    });
    expect(conversions).toHaveLength(0);
  });

  it("ignores empty and missing values rather than minting empty artifacts", () => {
    const { conversions } = planMediaConversion({
      occurrences: [owner("o1", ""), owner("o2"), owner("o3", null)],
      modules: [MOVIE_MODULE],
    });
    expect(conversions).toHaveLength(0);
  });

  it("unwraps the {value, flow} shape AND accepts a bare value", () => {
    const wrapped = { id: "o1", moduleId: "m-movie", fields: { [F_MEDIA]: { value: "a.jpg", flow: "replace" } } };
    const bare = { id: "o2", moduleId: "m-movie", fields: { [F_MEDIA]: "b.jpg" } };
    const { conversions } = planMediaConversion({ occurrences: [wrapped, bare], modules: [MOVIE_MODULE] });
    expect(conversions.map(c => c.ref)).toEqual(["a.jpg", "b.jpg"]);
  });

  it("reports a non-string value as skipped instead of converting it", () => {
    const { conversions, skipped } = planMediaConversion({
      occurrences: [owner("o1", ["a", "b"])],
      modules: [MOVIE_MODULE],
    });
    expect(conversions).toHaveLength(0);
    expect(skipped[0].why).toBe("value is not a string");
  });

  it("labels the artifact from the OWNER, so a poster is not named after a URL", () => {
    const occ = { id: "o1", moduleId: "m-movie", label: "Inception", fields: { [F_MEDIA]: { value: "x.jpg" } } };
    const { conversions } = planMediaConversion({ occurrences: [occ], modules: [MOVIE_MODULE] });
    expect(conversions[0].label).toBe("Inception");
  });

  it("falls back to the MODULE label when the occurrence has none", () => {
    const occ = { id: "o1", moduleId: "m-movie", fields: { [F_MEDIA]: { value: "x.jpg" } } };
    const { conversions } = planMediaConversion({ occurrences: [occ], modules: [MOVIE_MODULE] });
    expect(conversions[0].label).toBe("Movie");
  });
});
