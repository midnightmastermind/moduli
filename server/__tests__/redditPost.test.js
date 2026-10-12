// A shared Reddit link carries only a URL and a title; the post's own text has to be read afterwards,
// and Reddit refuses unauthenticated reads from a server (403 for the page, .json and old.reddit —
// measured 2026-10-12 from the droplet). So the post is read through Reddit's official API with an
// app token (client_credentials), and the phone app's /s/ share links are resolved the same way.
import { describe, it, expect, vi } from "vitest";
import { redditPostRef, createRedditReader } from "../utils/redditPost.js";

describe("redditPostRef", () => {
  it("reads a post id from the usual URL shapes", () => {
    expect(redditPostRef("https://www.reddit.com/r/selfhosted/comments/1fp3q3x/some_title/?share_id=x&utm_source=y"))
      .toEqual({ kind: "post", id: "1fp3q3x" });
    expect(redditPostRef("https://old.reddit.com/r/a/comments/abc123")).toEqual({ kind: "post", id: "abc123" });
    expect(redditPostRef("https://reddit.com/comments/abc123")).toEqual({ kind: "post", id: "abc123" });
    expect(redditPostRef("https://redd.it/abc123")).toEqual({ kind: "post", id: "abc123" });
  });
  it("recognises the app's share links", () => {
    expect(redditPostRef("https://www.reddit.com/r/selfhosted/s/xHq5jT0K1n")).toEqual({ kind: "share", sub: "selfhosted", code: "xHq5jT0K1n" });
  });
  it("is null for anything else", () => {
    expect(redditPostRef("https://www.reddit.com/r/selfhosted/")).toBeNull();
    expect(redditPostRef("https://example.com/comments/abc")).toBeNull();
    expect(redditPostRef("not a url")).toBeNull();
    expect(redditPostRef("")).toBeNull();
  });
});

const listing = (post) => [{ data: { children: [{ kind: "t3", data: post }] } }, { data: { children: [] } }];
const jsonRes = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  json: async () => body, text: async () => JSON.stringify(body),
});

function makeFetch(routes) {
  const calls = [];
  const fetch = vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    for (const [match, res] of routes) if (String(url).includes(match)) return typeof res === "function" ? res(url, opts) : res;
    return jsonRes({ error: "no route" }, 404);
  });
  return { fetch, calls };
}

const TOKEN = ["access_token", jsonRes({ access_token: "tok", expires_in: 3600 })];

describe("createRedditReader", () => {
  it("says it is not configured without keys, and fetches nothing", async () => {
    const { fetch } = makeFetch([]);
    const r = createRedditReader({ clientId: "", clientSecret: "", fetch });
    expect(r.configured).toBe(false);
    expect(await r.readPost("https://redd.it/abc")).toEqual({ ok: false, reason: "not_configured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads a self post's title and text through the API with an app token", async () => {
    const { fetch, calls } = makeFetch([
      TOKEN,
      ["oauth.reddit.com/comments/abc123", jsonRes(listing({ title: "My setup", selftext: "First para.\n\nSecond.", subreddit: "selfhosted", author: "u1", permalink: "/r/selfhosted/comments/abc123/my_setup/" }))],
    ]);
    const r = createRedditReader({ clientId: "id", clientSecret: "sec", userAgent: "moduli-test", fetch });
    const out = await r.readPost("https://www.reddit.com/r/selfhosted/comments/abc123/my_setup/");
    expect(out).toMatchObject({ ok: true, title: "My setup", text: "First para.\n\nSecond.", subreddit: "selfhosted" });
    const tokenCall = calls.find((c) => c.url.includes("access_token"));
    expect(tokenCall.opts.method).toBe("POST");
    expect(tokenCall.opts.headers.authorization).toBe(`Basic ${Buffer.from("id:sec").toString("base64")}`);
    expect(String(tokenCall.opts.body)).toContain("grant_type=client_credentials");
    const postCall = calls.find((c) => c.url.includes("oauth.reddit.com/comments"));
    expect(postCall.opts.headers.authorization).toBe("Bearer tok");
    expect(postCall.opts.headers["user-agent"]).toBe("moduli-test");
  });

  it("reuses the token until it expires", async () => {
    const { fetch, calls } = makeFetch([TOKEN, ["oauth.reddit.com/comments/", jsonRes(listing({ title: "t", selftext: "x" }))]]);
    const r = createRedditReader({ clientId: "id", clientSecret: "sec", fetch });
    await r.readPost("https://redd.it/a1");
    await r.readPost("https://redd.it/a2");
    expect(calls.filter((c) => c.url.includes("access_token"))).toHaveLength(1);
  });

  it("resolves an app share link to the post it points at", async () => {
    const { fetch } = makeFetch([
      TOKEN,
      ["/r/selfhosted/s/xHq5", jsonRes({}, 301, { location: "https://www.reddit.com/r/selfhosted/comments/zz9/title/?share_id=q" })],
      ["oauth.reddit.com/comments/zz9", jsonRes(listing({ title: "Shared", selftext: "Body text" }))],
    ]);
    const r = createRedditReader({ clientId: "id", clientSecret: "sec", fetch });
    expect(await r.readPost("https://www.reddit.com/r/selfhosted/s/xHq5")).toMatchObject({ ok: true, title: "Shared", text: "Body text" });
  });

  it("a link post has no text of its own — ok, empty text", async () => {
    const { fetch } = makeFetch([TOKEN, ["oauth.reddit.com/comments/", jsonRes(listing({ title: "Look", selftext: "", url: "https://example.com/a" }))]]);
    const out = await createRedditReader({ clientId: "id", clientSecret: "sec", fetch }).readPost("https://redd.it/a1");
    expect(out).toMatchObject({ ok: true, title: "Look", text: "" });
  });

  it("reports a refused token rather than throwing", async () => {
    const { fetch } = makeFetch([["access_token", jsonRes({ error: "invalid_grant" }, 401)]]);
    const out = await createRedditReader({ clientId: "id", clientSecret: "bad", fetch }).readPost("https://redd.it/a1");
    expect(out).toEqual({ ok: false, reason: "auth_failed" });
  });

  it("is not a reddit post: no fetch at all", async () => {
    const { fetch } = makeFetch([TOKEN]);
    const out = await createRedditReader({ clientId: "id", clientSecret: "sec", fetch }).readPost("https://example.com/x");
    expect(out).toEqual({ ok: false, reason: "not_reddit" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
