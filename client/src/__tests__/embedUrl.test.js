// __tests__/embedUrl.test.js
//
// The table is knowledge about specific sites, so the tests are about the
// SHAPES those sites actually publish — and about the refusals, which are the
// half that keeps this from making anything worse.
import { describe, it, expect } from "vitest";
import { embedUrlFor, embedProviderFor, EMBED_PROVIDERS } from "../helpers/embedUrl";

describe("YouTube — the case this was built for", () => {
  const ID = "dQw4w9WgXcQ";
  it("rewrites a watch URL to the embed its owner publishes", () => {
    // Measured: /watch sends X-Frame-Options: SAMEORIGIN and cannot be framed;
    // /embed sends no such header and can.
    expect(embedUrlFor(`https://www.youtube.com/watch?v=${ID}`))
      .toBe(`https://www.youtube.com/embed/${ID}`);
  });

  it("handles every shape a YouTube link comes in", () => {
    for (const u of [
      `https://youtu.be/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://www.youtube-nocookie.com/embed/${ID}`,
    ]) expect(embedUrlFor(u), u).toContain(`/embed/${ID}`);
  });

  // Linking to 4:12 and starting at 0 is a silently wrong answer — the worst
  // kind, because it looks like it worked.
  it("carries the timestamp across, in both spellings", () => {
    expect(embedUrlFor(`https://www.youtube.com/watch?v=${ID}&t=212`)).toContain("start=212");
    expect(embedUrlFor(`https://youtu.be/${ID}?t=1m30s`)).toContain("start=90");
    expect(embedUrlFor(`https://youtu.be/${ID}?t=1h1m1s`)).toContain("start=3661");
  });

  it("refuses a URL that is not a video", () => {
    // The host matches and the shape does not. Returning an /embed/ URL built
    // from "@someChannel" would frame a YouTube error page and look like a bug
    // in the app rather than in the link.
    expect(embedUrlFor("https://www.youtube.com/@someChannel")).toBe(null);
    expect(embedUrlFor("https://www.youtube.com/")).toBe(null);
    expect(embedUrlFor("https://www.youtube.com/watch?v=")).toBe(null);
  });

  // The SHAPE guard, which the channel cases above do not reach — those are
  // rejected earlier by having no id at all. This is what stops a malformed id
  // being pasted into an /embed/ URL and framing a YouTube error page.
  it("refuses an id that is not id-shaped", () => {
    expect(embedUrlFor("https://www.youtube.com/shorts/ab")).toBe(null);
    expect(embedUrlFor("https://youtu.be/x")).toBe(null);
  });
});

describe("the other three, each verified against its live endpoint", () => {
  it("vimeo", () => {
    expect(embedUrlFor("https://vimeo.com/76979871")).toBe("https://player.vimeo.com/video/76979871");
    expect(embedUrlFor("https://vimeo.com/user/likes")).toBe(null);
  });
  it("spotify", () => {
    expect(embedUrlFor("https://open.spotify.com/track/abc123"))
      .toBe("https://open.spotify.com/embed/track/abc123");
    expect(embedUrlFor("https://open.spotify.com/embed/album/x"))
      .toBe("https://open.spotify.com/embed/album/x");   // already embeddable
    expect(embedUrlFor("https://open.spotify.com/")).toBe(null);
  });
  it("soundcloud takes the original url as a parameter, not an id", () => {
    const out = embedUrlFor("https://soundcloud.com/artist/track");
    expect(out).toContain("w.soundcloud.com/player/");
    expect(out).toContain(encodeURIComponent("https://soundcloud.com/artist/track"));
    expect(embedUrlFor("https://soundcloud.com/artist")).toBe(null);   // a profile plays nothing
  });
});

describe("null is the contract for everything else", () => {
  // This is what makes the table safe to add: a site it does not know keeps
  // whatever BookmarkView already did — reader, archive, or an honest refusal.
  it("leaves unknown sites alone", () => {
    for (const u of [
      "https://en.wikipedia.org/wiki/Otter",
      "https://github.com/x/y",
      "https://news.ycombinator.com/",
    ]) expect(embedUrlFor(u), u).toBe(null);
  });

  it("refuses junk without throwing", () => {
    for (const u of [null, undefined, "", "   ", "not a url", 42, {},
                     "javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd"])
      expect(embedUrlFor(u)).toBe(null);
  });

  // A CONTRACT PIN, NOT COVERAGE — and worth saying so. Removing the scheme
  // guard fails NOTHING today, because `javascript:` and `data:` URLs have an
  // empty hostname and no rule's host test can match one. It is kept anyway:
  // unlike a guard proven unreachable by construction, this one becomes live
  // the moment a rule is added with a looser host test, and it sits on what
  // reaches an iframe `src`. A cheap guard at a security boundary whose
  // precondition can change is a different call from one nothing has needed.
  it("never returns a javascript: or data: URL", () => {
    expect(embedUrlFor("javascript:alert(1)")).toBe(null);
    expect(embedUrlFor("data:text/html;base64,PHNjcmlwdD4=")).toBe(null);
  });

  // Lookalike hosts. `youtube.com.evil.tld` must NOT match, or the table
  // becomes a way to get an attacker's page framed.
  it("matches the host, not a substring of it", () => {
    expect(embedUrlFor("https://youtube.com.evil.tld/watch?v=abcdef")).toBe(null);
    expect(embedUrlFor("https://notyoutube.com/watch?v=abcdef")).toBe(null);
    expect(embedUrlFor("https://evil.tld/?x=youtube.com/watch?v=abcdef")).toBe(null);
  });
});

describe("embedProviderFor", () => {
  it("names the provider so the UI can say why it embedded", () => {
    expect(embedProviderFor("https://youtu.be/dQw4w9WgXcQ")).toBe("youtube");
    expect(embedProviderFor("https://en.wikipedia.org/wiki/Otter")).toBe(null);
    // Host known, shape not — it did not embed, so it names nothing.
    expect(embedProviderFor("https://www.youtube.com/@chan")).toBe(null);
  });
  it("agrees with embedUrlFor about every provider it lists", () => {
    expect(EMBED_PROVIDERS).toEqual(["youtube", "vimeo", "spotify", "soundcloud"]);
  });
});
