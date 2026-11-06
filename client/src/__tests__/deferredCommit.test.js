// The date picker painted a picked day only after the filter change it caused had run (0.4-0.9s on a phone at 4x,
// measured 2026-11-06). The pick now paints first and the commit follows after the paint.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createDeferredCommit } from "../helpers/deferredCommit.js";

const manual = () => { const q = []; const schedule = (fn) => { q.push(fn); let gone = false; return () => { gone = true; q.splice(q.indexOf(fn), 1); void gone; }; }; return { q, schedule, run: () => q.splice(0).forEach((f) => f()) }; };

describe("createDeferredCommit", () => {
  it("does not commit in the click; commits after the paint", () => {
    const m = manual(); const got = []; const c = createDeferredCommit((v) => got.push(v), m.schedule);
    c.push("a");
    expect(got).toEqual([]);
    m.run();
    expect(got).toEqual(["a"]);
  });
  it("several picks before the paint commit once, with the last", () => {
    const m = manual(); const got = []; const c = createDeferredCommit((v) => got.push(v), m.schedule);
    c.push("a"); c.push("b"); c.push("c");
    m.run();
    expect(got).toEqual(["c"]);
  });
  it("flush sends a waiting pick now, and only once", () => {
    const m = manual(); const got = []; const c = createDeferredCommit((v) => got.push(v), m.schedule);
    c.push("a"); c.flush(); m.run(); c.flush();
    expect(got).toEqual(["a"]);
  });
  it("flush with nothing waiting does nothing", () => {
    const m = manual(); const got = []; const c = createDeferredCommit((v) => got.push(v), m.schedule);
    c.flush(); expect(got).toEqual([]);
  });
  it("reads the latest onCommit, so a re-rendered parent's handler is the one called", () => {
    const m = manual(); const got = []; let fn = (v) => got.push(`old ${v}`);
    const c = createDeferredCommit((v) => fn(v), m.schedule);
    c.push("a"); fn = (v) => got.push(`new ${v}`); m.run();
    expect(got).toEqual(["new a"]);
  });
});

describe("wiring", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/ui/NavPickerPopover.jsx"), "utf8");
  it("the picker sends its commits through it and flushes on close", () => {
    expect(src).toMatch(/createDeferredCommit\(/);
    expect(src).toMatch(/\.flush\(\)/);
  });
  it("the picker no longer calls onCommit inside its own commit", () => {
    const body = src.slice(src.indexOf("const commit = (nextSel)"), src.indexOf("const handleDayClick"));
    expect(body).not.toMatch(/onCommit\?\.\(/);
  });
});
