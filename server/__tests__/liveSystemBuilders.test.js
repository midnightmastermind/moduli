// server/__tests__/liveSystemBuilders.test.js
import { describe, it, expect } from "vitest";
import { buildGridDoc, buildScheduleFilters, buildDailyRoutineTemplate, buildDayPageTemplate, makeScheduleBuildDayOp, makeScheduleBuildScheduleOp, makeDayPageBuildOp, makeStampDateTimeSlotOp, makeClearDateOnMoveOutOp, makeTrackerOp } from "../utils/liveSystemBuilders.js";

describe("buildGridDoc", () => {
  it("creates a Daily namedFilter on dateFieldId with empty activeFilterValues", () => {
    const g = buildGridDoc({ userId: "u1", gridName: "Live Grid", manifestId: "m1", dateFieldId: "DF" });
    expect(g.name).toBe("Live Grid");
    expect(g.activeFilterId).toBe("filter_daily");
    expect(g.namedFilters[0].conditions[0]).toMatchObject({ fieldId: "DF", comparator: "SAME_DAY", isNav: true });
    expect(g.activeFilterValues).toEqual({});
  });
});

describe("buildScheduleFilters", () => {
  it("returns a date filter + a timeslot select filter", () => {
    const f = buildScheduleFilters({ schedFilterId: "s", timeslotFilterId: "t", dateFieldId: "DF", timeslotFieldId: "TS", timeslotLabels: ["6:00am"] });
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({ id: "s", fieldId: "DF", active: true });
    expect(f[1]).toMatchObject({ id: "t", fieldId: "TS", style: "select", options: ["6:00am"] });
    expect(f[0].condition.rules).toHaveLength(2);
    expect(f[0].condition.rules[1]).toMatchObject({ comparator: "IS_EMPTY" });
  });
});

describe("buildDailyRoutineTemplate", () => {
  it("emits one slot template occ per timeSlot with identitySignature and routine children", async () => {
    const occs = [];
    const mkOcc = async (d) => { const id = d.id || `o${occs.length}`; occs.push({ ...d, id }); return id; };
    const ModuleStub = function (o) { Object.assign(this, o); this.save = async () => {}; };
    const rootOccId = await buildDailyRoutineTemplate({
      userId: "u", gridId: "g", timeSlots: [{ hour: 6, minute: 0, label: "6:00am" }, { hour: 7, minute: 0, label: "7:00am" }],
      timeslotFieldId: "TS",
      routineBySlot: { "6:00am": [{ sourceModId: "SRC", label: "Drink Water" }] },
      tplManifestRootFolderId: "tplRoot", mkOcc, Module: ModuleStub,
      findModule: async () => ({ fieldBindings: [{ fieldId: "c", role: "input", order: 0 }] }),
    });
    const slotOccs = occs.filter(o => o.identitySignature?.startsWith("slot:"));
    expect(slotOccs).toHaveLength(2);
    const root = occs.find(o => o.id === rootOccId);
    expect(root.meta).toMatchObject({ templateName: "Daily Routine", templateModule: true });
  });
});

describe("schedule ops", () => {
  it("Build Day op (test grid) is priority-1, onLoad+onFilterChange, references date/due/timeslot fields", () => {
    const op = makeScheduleBuildDayOp({ userId: "u", gridId: "g", dateFieldId: "DF", dueFieldId: "DUE", timeslotFieldId: "TS" });
    expect(op.name).toBe("Schedule: Build Day");
    expect(op.triggerTypes).toEqual(["onLoad", "onFilterChange"]);
    expect(op.triggerObjects.every(t => t.priority === 1)).toBe(true);
    expect(JSON.stringify(op.pipeline)).toContain("DF");
    expect(JSON.stringify(op.pipeline)).toContain("DUE");
    expect(JSON.stringify(op.pipeline)).toContain("TS");
  });
  it("Build Schedule op (live data) loops over $activePeriodDates and creates Day Columns", () => {
    const op = makeScheduleBuildScheduleOp({ userId: "u", gridId: "g", dateFieldId: "DF", dueFieldId: "DUE", timeslotFieldId: "TS", goalsPageOccId: "GP", schedulePageOccId: "SP" });
    expect(op.name).toBe("Schedule: Build Schedule");
    expect(op.triggerTypes).toEqual(["onLoad", "onFilterChange"]);
    expect(op.triggerObjects.every(t => t.priority === 1)).toBe(true);
    expect(JSON.stringify(op.pipeline)).toContain("DF");
    expect(JSON.stringify(op.pipeline)).toContain("DUE");
    expect(JSON.stringify(op.pipeline)).toContain("TS");
  });

  it("Build Schedule day-col ADD_CHILD runs unconditionally (self-heals half-populated day-cols)", () => {
    // Regression: ADD_CHILD steps used to live inside the
    // IF $dayColId IS_EMPTY THEN branch, so a partial run that
    // created the day-col without populating it stayed empty
    // forever. ADD_CHILD must run every pass through the per-day
    // loop — outside the day-col-existence gate specifically.
    const op = makeScheduleBuildScheduleOp({ userId: "u", gridId: "g", dateFieldId: "DF", dueFieldId: "DUE", timeslotFieldId: "TS", goalsPageOccId: "GP", schedulePageOccId: "SP" });
    const isDayColEmptyIf = (node) =>
      node?.type === "if"
      && (node.condition?.rules || []).some(r => r.left === "$dayColId" && r.comparator === "IS_EMPTY");
    const findAddChildLoops = (node, inDayColGate = false, hits = []) => {
      if (!node) return hits;
      if (Array.isArray(node)) { node.forEach(n => findAddChildLoops(n, inDayColGate, hits)); return hits; }
      if (typeof node !== "object") return hits;
      if (node.type === "loop" && Array.isArray(node.body)) {
        const inner = node.body[0];
        if (inner?.type === "action" && inner.config?.type === "ADD_CHILD" && inner.config.parentId === "$dayColId") {
          hits.push({ inDayColGate });
        }
        node.body.forEach(b => findAddChildLoops(b, inDayColGate, hits));
      }
      if (node.type === "if") {
        const nextGate = inDayColGate || isDayColEmptyIf(node);
        (node.then || []).forEach(s => findAddChildLoops(s, nextGate, hits));
        (node.else || []).forEach(s => findAddChildLoops(s, inDayColGate, hits));
      }
      if (!node.type) {
        for (const v of Object.values(node)) findAddChildLoops(v, inDayColGate, hits);
      }
      return hits;
    };
    const hits = findAddChildLoops(op.pipeline);
    expect(hits.length).toBeGreaterThan(0);
    // Every ADD_CHILD slot-loop must sit OUTSIDE the day-col-empty
    // gate so a half-built day-col gets repopulated on the next run.
    expect(hits.every(h => h.inDayColGate === false)).toBe(true);
  });
  it("Stamp op writes the timeslot field on onCreate under the hub panel", () => {
    const op = makeStampDateTimeSlotOp({ userId: "u", gridId: "g", timeslotFieldId: "TS", hubPanelModuleId: "HUB" });
    expect(op.triggerObjects[0]).toMatchObject({ eventType: "onCreate", targetId: "HUB" });
    expect(JSON.stringify(op.pipeline)).toContain("TS");
  });
  it("Day Page: Build is named correctly, priority-1, embeds the folder + hub params", () => {
    const op = makeDayPageBuildOp({ userId: "u", gridId: "g", dateFieldId: "DF", dayPagesFolderId: "DPF", hubPanelOccIdVar: "HUBOCC", goalsPageOccId: "GP", schedulePageOccId: "SP" });
    expect(op.name).toBe("Day Page: Build");
    expect(op.triggerObjects.every(t => t.priority === 1)).toBe(true);
    const s = JSON.stringify(op.pipeline);
    expect(s).toContain("DPF");
    expect(s).toContain("HUBOCC");
  });
  it("Clear Date on Move-Out is onMove and clears date + timeslot fields", () => {
    const op = makeClearDateOnMoveOutOp({ userId: "u", gridId: "g", dateFieldId: "DF", timeslotFieldId: "TS" });
    expect(op.name).toBe("Schedule: Clear Date on Move-Out");
    expect(op.triggerTypes).toEqual(["onMove"]);
    const s = JSON.stringify(op.pipeline);
    expect(s).toContain("DF");
    expect(s).toContain("TS");
  });
});

describe("buildDayPageTemplate", () => {
  it("creates a doc-page root referencing a textblock child with the {Date} token", async () => {
    const occs = [];
    const mkOcc = async (d) => { const id = d.id || `o${occs.length}`; occs.push({ ...d, id }); return id; };
    const ModuleStub = function (o) { Object.assign(this, o); this.save = async () => {}; };
    const rootOccId = await buildDayPageTemplate({
      userId: "u", gridId: "g", tplManifestRootFolderId: "tplRoot", mkOcc, Module: ModuleStub,
    });
    const root = occs.find(o => o.id === rootOccId);
    expect(root.meta).toMatchObject({ templateName: "Day Page", templateModule: true });
    const child = occs.find(o => o.id !== rootOccId);
    expect(JSON.stringify(child.textmap)).toContain("Day Page - {Date}");
  });
});

describe("makeTrackerOp", () => {
  const base = { userId: "u", gridId: "g", dateFieldId: "DF", completedFieldId: "CF" };
  it("sum: scopes to Schedule, finds goal by label, ADD_TO_VARs the source field, UPDATEs goal field", () => {
    const op = makeTrackerOp({ ...base, name: "Tracker: Water Today", goalLabel: "Physical Wellness", goalFieldId: "TW", sourceFieldId: "WF", agg: "sum", timeFilter: "daily" });
    const s = JSON.stringify(op.pipeline);
    expect(op.name).toBe("Tracker: Water Today");
    expect(s).toContain("\"right\":\"Physical Wellness\"");
    expect(s).toContain("ADD_TO_VAR");
    expect(s).toContain("$goalItem.fields.TW.value");
    expect(s).toContain("$goalItem._effectiveFilter.DF");
  });
  it("countTrue: increments by 1 on completed items, no source field needed", () => {
    const op = makeTrackerOp({ ...base, name: "Tracker: Done", goalLabel: "Task Progress", goalFieldId: "TC", agg: "countTrue", timeFilter: "daily" });
    expect(JSON.stringify(op.pipeline)).toContain("INCREMENT_VAR");
  });
  it("all timeFilter: omits the $goalDate SAME_DAY gate", () => {
    const op = makeTrackerOp({ ...base, name: "Tracker: Lifetime", goalLabel: "Bank", goalFieldId: "B", sourceFieldId: "AMT", agg: "sum", timeFilter: "all", scopeLabel: "Accounts" });
    const s = JSON.stringify(op.pipeline);
    expect(s).toContain("\"right\":\"Accounts\"");
    expect(s).not.toContain("SAME_DAY");
  });
  it("multiSum: sums each of sourceFieldIds", () => {
    const op = makeTrackerOp({ ...base, name: "Tracker: Reps", goalLabel: "Fitness", goalFieldId: "TR", sourceFieldIds: ["S1", "S2", "S3"], agg: "multiSum", timeFilter: "daily" });
    const s = JSON.stringify(op.pipeline);
    expect(s).toContain("S1"); expect(s).toContain("S2"); expect(s).toContain("S3");
  });

  it("net: two loops (income + spent), negates via MULTIPLY_VAR expr:-1, references both INC and SPN, no broken literal", () => {
    const op = makeTrackerOp({
      ...base,
      name: "Tracker: Net",
      goalLabel: "Bank",
      goalFieldId: "NB",
      incomeFieldId: "INC",
      spentFieldId: "SPN",
      agg: "net",
      timeFilter: "all",
    });
    const s = JSON.stringify(op.pipeline);
    // Both field IDs referenced in loop bodies.
    expect(s).toContain("INC");
    expect(s).toContain("SPN");
    // Must have a MULTIPLY_VAR step with expr:-1 (negate spent accumulator).
    const steps = JSON.parse(s).steps;
    function flatSteps(stepsArr) {
      const out = [];
      for (const step of stepsArr) {
        out.push(step);
        if (step.body)     out.push(...flatSteps(step.body));
        if (step.then)     out.push(...flatSteps(step.then));
        if (step.else)     out.push(...flatSteps(step.else));
      }
      return out;
    }
    const allSteps = flatSteps(steps);
    const mulNeg = allSteps.filter(s => s.type === "action" && s.config?.type === "MULTIPLY_VAR" && s.config?.expr === -1);
    expect(mulNeg.length).toBeGreaterThanOrEqual(1);
    // Must NOT contain the broken negation literal approach.
    expect(s).not.toContain('"-$item');
    // MULTIPLY_VAR must use expr key, not by key, for the negate step.
    expect(mulNeg[0].config).not.toHaveProperty("by");
    expect(mulNeg[0].config).toHaveProperty("expr", -1);
  });

  it("last: pipeline contains SET_VAR, does NOT contain ADD_TO_VAR, references sourceFieldId", () => {
    const op = makeTrackerOp({ ...base, name: "Tracker: Last Mood", goalLabel: "Mood", goalFieldId: "LM", sourceFieldId: "MOOD", agg: "last", timeFilter: "daily" });
    const s = JSON.stringify(op.pipeline);
    // last must overwrite, not accumulate — guards against copy-paste regression to ADD_TO_VAR
    expect(s).toContain("SET_VAR");
    expect(s).not.toContain("ADD_TO_VAR");
    expect(s).toContain("MOOD");
  });

  it("flow:out sum — serialized pipeline contains flow comparator rule", () => {
    const op = makeTrackerOp({ ...base, name: "Tracker: Spent", goalLabel: "Expenses", goalFieldId: "EXP", sourceFieldId: "AMT", agg: "sum", flow: "out", timeFilter: "daily" });
    const s = JSON.stringify(op.pipeline);
    // flow-filter rule injection is otherwise completely untested;
    // the rule emits left:"$item.fields.AMT.flow" comparator:"IS" right:"out"
    expect(s).toContain(".flow");
    expect(s).toContain("\"right\":\"out\"");
    expect(s).toContain("AMT");
  });

  it("guard: net without incomeFieldId + spentFieldId throws", () => {
    expect(() => makeTrackerOp({ ...base, name: "X", goalLabel: "G", goalFieldId: "GF", agg: "net", timeFilter: "all" })).toThrow(/requires incomeFieldId/);
  });

  it("completionRate: MULTIPLY_VAR uses expr:100 (not by:100), DIV_VAR uses by:\"$tot\"", () => {
    const op = makeTrackerOp({
      ...base,
      name: "Tracker: Rate",
      goalLabel: "Done%",
      goalFieldId: "CR",
      agg: "completionRate",
      timeFilter: "daily",
    });
    const s = JSON.stringify(op.pipeline);
    // Must contain MULTIPLY_VAR step with expr:100.
    const steps = JSON.parse(s).steps;
    function flatSteps(stepsArr) {
      const out = [];
      for (const step of stepsArr) {
        out.push(step);
        if (step.body)     out.push(...flatSteps(step.body));
        if (step.then)     out.push(...flatSteps(step.then));
        if (step.else)     out.push(...flatSteps(step.else));
      }
      return out;
    }
    const allSteps = flatSteps(steps);
    const mulHundred = allSteps.filter(s => s.type === "action" && s.config?.type === "MULTIPLY_VAR" && s.config?.expr === 100);
    expect(mulHundred.length).toBeGreaterThanOrEqual(1);
    // Must NOT have MULTIPLY_VAR with by:100 (the broken pattern).
    const mulHundredByKey = allSteps.filter(s => s.type === "action" && s.config?.type === "MULTIPLY_VAR" && s.config?.by === 100);
    expect(mulHundredByKey).toHaveLength(0);
    // DIV_VAR must use by:"$tot" (executor reads cfg.by for DIV_VAR).
    const divSteps = allSteps.filter(s => s.type === "action" && s.config?.type === "DIV_VAR");
    expect(divSteps.length).toBeGreaterThanOrEqual(1);
    expect(divSteps[0].config).toHaveProperty("by", "$tot");
  });
});
