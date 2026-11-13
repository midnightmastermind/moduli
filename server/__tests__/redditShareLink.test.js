import { describe, it, expect } from "vitest";
import { isRedditShareLink, canonicalRedditPost, expandRedditShareLink } from "../utils/redditShareLink.js";
import { fetchLinkPreview } from "../utils/linkPreview.js";
import { prepareShare } from "../services/shareIngress.js";

const SHARE = "https://www.reddit.com/r/theories/s/QgQxyhs90w";
const LOC = "https://www.reddit.com/r/theories/comments/1ntxlml/easy_path_to_dictatorship_next_week/?share_id=YNG&utm_source=share";
const POST = "https://www.reddit.com/r/theories/comments/1ntxlml/easy_path_to_dictatorship_next_week/";
const redirectTo = (loc) => async (_u, init) => {
  expect(init.redirect).toBe("manual");
  return { status: 301, headers: { get: (k) => (k === "location" ? loc : null) } };
};

describe("reddit share links", () => {
  it("recognises share links and nothing else", () => {
    expect(isRedditShareLink(SHARE)).toBe(true);
    expect(isRedditShareLink("https://reddit.com/s/QgQxyhs90w")).toBe(true);
    expect(isRedditShareLink(POST)).toBe(false);
    expect(isRedditShareLink("https://evil.tld/r/x/s/abc")).toBe(false);
    expect(isRedditShareLink("https://reddit.com.evil.tld/s/abc")).toBe(false);
  });
  it("canonicalises a post address without tracking", () => {
    expect(canonicalRedditPost(LOC)).toBe(POST);
    expect(canonicalRedditPost("https://www.reddit.com/r/x/")).toBe(null);
  });
  it("expands a share link to its post by reading the redirect", async () => {
    expect(await expandRedditShareLink(SHARE, { fetchImpl: redirectTo(LOC) })).toBe(POST);
  });
  it("keeps the link when Reddit does not point at a post, or fails", async () => {
    expect(await expandRedditShareLink(SHARE, { fetchImpl: redirectTo("https://www.reddit.com/s/QgQxyhs90w") })).toBe(SHARE);
    expect(await expandRedditShareLink(SHARE, { fetchImpl: async () => { throw new Error("x"); } })).toBe(SHARE);
    let asked = false;
    expect(await expandRedditShareLink(POST, { fetchImpl: async () => { asked = true; } })).toBe(POST);
    expect(asked).toBe(false);
  });
});

describe("the preview reports the expansion", () => {
  const expandLink = async (u) => (u === SHARE ? POST : u);
  it("even when the page itself cannot be fetched", async () => {
    const r = await fetchLinkPreview(SHARE, { expandLink, fetchPageHtml: async () => { throw new Error("403"); } });
    expect(r.ok).toBe(false);
    expect(r.url).toBe(POST);
    expect(r.expandedFrom).toBe(SHARE);
  });
  it("and fetches the post, not the share link", async () => {
    let fetched = null;
    const r = await fetchLinkPreview(SHARE, { expandLink, fetchPageHtml: async (u) => { fetched = u; return { url: u, html: "<title>T</title>" }; } });
    expect(fetched).toBe(POST);
    expect(r.ok && r.expandedFrom).toBe(SHARE);
  });
  it("adds nothing for an ordinary link", async () => {
    const r = await fetchLinkPreview("https://x.test/a", { expandLink, fetchPageHtml: async (u) => ({ url: u, html: "" }) });
    expect(r.expandedFrom).toBeUndefined();
  });
});

describe("a shared share link is saved as the post", () => {
  it("takes the expanded url even though the preview failed", async () => {
    const s = await prepareShare({ userId: "u1", gridId: "g1", url: SHARE,
      fetchPreview: async () => ({ ok: false, error: "403", url: POST, expandedFrom: SHARE }) });
    expect(s.props.url).toBe(POST);
  });
});
