// The OPEN_URLS operation step (glossary page, 2026-11-15): "open all these links in the browser".
import { describe, it, expect, vi } from "vitest";
import { urlsFrom, openUrls } from "../helpers/openUrls";
import { executeActionItem } from "../helpers/operationActions";

describe("urlsFrom", () => {
  it("reads link chips, plain addresses and urls on records, once each, in order", () => {
    const chips = [
      { id: "a", meta: { link: { kind: "url", url: "https://mail.google.com" } } },
      { id: "b", meta: { link: { kind: "occurrence", occId: "x" } } },
      "https://github.com",
      { url: "https://fetlife.com" },
      "https://mail.google.com",
      "javascript:alert(1)",
      null,
    ];
    expect(urlsFrom(chips)).toEqual(["https://mail.google.com", "https://github.com", "https://fetlife.com"]);
  });
  it("takes a single value too", () => {
    expect(urlsFrom("https://x.io")).toEqual(["https://x.io"]);
    expect(urlsFrom(undefined)).toEqual([]);
  });
});

describe("openUrls", () => {
  it("opens each in a new tab and counts what the browser blocked", () => {
    const win = { open: vi.fn((u) => (u.includes("b") ? null : { opener: "me" })) };
    expect(openUrls(["https://a.io", "https://b.io", "https://c.io"], win)).toEqual({ opened: 2, blocked: 1 });
    expect(win.open).toHaveBeenCalledWith("https://a.io", "_blank");
  });
  it("cuts the opened tab off from this page", () => {
    const tab = { opener: "me" };
    openUrls(["https://a.io"], { open: () => tab });
    expect(tab.opener).toBe(null);
  });
});

describe("the OPEN_URLS step", () => {
  it("emits one OPEN_URLS effect with the addresses", () => {
    const $vars = { $links: [{ meta: { link: { url: "https://a.io" } } }, { meta: { link: { url: "https://b.io" } } }] };
    const updates = executeActionItem("OPEN_URLS", { urls: "$links" }, $vars, { occurrencesById: {} }, {});
    expect(updates).toEqual([{ _effect: "OPEN_URLS", urls: ["https://a.io", "https://b.io"] }]);
  });
  it("emits nothing when there are no addresses", () => {
    const updates = executeActionItem("OPEN_URLS", { urls: "$none" }, { $none: [] }, { occurrencesById: {} }, {});
    expect(updates).toEqual([]);
  });
});
