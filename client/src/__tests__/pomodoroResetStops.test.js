// Resetting or skipping a STARTED work phase — running or paused part-way —
// fires the stop event that deletes the open session (2026-10-03).
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
const src = fs.readFileSync(path.join(__dirname, "../ui/PomodoroTimer.jsx"), "utf8");
describe("PomodoroTimer reset/skip", () => {
  it("a work session counts as started once time has run, not only while running", () => {
    expect(src).toMatch(/const workStarted = phase\.label === "Work" && \(running \|\| remaining < phase\.duration\);/);
  });
  it("both reset and skip fire PomoStopOp on a started session", () => {
    for (const name of ["reset", "skip"]) {
      const a = src.indexOf(`const ${name} = useCallback(`); const body = src.slice(a, src.indexOf("}, [", a));
      expect(body).toMatch(/if \(workStarted\) \{\s*operationsBridge\.fireOperations\?\.\("PomoStopOp"/);
    }
  });
});
