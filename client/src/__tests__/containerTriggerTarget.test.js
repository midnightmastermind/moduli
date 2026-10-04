// A CONTAINER-role trigger target is a PLACEMENT (occurrence id), not a module.
//
// Every container-role event the executor matches carries an OCCURRENCE id —
// a graph click's `containerId`, an add's `containerId`, a move's
// `fromContainerId` (matchSubjectFilter). The trigger editor offered MODULES for
// that role, so a target picked in the UI could never match: building
// `Mood: Record Selection` on the rebuild (2026-10-04) picked the wheel's module
// `59614777…` while every click carried its occurrence `1b689542…`. Measured
// across every grid: ONE container-role trigger has a target, and it stores an
// occurrence id (poms' wheel, seed-written) — the executor's convention stands.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { computeTriggerMatch } from "../helpers/operationExecutor";

const SRC = fs.readFileSync(path.resolve(__dirname, "../ui/commandCenter/OperationsTab.jsx"), "utf8");

const op = (targetId) => ({
  id: "op", enabled: true, triggerTypes: ["onGraphSelect"],
  triggerObjects: [{ eventType: "onGraphSelect", subjectType: "module", subjectRole: "container", targetId }],
});
const click = { type: "GraphSelectOp", occurrenceId: "slice-occ", containerId: "wheel-occ" };

describe("a container-role trigger target", () => {
  it("matches a graph click by the graph's OCCURRENCE id", () => {
    expect(computeTriggerMatch(op("wheel-occ"), "GraphSelectOp", click)?.matched).toBe(true);
  });

  it("does not match by the graph's MODULE id — what the editor used to store", () => {
    expect(computeTriggerMatch(op("wheel-module"), "GraphSelectOp", click)).toBeFalsy();
  });

  it("the editor offers container PLACEMENTS for the container role", () => {
    expect(SRC).toMatch(/placementTarget = subjectType === "module" && subjectRole === "container"/);
    expect(SRC).toMatch(/buildContainerCrumbOptions\(occurrencesById, modulesById/);
    expect(SRC).toMatch(/options=\{containerTargetOptions\}/);
    // and the module list is kept for the other roles (instance compares a module id)
    expect(SRC).toMatch(/subjectType === "module" && !placementTarget && entitiesForSubject\.length > 0/);
  });
});
