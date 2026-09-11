// ui/ArtifactSpreadHost — the HOST, which is where the arrangement is decided.
//
// `ArtifactSpread.test.jsx` covers the SHELL and passed the whole time the
// spread laid its files out as a vertical list: the shell deliberately owns no
// arrangement, so no assertion there can see this. The arrangement comes from
// the layout cascade on the overlay-only page the HOST mints — and the host
// minted it with no layout at all, so `resolveLayoutCascade` fell to the board
// default (`mode: "stack"`) and every artifact took a full-width row.
//
// `ModuleContainer` has had the wrapping-grid mode since 2026-08-10
// (`mode: "wrap"` → `.container-items--wrap`); nothing turned it on here. So
// these tests assert on what LEAVES the host — the writes — never on pixels.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

vi.mock("../modules/ModuleContainer", () => ({
  default: () => React.createElement("div", { "data-testid": "container" }),
}));
vi.mock("../ui/ImagePickerMenu", () => ({ openImagePicker: vi.fn() }));

// The owner's files. The host only needs the ids, so one stub artifact is enough.
// `vi.hoisted` because vi.mock factories are lifted above every other statement.
const { FILE_OCC, commits } = vi.hoisted(() => ({
  FILE_OCC: { id: "art-1" },
  commits: {
    createModule: vi.fn(),
    createOccurrence: vi.fn(),
    updateOccurrence: vi.fn(),
    updateModule: vi.fn(),
    addImageArtifactFromUrl: vi.fn(),
    addBookmarkOccurrence: vi.fn(() => ({ moduleId: "mod-br", occurrenceId: "occ-br" })),
  },
}));
vi.mock("../helpers/occurrenceMedia", () => ({ filesOf: () => [{ occ: FILE_OCC }] }));
vi.mock("../helpers/CommitHelpers", () => commits);

// Rebuilt per test so each case controls what already exists on the grid.
let STATE = {};
vi.mock("../GridActionsContext", () => ({
  useGridActionsSelector: (sel) => sel(STATE),
  useGridActionsSelectorShallow: (sel) => sel(STATE),
}));

import { ArtifactSpreadHost, openArtifactSpread } from "../ui/ArtifactSpreadHost";
// NOT mocked — the point of the last test is that these are the real ones.
import { buildLayoutCascadeContext, resolveLayoutCascade } from "../helpers/layoutCascade";

const OWNER = { id: "occ-owner", moduleId: "mod-owner", meta: {} };

function setGrid({ occurrencesById, modulesById, fieldsById = {} }) {
  STATE = {
    dispatch: vi.fn(),
    socket: {},
    gridId: "grid-1",
    userId: "user-1",
    occurrencesById,
    modulesById,
    fieldsById,
  };
}

function openFor(ownerId) {
  render(React.createElement(ArtifactSpreadHost));
  act(() => { openArtifactSpread(ownerId); });
}

beforeEach(() => {
  Object.values(commits).forEach((fn) => fn.mockReset());
  // `mockReset` clears the implementation too, so the mint must be re-armed or
  // every caller reads `undefined` for the id it just created.
  commits.addBookmarkOccurrence.mockReturnValue({ moduleId: "mod-br", occurrenceId: "occ-br" });
});
afterEach(() => { cleanup(); });

describe("ArtifactSpreadHost arranges the spread as a grid", () => {
  it("mints the overlay page with a WRAPPING layout, not the stack default", () => {
    setGrid({
      occurrencesById: { [OWNER.id]: OWNER },
      modulesById: { "mod-owner": { id: "mod-owner", label: "Zucchini" } },
    });
    openFor(OWNER.id);

    expect(commits.createOccurrence).toHaveBeenCalledTimes(1);
    const { occurrence } = commits.createOccurrence.mock.calls[0][0];
    // The cascade key a container reads for its OWN children (SURFACE_SHAPE_KEYS).
    expect(occurrence.meta.layoutCascade.mode).toBe("wrap");
    // Still the overlay-only marker — the layout must not have displaced it.
    expect(occurrence.meta.spreadFor).toBe(OWNER.id);
    // The tile SIZE is deliberately NOT stored: it depends on the viewport and
    // the file count, which a stored pixel cannot know. Storing one is what
    // made a full-size overlay hold four small tiles in a sea of empty.
    expect(occurrence.meta.layoutCascade.childMinWidth).toBeUndefined();
    expect(occurrence.meta.layoutCascade.childMaxHeight).toBeUndefined();
  });

  it("HEALS a spread page minted before the layout existed", () => {
    // Every spread opened before this change is already in the database with no
    // layout on it. Fixing only the mint would leave those stacked forever —
    // the "shipped and does nothing" class this repo keeps paying for.
    const spread = { id: "occ-spread", moduleId: "mod-spread", meta: { spreadFor: OWNER.id }, occurrences: [FILE_OCC.id] };
    setGrid({
      occurrencesById: { [OWNER.id]: { ...OWNER, meta: { spreadPageId: spread.id } }, [spread.id]: spread },
      modulesById: { "mod-owner": { id: "mod-owner", label: "Zucchini" }, "mod-spread": { id: "mod-spread", kind: "board" } },
    });
    openFor(OWNER.id);

    expect(commits.createOccurrence).not.toHaveBeenCalled();
    const healed = commits.updateOccurrence.mock.calls
      .map((c) => c[0].occurrence)
      .find((o) => o?.id === spread.id && o?.meta?.layoutCascade);
    expect(healed).toBeTruthy();
    expect(healed.meta.layoutCascade.mode).toBe("wrap");
    expect(healed.meta.spreadFor).toBe(OWNER.id);
  });

  it("PRUNES the owner out of its own spread page", () => {
    // `filesOf` used to push the owner when it was itself role:"artifact" —
    // every media row since the 0222 import. The mint snapshots `files` INTO
    // the page, so that phantom was PERSISTED on first open, and the top-up is
    // additive by design and cannot retract it: the row drew a second card
    // from its own cover, i.e. the same poster twice, over "2 files".
    const spread = {
      id: "occ-spread", moduleId: "mod-spread",
      meta: { spreadFor: OWNER.id, layoutCascade: { mode: "wrap" } },
      occurrences: [OWNER.id, FILE_OCC.id],          // the owner listed as its own file
    };
    setGrid({
      occurrencesById: { [OWNER.id]: { ...OWNER, meta: { spreadPageId: spread.id } }, [spread.id]: spread },
      modulesById: { "mod-owner": { id: "mod-owner", label: "Zucchini" }, "mod-spread": { id: "mod-spread", kind: "board" } },
    });
    openFor(OWNER.id);

    const pruned = commits.updateOccurrence.mock.calls
      .map((c) => c[0].occurrence)
      .find((o) => o?.id === spread.id);
    expect(pruned).toBeTruthy();
    expect(pruned.occurrences).toEqual([FILE_OCC.id]);
  });

  it("CONTROL — a page that does NOT list its owner is left alone", () => {
    // Without this the prune could be a blanket rewrite and still pass above.
    const spread = {
      id: "occ-spread", moduleId: "mod-spread",
      meta: { spreadFor: OWNER.id, layoutCascade: { mode: "wrap" } },
      occurrences: [FILE_OCC.id],
    };
    setGrid({
      occurrencesById: { [OWNER.id]: { ...OWNER, meta: { spreadPageId: spread.id } }, [spread.id]: spread },
      modulesById: { "mod-owner": { id: "mod-owner", label: "Zucchini" }, "mod-spread": { id: "mod-spread", kind: "board" } },
    });
    openFor(OWNER.id);
    expect(commits.updateOccurrence).not.toHaveBeenCalled();
  });

  it("the layout it writes is the one ModuleContainer READS (real resolver)", () => {
    // The write above is worthless if the key is not the key the renderer
    // reads — the "shipped and inert" class. So this drives the REAL cascade
    // helpers over the REAL minted meta, exactly as ModuleContainer does
    // (`buildLayoutCascadeContext({leafOccurrence: containerOccurrence, …})`
    // → `resolveLayoutCascade(ctx, "container")` → `resolved.mode === "wrap"`
    // is what flips `.container-items--wrap`). No mocks in this path.
    setGrid({
      occurrencesById: { [OWNER.id]: OWNER },
      modulesById: { "mod-owner": { id: "mod-owner", label: "Zucchini" } },
    });
    openFor(OWNER.id);
    const { occurrence } = commits.createOccurrence.mock.calls[0][0];
    const spreadModule = { id: occurrence.moduleId, role: "container", kind: "board" };

    const ctx = buildLayoutCascadeContext({
      leafOccurrence: occurrence,
      occurrencesById: { [occurrence.id]: occurrence },
      modulesById: { [spreadModule.id]: spreadModule },
      grid: {},
    });
    const { resolved } = resolveLayoutCascade(ctx, "container");

    expect(resolved.mode).toBe("wrap");            // the stack default is beaten
  });

  it("NEVER overwrites an arrangement the user chose", () => {
    // The board⇄canvas switch and the Layout menu both write here. A default
    // that re-asserts itself on every open is not a default, it is a lock.
    const spread = {
      id: "occ-spread",
      moduleId: "mod-spread",
      meta: { spreadFor: OWNER.id, layoutCascade: { mode: "stack" } },
      occurrences: [FILE_OCC.id],
    };
    setGrid({
      occurrencesById: { [OWNER.id]: { ...OWNER, meta: { spreadPageId: spread.id } }, [spread.id]: spread },
      modulesById: { "mod-owner": { id: "mod-owner", label: "Zucchini" }, "mod-spread": { id: "mod-spread", kind: "board" } },
    });
    openFor(OWNER.id);

    const rewrote = commits.updateOccurrence.mock.calls
      .map((c) => c[0].occurrence)
      .some((o) => o?.id === spread.id && o?.meta?.layoutCascade?.mode === "wrap");
    expect(rewrote).toBe(false);
  });
});

// ── THE URL TILE ───────────────────────────────────────────────────────────
//
// `spreadBrowser.test.js` drives the DECISION; nothing there can see whether
// the host calls it, passes `list: false`, or lists what it minted. Driving the
// callee proves nothing about the call — the class this repo has paid for four
// times — so these assert on the WRITES that leave the host.
const URL_FIELDS = { "f-url": { id: "f-url", name: "URL" } };
const LINKED = {
  id: "occ-owner", moduleId: "mod-owner", meta: {},
  fields: { "f-url": { value: "https://washingtonpost.com/a" } },
};

function openLinked(over = {}) {
  const spread = {
    id: "occ-spread", moduleId: "mod-spread",
    meta: { spreadFor: LINKED.id, layoutCascade: { mode: "wrap" } },
    occurrences: [FILE_OCC.id],
    ...over.spread,
  };
  setGrid({
    occurrencesById: {
      [LINKED.id]: { ...LINKED, meta: { ...LINKED.meta, spreadPageId: spread.id } },
      [spread.id]: spread,
      ...over.occurrencesById,
    },
    modulesById: {
      "mod-owner": { id: "mod-owner", label: "House of Cards", role: "artifact", kind: "bookmark", fileRef: "" },
      "mod-spread": { id: "mod-spread", kind: "board" },
      ...over.modulesById,
    },
    fieldsById: URL_FIELDS,
  });
  openFor(LINKED.id);
  return spread;
}

const pageWrite = (id) => commits.updateOccurrence.mock.calls
  .map((c) => c[0].occurrence).find((o) => o?.id === id);

describe("the viewer shows files AND urls", () => {
  it("mints the url tile UNLISTED, and lists it in the write that records it", () => {
    const spread = openLinked();

    expect(commits.addBookmarkOccurrence).toHaveBeenCalledTimes(1);
    const mint = commits.addBookmarkOccurrence.mock.calls[0][0];
    expect(mint.url).toBe("https://washingtonpost.com/a");
    expect(mint.label).toBe("washingtonpost.com");
    // The parent is the OVERLAY-ONLY page, never the owner's own Files field —
    // user, 2026-09-11: *"only merge it into files when its in the viewer"*.
    expect(mint.containerOccurrence.id).toBe(spread.id);
    // UNLISTED on purpose: one writer of the array, or the two writes in this
    // commit clobber each other off the same snapshot.
    expect(mint.list).toBe(false);

    const wrote = pageWrite(spread.id);
    expect(wrote.occurrences).toContain("occ-br");
    expect(wrote.occurrences).toContain(FILE_OCC.id);
    // Recorded in the SAME write, or the next open mints a second one.
    expect(wrote.meta.browserOccId).toBe("occ-br");
  });

  it("CONTROL — an owner that points nowhere gets no tile", () => {
    // Without this, "mints a url tile" is also satisfied by a host that mints
    // one for everything.
    const spread = {
      id: "occ-spread", moduleId: "mod-spread",
      meta: { spreadFor: OWNER.id, layoutCascade: { mode: "wrap" } },
      occurrences: [FILE_OCC.id],
    };
    setGrid({
      occurrencesById: { [OWNER.id]: { ...OWNER, meta: { spreadPageId: spread.id } }, [spread.id]: spread },
      modulesById: { "mod-owner": { id: "mod-owner", label: "Zucchini" }, "mod-spread": { id: "mod-spread", kind: "board" } },
    });
    openFor(OWNER.id);
    expect(commits.addBookmarkOccurrence).not.toHaveBeenCalled();
  });

  it("CONTROL — an artifact whose url IS its file gets no tile", () => {
    // 1,507 image rows on the live grid are stored by url. A browser tile there
    // frames the very picture the file tile already shows.
    const spread = {
      id: "occ-spread", moduleId: "mod-spread",
      meta: { spreadFor: OWNER.id, layoutCascade: { mode: "wrap" } },
      occurrences: [FILE_OCC.id],
    };
    setGrid({
      occurrencesById: { [OWNER.id]: { ...OWNER, meta: { spreadPageId: spread.id } }, [spread.id]: spread },
      modulesById: {
        "mod-owner": { id: "mod-owner", role: "artifact", kind: "image", fileRef: "https://image.tmdb.org/x.jpg" },
        "mod-spread": { id: "mod-spread", kind: "board" },
      },
    });
    openFor(OWNER.id);
    expect(commits.addBookmarkOccurrence).not.toHaveBeenCalled();
  });

  it("a SECOND open mints nothing and writes nothing", () => {
    // The loop invariant, at the layer that can actually run forever.
    const spread = openLinked({
      spread: { meta: { spreadFor: LINKED.id, layoutCascade: { mode: "wrap" }, browserOccId: "occ-br" },
                occurrences: [FILE_OCC.id, "occ-br"] },
      occurrencesById: { "occ-br": { id: "occ-br", moduleId: "mod-br", meta: { url: "https://washingtonpost.com/a" } } },
    });
    expect(commits.addBookmarkOccurrence).not.toHaveBeenCalled();
    expect(pageWrite(spread.id)).toBeUndefined();
  });

  it("mints ONCE even if the store has not caught up yet", () => {
    // `planSpreadBrowser` says "done" by reading `meta.browserOccId` back off
    // the page. Between the mint and that write landing, a re-render sees "no
    // browser yet" — so without a re-entry guard this is an unbounded row
    // factory. The mocked store never reflects a write, which makes that window
    // permanent here and is precisely why this test can see the bug.
    openLinked();
    expect(commits.addBookmarkOccurrence).toHaveBeenCalledTimes(1);
    act(() => { openArtifactSpread(LINKED.id); });
    expect(commits.addBookmarkOccurrence).toHaveBeenCalledTimes(1);
  });

  it("RETARGETS the tile when the owner's url is edited, rather than minting a second", () => {
    openLinked({
      spread: { meta: { spreadFor: LINKED.id, layoutCascade: { mode: "wrap" }, browserOccId: "occ-br" },
                occurrences: [FILE_OCC.id, "occ-br"] },
      occurrencesById: { "occ-br": { id: "occ-br", moduleId: "mod-br", meta: { url: "https://old.test/" } } },
      modulesById: { "mod-br": { id: "mod-br", fileRef: "https://old.test/", label: "old.test" } },
    });
    expect(commits.addBookmarkOccurrence).not.toHaveBeenCalled();
    const retargeted = commits.updateOccurrence.mock.calls
      .map((c) => c[0].occurrence).find((o) => o?.id === "occ-br");
    expect(retargeted.meta.url).toBe("https://washingtonpost.com/a");
    const remoduled = commits.updateModule.mock.calls
      .map((c) => c[0].module).find((m) => m?.id === "mod-br");
    expect(remoduled.fileRef).toBe("https://washingtonpost.com/a");
  });

  it("DROPS a recorded tile whose occurrence is gone, in the same write", () => {
    // Minting a replacement without dropping the dead id leaves the page
    // listing an occurrence that does not exist — the dangling-child-ref class
    // this repo has swept five times.
    const spread = openLinked({
      spread: { meta: { spreadFor: LINKED.id, layoutCascade: { mode: "wrap" }, browserOccId: "gone" },
                occurrences: [FILE_OCC.id, "gone"] },
    });
    expect(commits.addBookmarkOccurrence).toHaveBeenCalledTimes(1);
    const wrote = pageWrite(spread.id);
    expect(wrote.occurrences).not.toContain("gone");
    expect(wrote.occurrences).toContain("occ-br");
  });
});
