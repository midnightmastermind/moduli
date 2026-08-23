// What a right-click becomes.
//
// An MV3 extension cannot be loaded in this environment — established by trying,
// not assumed — so the plumbing around this module is unverifiable here. These
// are the DECISIONS, which are where the mistakes live.
import { describe, it, expect } from "vitest";
import {
  clipShapeFor, clipUrlFor, clipLabelFor, clipModuleShape, buildClipRecord, CLIP_MENUS,
} from "../../extension/clip.js";

const tab = { title: "Dan Brown — Official Site", url: "https://danbrown.com/" };

describe("clipShapeFor", () => {
  it("takes the menu item the user actually chose", () => {
    expect(clipShapeFor({ menuItemId: "clip-page", linkUrl: "https://x/", srcUrl: "https://y.png" })).toBe("page");
  });

  it("PREFERS the menu id over the payload — a linked image inside a selection", () => {
    // Chrome populates selectionText, linkUrl and srcUrl TOGETHER for that
    // right-click. Guessing from the payload would silently clip the image when
    // the user asked for the link.
    const info = { menuItemId: "clip-link", selectionText: "words", linkUrl: "https://link/", srcUrl: "https://img.png" };
    expect(clipShapeFor(info)).toBe("link");
  });

  it("falls back to the payload when there is no menu id", () => {
    expect(clipShapeFor({ srcUrl: "https://i.png" })).toBe("image");
    expect(clipShapeFor({ linkUrl: "https://l/" })).toBe("link");
    expect(clipShapeFor({ selectionText: "hi" })).toBe("selection");
    expect(clipShapeFor({})).toBe("page");
  });
});

describe("clipUrlFor", () => {
  it("a link clip takes the LINK, not the page it was on", () => {
    // "a bookmark, without visiting it" — the whole point of the link context.
    expect(clipUrlFor("link", { linkUrl: "https://target/", pageUrl: "https://here/" }, tab)).toBe("https://target/");
  });
  it("an image clip takes the image source", () => {
    expect(clipUrlFor("image", { srcUrl: "https://i.png", pageUrl: "https://here/" }, tab)).toBe("https://i.png");
  });
  it("a page or selection clip takes the page", () => {
    expect(clipUrlFor("page", {}, tab)).toBe("https://danbrown.com/");
    expect(clipUrlFor("selection", { pageUrl: "https://here/" }, tab)).toBe("https://here/");
  });
});

describe("clipLabelFor", () => {
  it("names a SELECTION by its own words, not the page title", () => {
    // Otherwise a board of clips from one article is a column of identical
    // labels and you cannot tell which sentence you kept.
    expect(clipLabelFor("selection", { selectionText: "The unexamined life" }, tab)).toBe("The unexamined life");
  });

  it("truncates a long selection with an ellipsis rather than storing a wall", () => {
    const long = "x".repeat(300);
    const out = clipLabelFor("selection", { selectionText: long }, tab);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith("…")).toBe(true);
  });

  it("collapses whitespace, so a multi-line selection is one line", () => {
    expect(clipLabelFor("selection", { selectionText: "two\n\n  lines" }, tab)).toBe("two lines");
  });

  it("names a page by its title", () => {
    expect(clipLabelFor("page", {}, tab)).toBe("Dan Brown — Official Site");
  });

  it("never returns an empty label", () => {
    // A nameless row is a blank line in every list that shows it.
    expect(clipLabelFor("page", {}, {})).toBe("Clipped page");
    expect(clipLabelFor("selection", {}, {})).toBe("Clipped text");
    expect(clipLabelFor("image", {}, {})).toBe("Clipped image");
    expect(clipLabelFor("link", {}, {})).toBe("Clipped link");
  });
});

describe("clipModuleShape", () => {
  it("an image is an image artifact; everything else is a bookmark", () => {
    expect(clipModuleShape("image")).toEqual({ moduleRole: "artifact", moduleKind: "image" });
    for (const s of ["page", "link", "selection"]) {
      expect(clipModuleShape(s)).toEqual({ moduleRole: "artifact", moduleKind: "bookmark" });
    }
  });
});

describe("buildClipRecord", () => {
  const fieldIds = { URL: "fUrl", Excerpt: "fExc", Cover: "fCov" };

  it("builds an ingest record for a page clip", () => {
    const rec = buildClipRecord({ info: { menuItemId: "clip-page" }, tab, fieldIds, parentId: "P" });
    expect(rec).toMatchObject({
      externalId: "page:https://danbrown.com/",
      moduleRole: "artifact", moduleKind: "bookmark",
      moduleFileRef: "https://danbrown.com/",
      parentId: "P",
    });
    expect(rec.fields.fUrl).toEqual({ value: "https://danbrown.com/", flow: "in" });
  });

  it("puts a selection's TEXT in Excerpt and the page in URL", () => {
    const rec = buildClipRecord({
      info: { menuItemId: "clip-selection", selectionText: "kept words", pageUrl: "https://p/" },
      tab, fieldIds,
    });
    expect(rec.fields.fExc).toEqual({ value: "kept words", flow: "in" });
    expect(rec.fields.fUrl).toEqual({ value: "https://p/", flow: "in" });
  });

  it("SKIPS a field it has no id for rather than inventing one", () => {
    // Writing to a made-up field id produces a value nothing renders — present
    // in the data, invisible on screen.
    const rec = buildClipRecord({
      info: { menuItemId: "clip-selection", selectionText: "x", pageUrl: "https://p/" },
      tab, fieldIds: { URL: "fUrl" },
    });
    expect(Object.keys(rec.fields)).toEqual(["fUrl"]);
  });

  it("keys identity by SHAPE AND URL, so an image and its page stay apart", () => {
    const page = buildClipRecord({ info: { menuItemId: "clip-page", pageUrl: "https://a/" }, tab, fieldIds });
    const img  = buildClipRecord({ info: { menuItemId: "clip-image", srcUrl: "https://a/" }, tab, fieldIds });
    expect(page.externalId).not.toBe(img.externalId);
  });

  it("re-clipping the SAME page yields the same externalId — one row, not two", () => {
    const a = buildClipRecord({ info: { menuItemId: "clip-page" }, tab, fieldIds });
    const b = buildClipRecord({ info: { menuItemId: "clip-page" }, tab, fieldIds });
    expect(a.externalId).toBe(b.externalId);
  });

  it("returns null when there is no URL at all", () => {
    // A clip with no identity cannot be idempotent, and re-clipping it would
    // pile up duplicates for ever. Better to refuse and say so.
    expect(buildClipRecord({ info: { menuItemId: "clip-page" }, tab: {}, fieldIds })).toBeNull();
  });

  it("omits parentId rather than sending null", () => {
    const rec = buildClipRecord({ info: { menuItemId: "clip-page" }, tab, fieldIds });
    expect("parentId" in rec).toBe(false);
  });
});

describe("CLIP_MENUS", () => {
  it("declares exactly the four contexts the spec names", () => {
    expect(CLIP_MENUS.map(m => m.contexts[0]).sort()).toEqual(["image", "link", "page", "selection"]);
  });
  it("every menu id maps back to a shape", () => {
    for (const m of CLIP_MENUS) expect(clipShapeFor({ menuItemId: m.id })).toBe(m.contexts[0]);
  });
});
