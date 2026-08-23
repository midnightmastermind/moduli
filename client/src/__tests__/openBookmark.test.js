// Opening a bookmark in a panel: which panel, and does it refuse cleanly.
//
// The two heavy steps (mint the artifact page, pin it) are existing, tested
// paths; what is new is the decision, so that is what is asserted here.
import { describe, it, expect, vi, beforeEach } from "vitest";

const ensureArtifactPageOcc = vi.fn(() => "page-1");
const openOccurrenceInPanel = vi.fn();
vi.mock("../helpers/importsFolder", () => ({ ensureArtifactPageOcc: (...a) => ensureArtifactPageOcc(...a) }));
vi.mock("../helpers/openOccurrenceInPanel", () => ({ openOccurrenceInPanel: (...a) => openOccurrenceInPanel(...a) }));

import { openBookmarkInPanel } from "../helpers/openBookmark";
import { TARGET_PANEL_KEY } from "../helpers/targetPanel";

const occurrencesById = { bm: { id: "bm", moduleId: "m", gridId: "g", userId: "u" } };
const modulesById = { m: { id: "m", role: "artifact", kind: "bookmark" } };
const panelsById = { pA: { id: "pA" }, pC: { id: "pC" } };
const call = (over = {}) => openBookmarkInPanel({
  occId: "bm", grid: {}, fromPanelOccId: "pA", panelsById,
  occurrencesById, modulesById, viewsById: {}, dispatch: vi.fn(), socket: {}, ...over,
});

beforeEach(() => { ensureArtifactPageOcc.mockClear(); openOccurrenceInPanel.mockClear(); ensureArtifactPageOcc.mockReturnValue("page-1"); });

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
