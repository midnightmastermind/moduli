// __tests__/openOccurrenceInPanel.test.js
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../helpers/CommitHelpers", () => ({
  pinPageToPanel: vi.fn(),
  updateView: vi.fn(),
}));
vi.mock("../helpers/jumpToOccurrence", () => ({ jumpToOccurrence: vi.fn(() => true) }));

import * as CommitHelpers from "../helpers/CommitHelpers";
import { jumpToOccurrence } from "../helpers/jumpToOccurrence";
import { openOccurrenceInPanel } from "../helpers/openOccurrenceInPanel";

const modulesById = {
  m_page: { id: "m_page", role: "page", kind: "board" },
  m_item: { id: "m_item", role: "instance", kind: "list" },
};
const occurrencesById = {
  page1: { id: "page1", moduleId: "m_page", occurrences: ["item1"] },
  item1: { id: "item1", moduleId: "m_item" },
};
const viewsById = { v1: { id: "v1", activeOccurrenceId: null } };
const base = { occurrencesById, modulesById, viewsById, dispatch: vi.fn(), socket: {} };

beforeEach(() => vi.clearAllMocks());

describe("openOccurrenceInPanel", () => {
  it("pins the ancestor page, activates it, then jumps", () => {
    const panelOccurrence = { id: "panel1", viewId: "v1", occurrences: [] };
    const out = openOccurrenceInPanel({ occId: "item1", panelOccurrence, ...base });
    expect(out).toMatchObject({ ok: true, pageOccId: "page1" });
    expect(CommitHelpers.pinPageToPanel).toHaveBeenCalledWith(
      expect.objectContaining({ pageOccurrenceId: "page1", panelOccurrenceId: "panel1" }));
    expect(CommitHelpers.updateView).toHaveBeenCalledWith(
      expect.objectContaining({ view: expect.objectContaining({ activeOccurrenceId: "page1" }) }));
    expect(jumpToOccurrence).toHaveBeenCalledWith("item1", expect.anything());
  });

  it("does not re-pin a page the panel already holds", () => {
    const panelOccurrence = { id: "panel1", viewId: "v1", occurrences: ["page1"] };
    openOccurrenceInPanel({ occId: "item1", panelOccurrence, ...base });
    expect(CommitHelpers.pinPageToPanel).not.toHaveBeenCalled();
    expect(CommitHelpers.updateView).toHaveBeenCalled();
  });

  it("skips pin and activate when the page is already active", () => {
    const panelOccurrence = { id: "panel1", viewId: "v1", occurrences: ["page1"] };
    const out = openOccurrenceInPanel({
      ...base, occId: "item1", panelOccurrence,
      viewsById: { v1: { id: "v1", activeOccurrenceId: "page1" } },
    });
    expect(out.alreadyOpen).toBe(true);
    expect(CommitHelpers.updateView).not.toHaveBeenCalled();
    expect(jumpToOccurrence).toHaveBeenCalled();
  });

  it("reports failure when the occurrence has no page ancestor", () => {
    const out = openOccurrenceInPanel({
      ...base, occId: "loose", panelOccurrence: { id: "panel1", viewId: "v1", occurrences: [] },
      occurrencesById: { loose: { id: "loose", moduleId: "m_item" } },
    });
    expect(out.ok).toBe(false);
  });
});

describe("openOccurrenceInPanel scopes the jump to its own panel", () => {
  it("passes a root resolving to THIS panel's element (by panel MODULE id)", () => {
    document.body.innerHTML = `
      <div id="pA" data-panel-id="mod_A"></div>
      <div id="pB" data-panel-id="mod_B"></div>`;
    const panelOccurrence = { id: "panel1", moduleId: "mod_B", viewId: "v1", occurrences: [] };
    openOccurrenceInPanel({ ...base, occId: "item1", panelOccurrence });
    const opts = jumpToOccurrence.mock.calls[0][1];
    expect(typeof opts.root).toBe("function");
    expect(opts.root()).toBe(document.querySelector("#pB"));
  });

  it("polls while the freshly-activated page mounts, but not when it was already open", () => {
    const panelOccurrence = { id: "panel1", moduleId: "mod_B", viewId: "v1", occurrences: [] };
    openOccurrenceInPanel({ ...base, occId: "item1", panelOccurrence });
    expect(jumpToOccurrence.mock.calls[0][1].retries).toBeGreaterThan(0);

    vi.clearAllMocks();
    openOccurrenceInPanel({
      ...base, occId: "item1",
      panelOccurrence: { id: "panel1", moduleId: "mod_B", viewId: "v1", occurrences: ["page1"] },
      viewsById: { v1: { id: "v1", activeOccurrenceId: "page1" } },
    });
    expect(jumpToOccurrence.mock.calls[0][1].retries).toBe(0);
  });

  it("forwards onMissing so an async miss can still be reported", () => {
    const onMissing = vi.fn();
    const panelOccurrence = { id: "panel1", moduleId: "mod_B", viewId: "v1", occurrences: [] };
    openOccurrenceInPanel({ ...base, occId: "item1", panelOccurrence, onMissing });
    expect(jumpToOccurrence.mock.calls[0][1].onMissing).toBe(onMissing);
  });
});
