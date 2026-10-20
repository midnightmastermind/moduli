import { describe, it, expect } from "vitest";
import { wikimediaFileKey, markdownHasImage } from "../services/wikipediaTools.js";

const API = "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/94/Bonsai%2C_Kenshin_Toge.jpg/3840px-Bonsai%2C_Kenshin_Toge.jpg?utm_source=en.wikipedia.org&utm_campaign=api&utm_content=thumbnail";
const PARSER = "https://thumb.wikimedia.org/wikipedia/commons/thumb/9/94/Bonsai%2C_Kenshin_Toge.jpg/960px-Bonsai%2C_Kenshin_Toge.jpg?utm_source=en.wikipedia.org&utm_campaign=parser&utm_content=thumbnail";

describe("wikimediaFileKey", () => {
  it("names the same file for two sizes and two queries", () => {
    expect(wikimediaFileKey(API)).toBe("bonsai,_kenshin_toge.jpg");
    expect(wikimediaFileKey(PARSER)).toBe(wikimediaFileKey(API));
  });
  it("reads an original (non-thumb) upload", () => {
    expect(wikimediaFileKey("https://upload.wikimedia.org/wikipedia/commons/9/94/Bonsai%2C_Kenshin_Toge.jpg"))
      .toBe("bonsai,_kenshin_toge.jpg");
  });
  it("is null for a non-Wikimedia URL", () => {
    expect(wikimediaFileKey("https://example.com/a/220px-x.jpg")).toBeNull();
  });
});

describe("markdownHasImage", () => {
  it("sees the article's own figure as the lead picture (the duplicate)", () => {
    const md = `# Bonsai\n\n![Bonsai, named Kenshin](${PARSER})\n\nText.`;
    expect(markdownHasImage(md, API)).toBe(true);
  });
  it("a different file is not a duplicate", () => {
    const md = `# Bonsai\n\n![Other](https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Juniper.jpg/220px-Juniper.jpg)`;
    expect(markdownHasImage(md, API)).toBe(false);
  });
  it("a file named with parentheses still matches", () => {
    const u = (s) => `https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Eminem_(2019).jpg/${s}px-Eminem_(2019).jpg`;
    expect(markdownHasImage(`![x](${u(220)})`, u(960))).toBe(true);
  });
});
