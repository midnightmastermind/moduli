// An http:// page in a frame on an https grid is refused by the browser and
// never fires `load`, so Web mode spun forever (user, 2026-09-15).
import { describe, it, expect } from "vitest";
import { frameSrcFor } from "../helpers/frameSrc";

describe("frameSrcFor", () => {
  it("asks for an http page over https when the grid is https", () => {
    expect(frameSrcFor("http://journal.sjdm.org/20/200824b/jdm200824b.html", { pageProtocol: "https:" }))
      .toBe("https://journal.sjdm.org/20/200824b/jdm200824b.html");
  });

  it("leaves an https page alone", () => {
    expect(frameSrcFor("https://example.com/a", { pageProtocol: "https:" })).toBe("https://example.com/a");
  });

  // The control: on an http page there is no mixed-content rule, and upgrading
  // would break a site that only speaks http.
  it("does not upgrade when the grid itself is http", () => {
    expect(frameSrcFor("http://localhost:8080/x", { pageProtocol: "http:" })).toBe("http://localhost:8080/x");
  });

  it("an embeddable url wins, whatever the page address is", () => {
    expect(frameSrcFor("http://youtube.com/watch?v=1", { embedSrc: "https://www.youtube.com/embed/1", pageProtocol: "https:" }))
      .toBe("https://www.youtube.com/embed/1");
  });

  it("is case-insensitive about the scheme and tolerates no url", () => {
    expect(frameSrcFor("HTTP://Example.com/", { pageProtocol: "https:" })).toBe("https://Example.com/");
    expect(frameSrcFor("", { pageProtocol: "https:" })).toBe("");
    expect(frameSrcFor(null, { pageProtocol: "https:" })).toBe(null);
  });
});
