// Driving the RESOLVER proves nothing about the CALLER — the class this repo has
// paid for four times (2026-08-11 (5)). `occurrenceUrl` ranks url-ish field
// NAMES, and it can only do that when it is handed the field map.
//
// Since `0201` a bookmark carries TWO http fields, `URL` and `Cover`. Unranked,
// the winner is whichever `Object.entries` yields first — so the reader could
// open the cover IMAGE instead of the page. This asserts what LEAVES the
// component, not what the helper does when called correctly.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const FIELDS = { fUrl: { id: "fUrl", name: "URL" }, fCover: { id: "fCover", name: "Cover" } };

vi.mock("../GridActionsContext.js", () => ({
  useGridActionsSelector: (sel) => sel({ fieldsById: FIELDS }),
}));

const spy = vi.fn(() => ({ url: "https://example.com/the-article", from: "field" }));
vi.mock("../helpers/occurrenceUrl", () => ({
  occurrenceUrl: (...a) => spy(...a),
  hasViewableUrl: () => true,
}));

import BookmarkView from "../modules/BookmarkView.jsx";

const occurrence = {
  id: "b1",
  fields: {
    fCover: { value: "https://cdn.example.com/og.png" },   // first in key order
    fUrl: { value: "https://example.com/the-article" },
  },
};

describe("BookmarkView hands the field map to the resolver", () => {
  beforeEach(() => spy.mockClear());

  it("passes a NON-EMPTY fieldsById, so the ranking can happen at all", () => {
    render(<BookmarkView occurrence={occurrence} module={{ kind: "bookmark" }} socket={null} />);
    expect(spy).toHaveBeenCalled();
    const ctx = spy.mock.calls[0][1];
    expect(ctx.fieldsById).toEqual(FIELDS);
  });

  it("takes the map from the STORE when no prop is given", () => {
    // `ArtifactContent` — the only caller — holds no grid state, so a prop is
    // never passed in production. If this component stopped reading the store,
    // the ranking would silently go away and nothing else would notice.
    render(<BookmarkView occurrence={occurrence} module={{ kind: "bookmark" }} socket={null} />);
    expect(Object.keys(spy.mock.calls[0][1].fieldsById)).toContain("fUrl");
  });

  it("an explicit prop still WINS, which is what keeps it testable", () => {
    const override = { zzz: { id: "zzz", name: "Website" } };
    render(<BookmarkView occurrence={occurrence} module={{ kind: "bookmark" }} fieldsById={override} socket={null} />);
    expect(spy.mock.calls[0][1].fieldsById).toEqual(override);
  });
});
