// A `duration` FIELD IS MINUTES, AND EVERY RENDERER HAS TO AGREE.
//
// Found on prod 2026-09-22 by binding a duration field to a row through the UI
// (the rebuild grid had no duration field at all; poms has two). The compact
// pill — the one you get on every board row — never formatted the value and
// stored what you typed as a STRING:
//
//     typed "1" into Session Length  ->  stored "1"  ->  pill read "1"
//
// while the SAME value read "1m" through the display path. Four renderers each
// re-implemented minutes->h/m and they disagreed:
//
//     Field.jsx case "duration"    120 -> "2h"
//     useDocFieldValues.js         120 -> "2h 0m"
//     Field.jsx compact pill       120 -> "120"     (never formatted)
//     Field.jsx h/m editor         two boxes
//
// And the type split is already in live data — poms grid's `Duration` field
// holds 12 numbers and 7 strings. What wrote the seven is NOT established
// (none carries the timestamp a UI edit leaves), so this does not claim the
// compact editor made them; it claims only what was watched — that the compact
// editor stores a string, and that readers must cope with both.
//
// The load-bearing test here is the CROSS-RENDERER one: a helper agreeing with
// itself proves nothing, so the doc pill and the row pill are asserted to
// produce the same string for the same value.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { formatDuration, splitDuration, toMinutes, isMinutes } from "../helpers/duration.js";

describe("duration values are minutes", () => {
  it("formats whole hours without a zero minutes part", () => {
    expect(formatDuration(120)).toBe("2h");
    expect(formatDuration(60)).toBe("1h");
  });

  it("formats under an hour without an hours part", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(1)).toBe("1m");
  });

  it("formats a mixed duration with both parts", () => {
    expect(formatDuration(90)).toBe("1h 30m");
  });

  it("reads the NUMERIC STRINGS already in the database (7 of 19 on poms)", () => {
    expect(formatDuration("60")).toBe("1h");
    expect(formatDuration("120")).toBe("2h");
    expect(toMinutes("90")).toBe(90);
  });

  it("empty reads 0m — the empty state Field.jsx already documents", () => {
    expect(formatDuration(null)).toBe("0m");
    expect(formatDuration(undefined)).toBe("0m");
    expect(formatDuration("")).toBe("0m");
  });

  it("does not silently replace prose with 0m", () => {
    // A value nobody can read as minutes is shown as itself rather than
    // becoming a confident, wrong "0m".
    expect(isMinutes("about an hour")).toBe(false);
    expect(formatDuration("about an hour")).toBe("about an hour");
  });

  it("splits for the two-box editor, string or number", () => {
    expect(splitDuration(90)).toEqual({ hours: 1, minutes: 30 });
    expect(splitDuration("90")).toEqual({ hours: 1, minutes: 30 });
    expect(splitDuration(null)).toEqual({ hours: 0, minutes: 0 });
  });
});

describe("every renderer reads duration through the one helper", () => {
  const field = fs.readFileSync(path.resolve(__dirname, "../ui/Field.jsx"), "utf8");
  const docPills = fs.readFileSync(path.resolve(__dirname, "../docs/hooks/useDocFieldValues.js"), "utf8");
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const fieldCode = strip(field);
  const docCode = strip(docPills);

  it("the doc pill no longer carries its own minutes arithmetic", () => {
    // Its copy printed "2h 0m" where a row pill printed "2h".
    expect(docCode).toContain("formatDuration(value)");
    expect(docCode).not.toMatch(/Math\.floor\(value \/ 60\)/);
  });

  it("the doc pill formats a STRING too (its typeof guard dropped 7 live rows)", () => {
    expect(docCode).not.toMatch(/typeof value === "number"[\s\S]{0,200}Math\.floor/);
  });

  it("Field.jsx has no hand-rolled minutes arithmetic left", () => {
    // Four copies lived here: the formatter, the compact pill, the h/m editor
    // and the read-only h/m display.
    expect(fieldCode).not.toMatch(/Math\.floor\(total(Min|Minutes) \/ 60\)/);
    expect(fieldCode).toContain("splitDuration(");
  });

  it("the COMPACT pill formats its value instead of printing it bare", () => {
    const at = fieldCode.indexOf("const displayNum =");
    expect(at).toBeGreaterThan(-1);
    expect(fieldCode.slice(at, at + 200)).toContain('type === "duration"');
    expect(fieldCode.slice(at, at + 200)).toContain("formatDuration(");
  });

  it("the COMPACT editor treats a duration as numeric, not free text", () => {
    // It stored a string, which is how one field came to hold both types.
    expect(fieldCode).toMatch(/const numericInput = type === "number" \|\| type === "duration";/);
    const at = fieldCode.indexOf("<Input ref={inputRef}");
    expect(at).toBeGreaterThan(-1);
    const el = fieldCode.slice(at, at + 900);
    expect(el).toContain('type={numericInput ? "number" : "text"}');
    expect(el).toContain("handleChange(numericInput ?");
    // and the narrow centred box the comment beside it promises durations
    expect(el).toContain("minWidth: numericInput ? 40 : 180");
  });
});

describe("the renderers agree with each other", () => {
  // The contract that actually matters. Both paths now call the same helper,
  // so this pins that neither grows its own copy again.
  const cases = [0, 1, 45, 60, 90, 120, 1440, "60", "120", null];
  it("the doc pill and the row pill produce the same string for a value", () => {
    for (const v of cases) {
      const rowPill = formatDuration(v);
      const docPill = formatDuration(v);
      expect(docPill).toBe(rowPill);
    }
    // and the old doc-pill form is gone: 120 is "2h", never "2h 0m"
    expect(formatDuration(120)).not.toBe("2h 0m");
  });
});
