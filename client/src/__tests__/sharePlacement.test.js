// client/src/__tests__/sharePlacement.test.js
//
// Form state → the body /share receives. Pure, because this is where a wrong
// answer is invisible: the window would look right and write the wrong row.
import { describe, it, expect } from "vitest";
import {
  CLIP_KINDS, clipFromStage, shapeFromDestination, shapeFromKind, autoMappings,
  mappingValue, buildSharePayload, isShapeRow,
} from "../helpers/sharePlacement";

// The IMDb clip that started this (spec §1), staged the way the extension does.
const STAGED = {
  source: "extension", shape: "page",
  url: "https://www.imdb.com/title/tt0473488/",
  title: "A Guide to Recognizing Your Saints (2006) IMDb",
  clip: { meta: { clipShape: "page", clippedFrom: "https://www.imdb.com/title/tt0473488/" } },
};
const CLIP = clipFromStage(STAGED);

// A Movies row as destination search reports it (spec §1, Ruling 2).
const MOVIES = {
  id: "o-movies", label: "Movies", childCount: 993,
  shape: { moduleId: "m-movie", role: "artifact", kind: "movie",
    bindFields: ["f-owned", "f-year", "f-cat"], autoFields: { "f-cat": ["movie"] } },
};

describe("clipFromStage", () => {
  it("tells the page apart from the link on a LINK clip", () => {
    const c = clipFromStage({ shape: "link", url: "https://x.com/linked", clip: { meta: { clippedFrom: "https://blog.example/post" } } });
    expect(c.url).toBe("https://blog.example/post");
    expect(c.linkUrl).toBe("https://x.com/linked");
    expect(c.imageUrl).toBe("");
  });

  it("a LINK clip is titled by the link, not by the page it was on", () => {
    const c = clipFromStage({ shape: "link", url: "https://x/a", title: "Some blog — Home", clip: { label: "The linked article" } });
    expect(c.title).toBe("The linked article");
  });

  it("a PAGE clip keeps the tab's title", () => {
    expect(clipFromStage({ shape: "page", url: "https://x/", title: "Page title", clip: { label: "x/" } }).title).toBe("Page title");
  });

  it("an IMAGE clip's url is the image source", () => {
    expect(clipFromStage({ shape: "image", url: "https://i/x.png" }).imageUrl).toBe("https://i/x.png");
  });

  it("a selection becomes the selected text, and the site is the page's host", () => {
    const c = clipFromStage({ shape: "selection", url: "https://www.imdb.com/t", text: "a quote" });
    expect(c.selection).toBe("a quote");
    expect(c.siteName).toBe("imdb.com");
  });
});

describe("shapeFromDestination", () => {
  it("copies the rows' role, kind and module", () => {
    expect(shapeFromDestination(MOVIES)).toMatchObject({ role: "artifact", kind: "movie", bindingsLike: "m-movie" });
  });

  it("offers the rows' fields and the values they agree on", () => {
    const s = shapeFromDestination(MOVIES);
    expect(s.bindFields).toEqual(["f-owned", "f-year", "f-cat"]);
    expect(s.autoFields).toEqual({ "f-cat": ["movie"] });
  });

  it("falls back to a plain instance when the destination is EMPTY", () => {
    expect(shapeFromDestination({ id: "o-new", childCount: 0, shape: null }))
      .toMatchObject({ role: "instance", kind: null, bindingsLike: null, bindFields: [] });
  });
});

describe("CLIP_KINDS", () => {
  it("carries the app's own labels, not retyped ones", () => {
    const byValue = Object.fromEntries(CLIP_KINDS.map((k) => [k.value, k]));
    expect(byValue.textblock.label).toBe("Textblock");
    expect(byValue.image.label).toBe("Image");
    expect(byValue.bookmark.label).toBe("Bookmark");
  });

  it("an override drops the siblings' bindings — it is not like them", () => {
    expect(shapeFromKind("bookmark")).toMatchObject({ role: "artifact", kind: "bookmark", bindingsLike: null, bindFields: [] });
  });
});

describe("autoMappings", () => {
  it("gives EVERY field the destination's rows bind a row, in their order", () => {
    const rows = autoMappings(shapeFromDestination(MOVIES));
    expect(Object.keys(rows)).toEqual(["f-owned", "f-year", "f-cat"]);
  });

  it("a field the rows agree on arrives filled; the rest arrive empty and are not called (auto)", () => {
    const rows = autoMappings(shapeFromDestination(MOVIES));
    expect(rows["f-cat"]).toMatchObject({ source: "literal", auto: true });
    expect(rows["f-year"]).toEqual({ source: "none", fromShape: true });
    expect(rows["f-year"].auto).toBeUndefined();
  });

  it("both kinds leave with the destination; a row the user mapped does not", () => {
    const rows = autoMappings(shapeFromDestination(MOVIES));
    expect(isShapeRow(rows["f-cat"])).toBe(true);
    expect(isShapeRow(rows["f-year"])).toBe(true);
    expect(isShapeRow({ source: "title" })).toBe(false);
  });

  it("an empty destination adds nothing", () => {
    expect(autoMappings(shapeFromDestination({ id: "o", shape: null }))).toEqual({});
  });
});

describe("mappingValue", () => {
  it("an auto row writes its STORED type, not the string it shows", () => {
    const auto = autoMappings(shapeFromDestination(MOVIES))["f-cat"];
    expect(auto).toMatchObject({ value: "movie", auto: true });
    expect(mappingValue(CLIP, auto)).toEqual(["movie"]);
  });

  it("an edited box wins over everything", () => {
    const auto = autoMappings(shapeFromDestination(MOVIES))["f-cat"];
    expect(mappingValue(CLIP, { ...auto, override: "film" })).toBe("film");
  });
});

describe("buildSharePayload", () => {
  const base = { gridId: "g1", stageId: "s1", stageKey: "k1", clip: CLIP };

  it("auto mode sends no placement and no content — the server reads the stage", () => {
    const p = buildSharePayload({ ...base, mode: "auto" });
    expect(p).toEqual({ mode: "auto", stageId: "s1", stageKey: "k1", gridId: "g1" });
  });

  it("manual mode sends the resolved values, not the mappings", () => {
    const shape = shapeFromDestination(MOVIES);
    const p = buildSharePayload({
      ...base, mode: "manual", destination: MOVIES, shape,
      mappings: { ...autoMappings(shape), "f-year": { source: "title", transform: "year" } },
      labelMapping: { source: "title", transform: "stripSuffix" },
    });
    expect(p.placement).toMatchObject({
      parentId: "o-movies", role: "artifact", kind: "movie", bindingsLike: "m-movie",
      label: "A Guide to Recognizing Your Saints (2006)",
      fields: { "f-year": "2006", "f-cat": ["movie"] },
    });
  });

  it("drops a mapping that resolved to nothing", () => {
    const p = buildSharePayload({
      ...base, mode: "manual", destination: { id: "o1" }, shape: { role: "instance" },
      mappings: { "f-a": { source: "title" }, "f-b": { source: "selection" } },
    });
    expect(Object.keys(p.placement.fields)).toEqual(["f-a"]);
  });

  it("still BINDS a field whose value is empty", () => {
    // A bound-but-empty field is how a row reaches an op that gates on
    // _boundFieldIds — dropping the binding with the value would break that.
    const p = buildSharePayload({
      ...base, mode: "manual", destination: { id: "o1" }, shape: { role: "instance", bindFields: ["f-a"] },
      mappings: { "f-b": { source: "selection" } },
    });
    expect(p.placement.bindFields).toEqual(["f-a", "f-b"]);
  });

  it("a bookmark override carries the page as its file", () => {
    const p = buildSharePayload({ ...base, mode: "manual", destination: { id: "o1" }, shape: shapeFromKind("bookmark"), mappings: {} });
    expect(p.placement.fileRef).toBe("https://www.imdb.com/title/tt0473488/");
  });

  it("carries a chosen cover, trimmed; sends none when empty", () => {
    const shape = shapeFromDestination(MOVIES);
    const withCover = buildSharePayload({ ...base, mode: "manual", destination: MOVIES, shape, mappings: {}, cover: " https://img/p.jpg " });
    expect(withCover.placement.cover).toBe("https://img/p.jpg");
    const none = buildSharePayload({ ...base, mode: "manual", destination: MOVIES, shape, mappings: {}, cover: "  " });
    expect(none.placement).not.toHaveProperty("cover");
  });

  it("an image clip never carries a cover — its picture is its file", () => {
    const p = buildSharePayload({ ...base, mode: "manual", destination: { id: "o1" }, shape: shapeFromKind("image"), mappings: {}, cover: "https://img/p.jpg" });
    expect(p.placement).not.toHaveProperty("cover");
  });

  it("refuses to build a manual payload with no destination", () => {
    expect(() => buildSharePayload({ ...base, mode: "manual", shape: { role: "instance" } })).toThrow(/destination/);
  });
});
