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

// The GRAPH surface is the newest place domain knowledge could be smuggled in:
// it was built to draw a feeling wheel, and "feeling wheel" must live entirely
// in DATA (a board of emotions, two fields, one operation). A chart of anything
// else is the same container with a different `meta.graph`.
const GRAPH_FILES = [
  "helpers/graphData.js", "helpers/graphOption.js", "helpers/graphView.js",
  "ui/EChart.jsx", "ui/GraphSection.jsx", "modules/containers/ContainerGraph.jsx",
];
// Plain case-insensitive SUBSTRINGS, deliberately not \b-anchored. A word
// boundary does not fire inside an identifier — `_` and camelCase are word
// characters — so `EMOTION_RINGS` and `emotionLevel` both slipped straight
// through the first version of this guard. Verified by planting exactly that
// constant and watching the test pass; substrings catch it.
const GRAPH_BANNED = [
  [/emotion/i, "the graph knowing what an emotion is"],
  [/feeling/i, "the graph knowing what a feeling is"],
  [/mood/i, "the graph knowing what a mood is"],
  // "wheel" is deliberately NOT banned: it is a real input device (WheelEvent,
  // wheelFactor), so the pattern matched the zoom gesture code and said nothing
  // about domain knowledge. A guard that cries wolf gets weakened later.
];

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

  it("the GRAPH surface knows nothing about emotions, feelings or moods", () => {
    // The renderer draws whatever `meta.graph` and the graph's children say.
    // If this fails, the fix is to move the knowledge into data or an
    // operation — never to add the word to an allowlist.
    const offenders = [];
    for (const rel of GRAPH_FILES) {
      const text = readFileSync(join(SRC, rel), "utf8");
      // Comments legitimately explain the motivating use case; the guard is
      // about CODE, so they are stripped before matching.
      const code = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
      for (const [rx, what] of GRAPH_BANNED) {
        if (rx.test(code)) offenders.push(`src/${rel} — ${what}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
