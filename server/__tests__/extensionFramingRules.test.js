// The extension removes `x-frame-options` and CSP from responses so Moduli can
// frame a page the site refuses to let anyone frame.
//
// THOSE HEADERS ARE A REAL PROTECTION — they stop another site framing a page
// and tricking you into clicking inside it. Removing them globally would waive
// clickjacking protection across the user's ENTIRE BROWSER, for every tab,
// forever. The scoping below is the whole safety of the extension, so it is
// asserted rather than left to a comment in a JSON file that cannot hold one.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const rules = JSON.parse(readFileSync(path.join(here, "..", "..", "extension", "rules.json"), "utf8"));

describe("the extension's framing rules", () => {
  it("has exactly one rule — a second one is a second thing to reason about", () => {
    expect(rules).toHaveLength(1);
  });

  it("applies ONLY to sub_frame, never to a page you navigate to", () => {
    // Without this the rule would strip the headers from top-level navigation
    // too, which protects nothing and weakens every site the user visits.
    expect(rules[0].condition.resourceTypes).toEqual(["sub_frame"]);
  });

  it("applies ONLY to frames MODULI embeds", () => {
    // `initiatorDomains` is what confines the waiver to a page the user has
    // already chosen to open in their own grid. Drop it and every site on the
    // web gains the ability to frame every other site.
    expect(rules[0].condition.initiatorDomains).toContain("viafluere.com");
    expect(rules[0].condition.initiatorDomains.length).toBeGreaterThan(0);
  });

  it("does not use a wildcard or urlFilter that would widen it", () => {
    expect(rules[0].condition.urlFilter).toBeUndefined();
    expect(rules[0].condition.initiatorDomains).not.toContain("*");
  });

  it("removes the three framing headers and nothing else", () => {
    const headers = rules[0].action.responseHeaders;
    expect(rules[0].action.type).toBe("modifyHeaders");
    expect(headers.map(h => h.header).sort()).toEqual([
      "content-security-policy", "content-security-policy-report-only", "x-frame-options",
    ]);
    // Removing, never rewriting — an injected header value would be a second
    // way to get this wrong.
    for (const h of headers) expect(h.operation).toBe("remove");
  });

  it("the two manifests agree on the ruleset", () => {
    const chrome = JSON.parse(readFileSync(path.join(here, "..", "..", "extension", "manifest.json"), "utf8"));
    const firefox = JSON.parse(readFileSync(path.join(here, "..", "..", "extension", "manifest.firefox.json"), "utf8"));
    for (const m of [chrome, firefox]) {
      expect(m.manifest_version).toBe(3);
      expect(m.permissions).toContain("declarativeNetRequest");
      expect(m.declarative_net_request.rule_resources[0].path).toBe("rules.json");
    }
  });
});
