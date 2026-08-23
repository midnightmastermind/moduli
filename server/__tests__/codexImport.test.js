// Resumability is the whole safety of a ~2,200-occurrence write: a run that dies
// at file 40 must leave 35, and a re-run must do exactly those.
import { describe, it, expect } from "vitest";
import { planCodexRun } from "../migrations/0203-codex-import.mjs";

const files = [
  { relPath: "a.md", folder: "" },
  { relPath: "writing/b.md", folder: "writing" },
  { relPath: "untitled_notes/Untitled 1.md", folder: "untitled_notes" },
];

describe("planCodexRun", () => {
  it("skips files a previous run already imported", () => {
    const done = new Set(["a.md"]);
    expect(planCodexRun(files, done).todo.map(f => f.relPath))
      .toEqual(["writing/b.md", "untitled_notes/Untitled 1.md"]);
    expect(planCodexRun(files, done).alreadyDone).toBe(1);
  });

  it("does everything on a first run", () => {
    expect(planCodexRun(files, new Set()).todo).toHaveLength(3);
  });

  it("does NOTHING on a converged run — a re-run must create nothing", () => {
    const done = new Set(files.map(f => f.relPath));
    expect(planCodexRun(files, done).todo).toEqual([]);
  });

  it("tells a repeated BASENAME apart by its folder", () => {
    // `Untitled 1.md` exists at the root too, with different content. If the
    // root one is done, the untitled_notes one must STILL be pending.
    const two = [...files, { relPath: "Untitled 1.md", folder: "" }];
    const done = new Set(["Untitled 1.md"]);
    expect(planCodexRun(two, done).todo.map(f => f.relPath)).toContain("untitled_notes/Untitled 1.md");
  });
});
