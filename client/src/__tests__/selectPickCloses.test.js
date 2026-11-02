// __tests__/selectPickCloses.test.js
// User 2026-11-02: "select inputs arent closing when i select something". The compact single-select pills (a plain
// select like Gender, and a single occurrence pick) used an UNCONTROLLED <Popover>, so a pick wrote the value and
// left the list open. Every other popover in Field.jsx is controlled. A source guard: Radix popovers do not open
// reliably in jsdom (a component test for the occurrence dropdown was deleted for that, 2026-08-06).
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = fs.readFileSync(path.resolve(__dirname, "../ui/Field.jsx"), "utf8");

describe("a select pill closes when you pick", () => {
  it("no popover in Field.jsx is uncontrolled", () => {
    const bare = src.match(/<Popover>/g) || [];
    expect(bare).toHaveLength(0);
    expect((src.match(/<Popover open=/g) || []).length).toBeGreaterThan(4); // control: the popovers are still there
  });

  it("the compact single picks close the popover", () => {
    // plain select option button
    expect(src).toMatch(/onClick=\{\(\) => \{ handleChange\(o\.value\); onCommit\?\.\(o\.value\); setSelectOpen\(false\); \}\}/);
    // single occurrence pick (compact AND full)
    const closes = src.match(/onPick=\{\(v\) => \{ handleChange\(v\); onCommit\?\.\(v\); setSelectOpen\(false\); \}\}/g) || [];
    expect(closes.length).toBe(2);
  });
});
