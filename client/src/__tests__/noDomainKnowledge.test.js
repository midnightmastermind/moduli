// __tests__/noDomainKnowledge.test.js
//
// The renderers and helpers must not recognize "a schedule". A grid is whatever
// its DATA says it is: the seed files author schedules, day columns and goals as
// data, and operations act on them — but no component may branch on a label
// prefix, a page name, or a container kind meaning something.
//
// Seed files are exempt (they are the data). This guard covers client source.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src");

// Each entry is [pattern, what it was]. Add to this list rather than weakening it.
const BANNED = [
  [/SCHEDULE_LABEL_PREFIX/, "container header sniffing a \"Schedule - \" label prefix"],
  [/computeScheduleColLabel/, "recomputing a header from a date because it looked like a day column"],
  [/WEEKDAY_RAINBOW/, "board renderer coloring children by weekday"],
  [/right:\s*["']Schedule["']/, "resolving a page by the literal name \"Schedule\""],
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__" && name !== "node_modules") walk(p, out);
    } else if (/\.(js|jsx)$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe("no schedule-specific code in client source", () => {
  it("has no banned identifiers", () => {
    const offenders = [];
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const [rx, what] of BANNED) {
        if (rx.test(text)) offenders.push(`${file.replace(SRC, "src")} — ${what}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
