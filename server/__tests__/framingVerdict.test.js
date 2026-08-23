// Whether a page will let us frame it, read from headers we already fetched
// rather than guessed from a load timeout.
import { describe, it, expect } from "vitest";
import { framingVerdict } from "../utils/framingVerdict.js";

const v = (h) => framingVerdict(h);

describe("x-frame-options", () => {
  it("DENY refuses", () => expect(v({ xFrameOptions: "DENY" }).framable).toBe(false));
  it("SAMEORIGIN refuses — we are always a different origin", () =>
    expect(v({ xFrameOptions: "SAMEORIGIN" }).framable).toBe(false));
  it("is case- and space-insensitive, as headers are", () =>
    expect(v({ xFrameOptions: "  sameorigin " }).framable).toBe(false));
  it("reports WHY, so the strip can say it", () =>
    expect(v({ xFrameOptions: "DENY" }).why).toMatch(/deny/));
});

describe("content-security-policy", () => {
  it("frame-ancestors 'none' refuses", () =>
    expect(v({ csp: "default-src 'self'; frame-ancestors 'none'" }).framable).toBe(false));

  it("frame-ancestors * allows", () =>
    expect(v({ csp: "frame-ancestors *" }).framable).toBe(true));

  it("a list of other origins refuses", () =>
    expect(v({ csp: "frame-ancestors https://partner.example" }).framable).toBe(false));

  it("IGNORES a CSP with no frame-ancestors directive", () => {
    // Matching on the header's presence would refuse most of the modern web —
    // script-src and object-src say nothing about framing. Wikipedia sends a
    // long CSP and frames perfectly.
    expect(v({ csp: "script-src 'unsafe-eval' blob: 'self'; object-src 'none'" }).framable).toBe(true);
  });
});

describe("the decoy", () => {
  it("report-only is NOT a refusal", () => {
    // The caller passes the ENFORCED header only. A survey of the user's top
    // domains listed google.com and instagram.com as blocked and both were
    // sending content-security-policy-REPORT-ONLY, which blocks nothing.
    // Passing it here would withhold the live page from pages that allow it.
    expect(v({ csp: null, xFrameOptions: null }).framable).toBe(true);
  });
});

describe("fails OPEN", () => {
  it("no headers at all means framable", () => {
    // Most of the web sends nothing. A wrong yes costs one blank frame the user
    // can switch away from; a wrong no silently withholds the live page.
    expect(v({}).framable).toBe(true);
    expect(framingVerdict().framable).toBe(true);
  });
});
