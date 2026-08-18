// The promo surface must not drag the grid into a logged-out visitor's
// download. This is a STATIC import check: it reads the source rather than
// bundling, so it fails at the moment someone types the import.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const PROMO = join(process.cwd(), "src", "promo");

// Each entry is [pattern, why it is banned]. Add to this list, never weaken it.
const BANNED = [
  [/from\s+["'].*\/App(\.jsx)?["']/, "the grid application"],
  [/from\s+["'].*\/state\//, "the app store"],
  [/from\s+["'].*\/modules\//, "grid renderers"],
  [/from\s+["'].*\/helpers\/CommitHelpers/, "the app write layer"],
];

// The socket is allowed ONLY as a lazy import inside the login route: a
// visitor reading the landing page must not open a websocket.
const SOCKET_STATIC = /^\s*import\s+[^;]*from\s+["'].*\/socket(\.js)?["']/m;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__") walk(p, out);
    } else if (/\.(js|jsx)$/.test(name)) out.push(p);
  }
  return out;
}

describe("promo isolation", () => {
  const files = walk(PROMO);

  it("finds promo source to check", () => {
    // A guard that scans nothing passes vacuously. Prove it has input.
    expect(files.length).toBeGreaterThan(0);
  });

  it("imports nothing from the grid application", () => {
    const offenders = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const [re, what] of BANNED) {
        if (re.test(src)) offenders.push(`${f}: imports ${what}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never imports the socket statically", () => {
    const offenders = files.filter((f) => SOCKET_STATIC.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
