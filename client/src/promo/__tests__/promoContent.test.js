import { describe, it, expect } from "vitest";
import { FEATURES, featureBySlug } from "../content/features.js";
import { EXAMPLES } from "../content/examples.js";

describe("promo content", () => {
  it("every feature has the fields FeaturePage renders", () => {
    for (const f of FEATURES) {
      expect(f.slug, "slug").toBeTruthy();
      expect(f.nav, `${f.slug} nav`).toBeTruthy();
      expect(f.title, `${f.slug} title`).toBeTruthy();
      expect(f.tagline, `${f.slug} tagline`).toBeTruthy();
      expect(f.body, `${f.slug} body`).toBeTruthy();
      expect(f.points.length, `${f.slug} points`).toBeGreaterThan(0);
      for (const p of f.points) {
        expect(p.heading, `${f.slug} point heading`).toBeTruthy();
        expect(p.text, `${f.slug} point text`).toBeTruthy();
      }
      expect(f.stat.value, `${f.slug} stat`).toBeTruthy();
      expect(f.stat.label, `${f.slug} stat label`).toBeTruthy();
    }
  });

  it("slugs are unique and url-safe", () => {
    const slugs = FEATURES.map((f) => f.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("featureBySlug finds and misses correctly", () => {
    expect(featureBySlug("operations")?.slug).toBe("operations");
    expect(featureBySlug("nope")).toBeUndefined();
  });

  // An example claiming a capability that does not exist would render a dead
  // link on the examples page.
  it("every example is built from real capability slugs", () => {
    const slugs = new Set(FEATURES.map((f) => f.slug));
    for (const e of EXAMPLES) {
      expect(e.built.length, `${e.id} built`).toBeGreaterThan(0);
      for (const b of e.built) {
        expect(slugs.has(b), `${e.id} names unknown capability "${b}"`).toBe(true);
      }
    }
  });

  it("examples have the fields ExamplesPage renders", () => {
    for (const e of EXAMPLES) {
      expect(e.id).toBeTruthy();
      expect(e.name).toBeTruthy();
      expect(e.blurb).toBeTruthy();
      expect(e.detail).toBeTruthy();
    }
  });
});
