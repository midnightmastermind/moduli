import { describe, it, expect } from "vitest";
import { fieldLinkHref } from "../helpers/fieldLink";

const ig = { meta: { linkTemplate: "https://www.instagram.com/{value}" } };

describe("fieldLinkHref", () => {
  it("fills the template with the value", () => {
    expect(fieldLinkHref(ig, "oreopandas_cx")).toBe("https://www.instagram.com/oreopandas_cx");
  });
  it("drops a leading @ and surrounding space", () => {
    expect(fieldLinkHref(ig, "  @ava.designs ")).toBe("https://www.instagram.com/ava.designs");
  });
  it("encodes the value so it cannot escape the path", () => {
    expect(fieldLinkHref(ig, "a/b?c")).toBe("https://www.instagram.com/a%2Fb%3Fc");
  });
  it("is null with no value", () => {
    expect(fieldLinkHref(ig, "")).toBeNull();
    expect(fieldLinkHref(ig, null)).toBeNull();
    expect(fieldLinkHref(ig, "—")).toBeNull();
  });
  it("is null for a field with no template (control)", () => {
    expect(fieldLinkHref({ meta: {} }, "x")).toBeNull();
    expect(fieldLinkHref({ meta: { linkTemplate: "https://x.com/" } }, "x")).toBeNull();
  });
  it("a bare {value} template passes a web address through", () => {
    const site = { meta: { linkTemplate: "{value}" } };
    expect(fieldLinkHref(site, "https://chen.dev/a?b=1")).toBe("https://chen.dev/a?b=1");
    expect(fieldLinkHref(site, "chen.dev")).toBe("https://chen.dev");
  });
  it("never links a non-web scheme", () => {
    expect(fieldLinkHref({ meta: { linkTemplate: "{value}" } }, "javascript:alert(1)")).toBeNull();
  });
});
