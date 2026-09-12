// Opening a bookmark in a panel: which panel, and does it refuse cleanly.
//
// The two heavy steps (mint the artifact page, pin it) are existing, tested
// paths; what is new is the decision, so that is what is asserted here.
import { describe, it, expect, vi, beforeEach } from "vitest";

const ensureArtifactPageOcc = vi.fn(() => "page-1");
const openOccurrenceInPanel = vi.fn();
const addBookmarkOccurrence = vi.fn();
const updateModule = vi.fn();
const updateOccurrence = vi.fn();
vi.mock("../helpers/importsFolder", () => ({ ensureArtifactPageOcc: (...a) => ensureArtifactPageOcc(...a) }));
vi.mock("../helpers/openOccurrenceInPanel", () => ({ openOccurrenceInPanel: (...a) => openOccurrenceInPanel(...a) }));
vi.mock("../helpers/CommitHelpers", () => ({
  addBookmarkOccurrence: (...a) => addBookmarkOccurrence(...a),
  updateModule: (...a) => updateModule(...a),
  updateOccurrence: (...a) => updateOccurrence(...a),
}));

import {
  openBookmarkInPanel, openUrlInPanel, canOpenUrlAsPage, browserForOccurrence, _resetPendingBrowsers,
} from "../helpers/openBookmark";
import { TARGET_PANEL_KEY } from "../helpers/targetPanel";

const occurrencesById = { bm: { id: "bm", moduleId: "m", gridId: "g", userId: "u" } };
const modulesById = { m: { id: "m", role: "artifact", kind: "bookmark" } };
const panelsById = { pA: { id: "pA" }, pC: { id: "pC" } };
const call = (over = {}) => openBookmarkInPanel({
  occId: "bm", grid: {}, fromPanelOccId: "pA", panelsById,
  occurrencesById, modulesById, viewsById: {}, dispatch: vi.fn(), socket: {}, ...over,
});

beforeEach(() => {
  ensureArtifactPageOcc.mockReset(); openOccurrenceInPanel.mockReset();
  addBookmarkOccurrence.mockReset(); updateModule.mockReset(); updateOccurrence.mockReset();
  ensureArtifactPageOcc.mockReturnValue("page-1");
  addBookmarkOccurrence.mockImplementation(({ url, label, meta, containerOccurrence }) => {
    const module = { id: "bm-mod", role: "artifact", kind: "bookmark", fileRef: url, label };
    const occurrence = { id: "bm-occ", moduleId: "bm-mod", parentId: containerOccurrence.id, meta: { ...meta, url } };
    return { moduleId: module.id, occurrenceId: occurrence.id, module, occurrence };
  });
  _resetPendingBrowsers();
});

describe("openBookmarkInPanel", () => {
  it("opens in the panel it was clicked from when nothing is set", () => {
    expect(call()).toMatchObject({ ok: true, panelId: "pA", via: "here" });
    expect(openOccurrenceInPanel).toHaveBeenCalledWith(expect.objectContaining({ occId: "page-1" }));
  });

  it("opens in the STICKY target when one is set", () => {
    expect(call({ grid: { meta: { [TARGET_PANEL_KEY]: "pC" } } }))
      .toMatchObject({ ok: true, panelId: "pC", via: "target" });
  });

  it("falls back to HERE when the target is gone, and says it was stale", () => {
    expect(call({ grid: { meta: { [TARGET_PANEL_KEY]: "pGone" } } }))
      .toMatchObject({ ok: true, panelId: "pA", via: "stale" });
  });

  it("mints the artifact page BEFORE pinning", () => {
    // Pinning first would ask the panel to show an id that does not resolve
    // yet — the created-but-unlinked shape from the other direction.
    const order = [];
    ensureArtifactPageOcc.mockImplementation(() => { order.push("ensure"); return "page-1"; });
    openOccurrenceInPanel.mockImplementation(() => { order.push("open"); });
    call();
    expect(order).toEqual(["ensure", "open"]);
  });

  it("REFUSES a non-artifact rather than opening something odd", () => {
    const r = openBookmarkInPanel({
      occId: "bm", grid: {}, fromPanelOccId: "pA", panelsById,
      occurrencesById, modulesById: { m: { id: "m", role: "instance" } },
      viewsById: {}, dispatch: vi.fn(), socket: {},
    });
    expect(r).toMatchObject({ ok: false, reason: "not an artifact" });
    expect(openOccurrenceInPanel).not.toHaveBeenCalled();
  });

  it("REFUSES when there is no panel at all", () => {
    expect(call({ panelsById: {}, fromPanelOccId: null }))
      .toMatchObject({ ok: false, reason: "no panel to open in" });
  });

  it("REFUSES when the artifact page cannot be resolved", () => {
    ensureArtifactPageOcc.mockReturnValue(null);
    expect(call()).toMatchObject({ ok: false, reason: "could not resolve an artifact page" });
    expect(openOccurrenceInPanel).not.toHaveBeenCalled();
  });
});

// ── Any row with a link ─────────────────────────────────────────────────────
const URL_F = "f-website";
const fieldsById = { [URL_F]: { id: URL_F, name: "Website" } };
const place = { id: "place", moduleId: "pm", gridId: "g", userId: "u", fields: { [URL_F]: { value: "https://example.com/a" } } };
const placeMod = { id: "pm", role: "instance", label: "Coffee Shop" };
const rowCall = (over = {}) => openUrlInPanel({
  occId: "place", grid: {}, fromPanelOccId: "pA", panelsById,
  occurrencesById: { place }, modulesById: { pm: placeMod }, viewsById: {}, fieldsById,
  dispatch: vi.fn(), socket: {}, ...over,
});

describe("openUrlInPanel", () => {
  it("a BOOKMARK opens as itself — no second browser is minted", () => {
    const r = openUrlInPanel({
      occId: "bm", grid: {}, fromPanelOccId: "pA", panelsById,
      occurrencesById, modulesById, viewsById: {}, dispatch: vi.fn(), socket: {},
    });
    expect(r).toMatchObject({ ok: true, panelId: "pA" });
    expect(addBookmarkOccurrence).not.toHaveBeenCalled();
    expect(ensureArtifactPageOcc).toHaveBeenCalledWith(expect.objectContaining({ artifactOccId: "bm" }));
  });

  it("a row with a url FIELD gets ONE browser, parented to it and NOT listed by it", () => {
    expect(rowCall()).toMatchObject({ ok: true, panelId: "pA" });
    expect(addBookmarkOccurrence).toHaveBeenCalledTimes(1);
    const args = addBookmarkOccurrence.mock.calls[0][0];
    expect(args.containerOccurrence.id).toBe("place");
    expect(args.list).toBe(false); // the row's own occurrences[] is never written
    expect(args.url).toBe("https://example.com/a");
    expect(args.meta).toEqual({ browserFor: "place" });
    expect(args.label).toBe("Coffee Shop");
    // The page is resolved for the BROWSER, with maps that already hold it.
    const ensure = ensureArtifactPageOcc.mock.calls[0][0];
    expect(ensure.artifactOccId).toBe("bm-occ");
    expect(ensure.occurrencesById["bm-occ"]).toBeTruthy();
    expect(ensure.modulesById["bm-mod"]).toBeTruthy();
  });

  it("opening the same row again REUSES its browser", () => {
    const existing = { id: "bm-occ", moduleId: "bm-mod", meta: { browserFor: "place", url: "https://example.com/a" } };
    rowCall({
      occurrencesById: { place, "bm-occ": existing },
      modulesById: { pm: placeMod, "bm-mod": { id: "bm-mod", role: "artifact", kind: "bookmark", fileRef: "https://example.com/a" } },
    });
    expect(addBookmarkOccurrence).not.toHaveBeenCalled();
    expect(updateModule).not.toHaveBeenCalled();
    expect(ensureArtifactPageOcc.mock.calls[0][0].artifactOccId).toBe("bm-occ");
  });

  it("a second click BEFORE the store catches up does not mint a second browser", () => {
    rowCall();
    rowCall(); // same stale maps: the first browser is not in them yet
    expect(addBookmarkOccurrence).toHaveBeenCalledTimes(1);
    expect(ensureArtifactPageOcc).toHaveBeenCalledTimes(2);
  });

  it("an EDITED url retargets the existing browser instead of minting", () => {
    const existing = { id: "bm-occ", moduleId: "bm-mod", meta: { browserFor: "place", url: "https://old.example" } };
    rowCall({
      occurrencesById: { place, "bm-occ": existing },
      modulesById: { pm: placeMod, "bm-mod": { id: "bm-mod", role: "artifact", kind: "bookmark", fileRef: "https://old.example" } },
    });
    expect(addBookmarkOccurrence).not.toHaveBeenCalled();
    expect(updateModule.mock.calls[0][0].module.fileRef).toBe("https://example.com/a");
    expect(updateOccurrence.mock.calls[0][0].occurrence.meta).toEqual({ browserFor: "place", url: "https://example.com/a" });
  });

  it("REFUSES a picture stored BY url — the url is the file, not a page", () => {
    const img = { id: "img", moduleId: "im", gridId: "g", userId: "u", fields: {} };
    const r = openUrlInPanel({
      occId: "img", grid: {}, fromPanelOccId: "pA", panelsById,
      occurrencesById: { img }, modulesById: { im: { id: "im", role: "artifact", kind: "image", fileRef: "https://x/y.jpg" } },
      viewsById: {}, dispatch: vi.fn(), socket: {},
    });
    expect(r).toMatchObject({ ok: false, reason: "no link to open" });
    expect(addBookmarkOccurrence).not.toHaveBeenCalled();
  });

  it("REFUSES with no panel BEFORE minting anything", () => {
    expect(rowCall({ panelsById: {}, fromPanelOccId: null })).toMatchObject({ ok: false, reason: "no panel to open in" });
    expect(addBookmarkOccurrence).not.toHaveBeenCalled();
  });
});

describe("canOpenUrlAsPage", () => {
  it("offers the button exactly where there is a page to open", () => {
    expect(canOpenUrlAsPage(occurrencesById.bm, modulesById.m)).toBe(true);
    expect(canOpenUrlAsPage(place, placeMod)).toBe(true);
    // A picture stored by url: the url IS the file.
    expect(canOpenUrlAsPage({ id: "i", fields: {} }, { role: "artifact", kind: "image", fileRef: "https://x/y.jpg" })).toBe(false);
    // A link chip carries its own arrow.
    expect(canOpenUrlAsPage({ id: "c", meta: { link: { kind: "url", url: "https://x" } } }, { role: "textblock", kind: "inline" })).toBe(false);
    expect(canOpenUrlAsPage({ id: "n", fields: { a: { value: "plain text" } } }, { role: "instance" })).toBe(false);
    expect(canOpenUrlAsPage(null, placeMod)).toBe(false);
  });

  it("finds a row's browser by `meta.browserFor`", () => {
    const b = { id: "b", meta: { browserFor: "place" } };
    expect(browserForOccurrence("place", { place, b })).toBe(b);
    expect(browserForOccurrence("other", { place, b })).toBe(null);
  });
});
