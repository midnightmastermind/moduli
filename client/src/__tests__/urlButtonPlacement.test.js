// WHERE a row's open-as-page button sits (user, 2026-09-15: *"the button to open
// the url as a browser page should be on the occurance and not the cover image
// of the instance"*). An artifact's card fills its row, so the corner button
// landed on the cover image; it goes in the handle group instead.
import { describe, it, expect } from "vitest";
import { urlButtonPlacement } from "../helpers/openBookmark";

const BOOKMARK = { id: "m-b", role: "artifact", kind: "bookmark", fileRef: "https://example.com/a" };
const IMAGE = { id: "m-i", role: "artifact", kind: "image", fileRef: "https://example.com/a.png" };

describe("urlButtonPlacement", () => {
  it("a bookmark artifact gets its button in the HEADER, not the card corner", () => {
    expect(urlButtonPlacement({ id: "o1", moduleId: "m-b", fields: {} }, BOOKMARK)).toBe("header");
  });

  // The control: an image stored BY url has no page to open, so no button at
  // all — "header" must not become the answer for every artifact.
  it("an image artifact gets no button", () => {
    expect(urlButtonPlacement({ id: "o2", moduleId: "m-i", fields: {} }, IMAGE)).toBe(null);
  });

  it("a row with no url gets no button", () => {
    expect(urlButtonPlacement({ id: "o3", moduleId: "m", fields: {} }, { id: "m", role: "instance" })).toBe(null);
  });

  it("no occurrence, no button", () => {
    expect(urlButtonPlacement(null, BOOKMARK)).toBe(null);
  });
});
