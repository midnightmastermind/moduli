import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../helpers/openBookmark.js", () => ({ openArtifactInPanel: vi.fn(() => ({ ok: true })) }));
vi.mock("../helpers/openOccurrenceInPanel.js", () => ({ openOccurrenceInPanel: vi.fn(() => ({ ok: true })) }));

import { openFromLink, openParamFrom, withoutOpenParam } from "../helpers/deepLinkOpen.js";
import { openArtifactInPanel } from "../helpers/openBookmark.js";
import { openOccurrenceInPanel } from "../helpers/openOccurrenceInPanel.js";

const modulesById = { mFile: { id: "mFile", role: "artifact", kind: "ebook" }, mPage: { id: "mPage", role: "page", kind: "doc" }, mPanel: { id: "mPanel", role: "panel" } };
const occurrencesById = { f: { id: "f", moduleId: "mFile" }, p: { id: "p", moduleId: "mPage" }, panel: { id: "panel", moduleId: "mPanel" } };
const grid = { occurrences: ["panel"] };

describe("deepLinkOpen", () => {
  beforeEach(() => { openArtifactInPanel.mockClear(); openOccurrenceInPanel.mockClear(); });

  it("reads and removes the open parameter", () => {
    expect(openParamFrom("?open=abc&x=1")).toBe("abc");
    expect(openParamFrom("?x=1")).toBeNull();
    expect(withoutOpenParam({ pathname: "/", search: "?open=abc&x=1", hash: "" })).toBe("/?x=1");
    expect(withoutOpenParam({ pathname: "/", search: "?open=abc", hash: "#h" })).toBe("/#h");
  });

  it("opens a file as its own page (the file viewer)", () => {
    expect(openFromLink({ occId: "f", grid, occurrencesById, modulesById })).toEqual({ ok: true });
    expect(openArtifactInPanel).toHaveBeenCalledTimes(1);
    expect(openOccurrenceInPanel).not.toHaveBeenCalled();
  });

  it("opens anything else on its page, in a panel of this grid", () => {
    expect(openFromLink({ occId: "p", grid, occurrencesById, modulesById })).toEqual({ ok: true, panelOccId: "panel" });
    expect(openOccurrenceInPanel.mock.calls[0][0].panelOccurrence.id).toBe("panel");
  });

  it("says so when the id is not on this grid", () => {
    expect(openFromLink({ occId: "nope", grid, occurrencesById, modulesById })).toEqual({ ok: false, reason: "not found" });
  });
});
