import { describe, it, expect } from "vitest";
import { titleFromUrl } from "../utils/titleFromUrl.js";

describe("titleFromUrl", () => {
  it("reads a Reddit post's title from its slug", () => {
    expect(titleFromUrl("https://www.reddit.com/r/NondualityMemes/comments/1abc23/what_game_are_you_playing/"))
      .toBe("What game are you playing — r/NondualityMemes");
  });
  it("names the subreddit when the slug is missing", () => {
    expect(titleFromUrl("https://reddit.com/r/AskReddit/comments/xyz9/")).toBe("r/AskReddit");
  });
  it("reads nothing from other sites or other Reddit pages", () => {
    expect(titleFromUrl("https://en.wikipedia.org/wiki/Otter")).toBe(null);
    expect(titleFromUrl("https://www.reddit.com/r/AskReddit/")).toBe(null);
    expect(titleFromUrl("not a url")).toBe(null);
  });
});

import { isJunkName } from "../migrations/0500-reddit-bookmark-names.mjs";
describe("0500 renames only junk names", () => {
  it("treats the host and a post's age as junk", () => {
    expect(isJunkName("reddit.com")).toBe(true);
    expect(isJunkName("5 yr. ago")).toBe(true);
    expect(isJunkName("3 mo. ago")).toBe(true);
  });
  it("keeps a real title", () => {
    expect(isJunkName("Mac Miller Jon Brion")).toBe(false);
    expect(isJunkName("r/getdisciplined - [Advice] I")).toBe(false);
  });
});
