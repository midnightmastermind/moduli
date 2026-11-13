// An EMBED frame may not open popups (user, 2026-11-13: clicking anywhere on a Reddit embed
// opened the post in a new Firefox tab — "want the buttons in the header to handle that").
// An ordinary page keeps them.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, act } from "@testing-library/react";

let embed = null;
vi.mock("../GridActionsContext.js", () => ({
  useGridActionsSelector: (sel) => sel({ fieldsById: {}, dispatch: vi.fn(), gridId: "g", userId: "u" }),
}));
vi.mock("../helpers/occurrenceUrl", () => ({
  occurrenceUrl: () => ({ url: "https://www.reddit.com/r/a/comments/abc123/t/", from: "field" }),
  hasViewableUrl: () => true,
}));
vi.mock("../helpers/embedUrl", () => ({ embedUrlFor: () => embed }));

import BookmarkView, { FRAME_SANDBOX, EMBED_FRAME_SANDBOX } from "../modules/BookmarkView.jsx";

const socket = { emit: vi.fn((ev, _p, ack) => { if (typeof ack === "function" && ev === "page_reader") ack({ ok: true, usable: false, framable: false, markdown: "", words: 0 }); }) };
const frameSandbox = async () => {
  let c;
  await act(async () => { c = render(<BookmarkView occurrence={{ id: "b1", fields: {}, meta: {} }} module={{ kind: "bookmark" }} socket={socket} isActivePage />).container; });
  return c.querySelector("iframe")?.getAttribute("sandbox");
};

beforeEach(() => { embed = null; });

describe("an embed cannot open a new tab", () => {
  it("the embed sandbox has no popups and no top navigation", () => {
    expect(EMBED_FRAME_SANDBOX).not.toContain("allow-popups");
    expect(EMBED_FRAME_SANDBOX).not.toContain("allow-top-navigation");
    expect(EMBED_FRAME_SANDBOX).toContain("allow-scripts");
  });
  it("a Reddit embed frame uses it", async () => {
    embed = "https://embed.reddit.com/r/a/comments/abc123/t/?embed=true";
    expect(await frameSandbox()).toBe(EMBED_FRAME_SANDBOX);
  });
});
