// The promotional site sells a GENERIC product. It does not know that a
// "Schedule" or a "Day Page" is a thing — those are examples of what someone
// assembled with it, and they live in content/examples.js.
//
// User, 2026-08-18, verbatim: "we can include schedule and daypage and trackers
// and goals in an examples page (details for them) but the main site doesnt
// know that schedule and daypage are a thing."
//
// This is the promo twin of __tests__/noDomainKnowledge.test.js, which keeps
// the same rule inside the renderer. Patterns are plain case-insensitive
// SUBSTRINGS, deliberately not \b-anchored: a word boundary does not fire
// inside an identifier, which is exactly how EMOTION_RINGS slipped past the
// renderer's guard on 2026-08-06.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const PROMO = join(process.cwd(), "src", "promo");

// The one file allowed to name concrete builds, and the test files that
// necessarily quote the banned words in order to check for them.
const EXEMPT = [
  join("content", "examples.js"),
  join("__tests__", "noProductDomainKnowledge.test.js"),
  join("__tests__", "promoContent.test.js"),
];

const BANNED = ["schedule", "day page", "daypage", "tracker", "timeslot", "time slot"];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|jsx|css)$/.test(name)) out.push(p);
  }
  return out;
}

describe("the promo site has no product domain knowledge", () => {
  const files = walk(PROMO).filter(
    (f) => !EXEMPT.some((e) => relative(PROMO, f) === e)
  );

  it("has files to check", () => {
    // A guard that scans nothing passes vacuously.
    expect(files.length).toBeGreaterThan(0);
  });

  it("names no concrete build outside content/examples.js", () => {
    const offenders = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8").toLowerCase();
      for (const word of BANNED) {
        if (src.includes(word)) {
          offenders.push(`${relative(PROMO, f)} says "${word}"`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // Prove the guard can FAIL. An assertion of absence proves nothing until you
  // have proven the thing can be present (2026-08-01 (16)).
  it("would catch a banned word", () => {
    const planted = 'const label = "Schedule";'.toLowerCase();
    expect(BANNED.some((w) => planted.includes(w))).toBe(true);
  });

  // "Moduli" is the internal codename. The product is Viafluere.
  it("never says Moduli in promo source", () => {
    const offenders = files.filter((f) =>
      /moduli/i.test(
        readFileSync(f, "utf8").replace(/moduli-(token|userId|gridId)/g, "")
      )
    );
    expect(offenders.map((f) => relative(PROMO, f))).toEqual([]);
  });
});
