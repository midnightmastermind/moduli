// The load timeline has to LEAVE the device.
//
// Every `[load]` figure in CLAUDE.md came from a desktop probe while the load
// that is actually slow runs ~3.3x longer on the tablet — and the tablet has no
// console. `dragPerf` learned this on 2026-09-01: "INSTRUMENTED IS NOT
// MEASURED — it logged only to a console on the one device that has the
// problem, so nobody had ever read it."
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { startLoadDiag, markLoad, loadDiagLine } from "../helpers/loadDiag";

const reset = () => {
  delete window.__loadDiag;
  delete window.__loadDiagState;
  delete window.__loadLongTasks;
  delete window.__loadMarks;
};

describe("loadDiagLine", () => {
  beforeEach(reset);
  afterEach(reset);

  test("is ON without anyone setting a flag — the device has no console", () => {
    startLoadDiag();
    expect(loadDiagLine()).toBeTruthy();
  });

  test("`window.__loadDiag = false` turns it off", () => {
    window.__loadDiag = false;
    startLoadDiag();
    expect(loadDiagLine()).toBeNull();
  });

  test("carries the three marks that say WHERE the tail goes", () => {
    startLoadDiag();
    markLoad("ops:start", { ops: 67 });
    markLoad("ops:end", { ms: 3033 });
    markLoad("effects:end", { count: 238, ms: 2900 });
    const line = loadDiagLine();
    // Not asserting the numbers — a fake clock would only pin the harness.
    // What must be present is the SHAPE, because a line that silently drops a
    // field reads as "that phase cost nothing".
    for (const k of ["ops:start=", "sweep=", "effects=", "opsDone=", "blocked=", "top=", "dom="]) {
      expect(line).toContain(k);
    }
  });

  test("an ABSENT long-task API reads as UNSUPPORTED, never as zero", () => {
    // The 2026-08-04 trap: Firefox implements no Long Tasks API, the verdict
    // logic read `0` as "main thread idle", and crowned RASTER by construction.
    startLoadDiag();
    window.__loadLongTasks = { supported: false, tasks: [] };
    expect(loadDiagLine()).toContain("blocked=UNSUPPORTED");
  });

  test("reports the blocked total when the API IS there — the control", () => {
    // Without this, "never reads as zero" would also be satisfied by a line
    // that never reports blocking at all.
    startLoadDiag();
    window.__loadLongTasks = { supported: true, tasks: [{ t: 1800, ms: 780 }, { t: 4400, ms: 320 }] };
    const line = loadDiagLine();
    expect(line).toContain("blocked=1100ms/2tasks");
    // WITH timestamps — a total alone cannot say whether the cost sits before
    // or after the sweep, which is the entire question being asked.
    expect(line).toContain("780ms@1800");
  });

  test("the tag distinguishes the two samples", () => {
    startLoadDiag();
    expect(loadDiagLine("load+20s")).toContain("[load+20s]");
  });
});
