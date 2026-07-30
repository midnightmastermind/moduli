// server/__tests__/liveSystemBuilders.test.js
import { describe, it, expect } from "vitest";
import { buildGridDoc, buildScheduleFilters, buildDailyRoutineTemplate, buildDayPageTemplate, makeScheduleBuildDayOp, makeScheduleBuildScheduleOp, makeDayPageBuildOp, makeStampDateTimeSlotOp, makeClearDateOnMoveOutOp, makeTrackerOp, makeDayPageBuildTasksCompletedOp, makeMediaHistoryOp } from "../utils/liveSystemBuilders.js";

// Recursively flatten a pipeline's steps (then/else/body branches included).
function flattenSteps(steps) {
  const out = [];
  const walk = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const s of arr) {
      out.push(s);
      if (s.then) walk(s.then);
      if (s.else) walk(s.else);
      if (s.body) walk(s.body);
    }
  };
  walk(steps);
  return out;
}

describe("makeDayPageBuildTasksCompletedOp — inclusive scope guard (cascade fix)", () => {
  const op = makeDayPageBuildTasksCompletedOp({
    userId: "u", gridId: "g", dateFieldId: "DF", completedFieldId: "CF", isTaskFieldId: "TF",
  });
  const steps = flattenSteps(op.pipeline.steps);

  it("computes a $isSourceChange flag set on bulk fires (no trigger occurrence)", () => {
    expect(steps.some(s => s.config?.type === "INIT_VAR" && s.config?.name === "$isSourceChange")).toBe(true);
    // The bulk branch: IF $triggerOccId IS_EMPTY → SET $isSourceChange = 1
    const bulkIf = steps.find(s =>
      s.type === "if" &&
      s.condition?.rules?.some(r => r.left === "$triggerOccId" && r.comparator === "IS_EMPTY"));
    expect(bulkIf).toBeTruthy();
    expect(JSON.stringify(bulkIf.then)).toContain("$isSourceChange");
  });

  it("sets $isSourceChange when the trigger occurrence is under the Schedule page", () => {
    const ancestorIf = steps.find(s =>
      s.type === "if" &&
      s.condition?.rules?.some(r =>
        r.left === "$trigger.occurrence._ancestors" &&
        r.comparator === "HAS_ANCESTOR" &&
        r.right === "$schedPageId"));
    expect(ancestorIf).toBeTruthy();
    expect(JSON.stringify(ancestorIf.then)).toContain("$isSourceChange");
  });

  it("gates the rebuild on $isSourceChange IS 1 (so non-source CRUD echoes no-op)", () => {
    const gate = steps.find(s =>
      s.type === "if" &&
      s.condition?.rules?.some(r => r.left === "$dayPageId" && r.comparator === "IS_NOT_EMPTY") &&
      s.condition?.rules?.some(r => r.left === "$isSourceChange" && r.comparator === "IS" && r.right === 1));
    expect(gate).toBeTruthy();
  });
});

describe("buildGridDoc", () => {
  it("creates a Daily namedFilter on dateFieldId with empty activeFilterValues", () => {
    const g = buildGridDoc({ userId: "u1", gridName: "Poms", manifestId: "m1", dateFieldId: "DF" });
    expect(g.name).toBe("Poms");
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
    // 2 hour slots + 1 Due container (identitySig "slot:Due", first child of Day)
    expect(slotOccs).toHaveLength(3);
    expect(slotOccs.some(o => o.identitySignature === "slot:Due")).toBe(true);
    const root = occs.find(o => o.id === rootOccId);
    expect(root.meta).toMatchObject({ templateName: "Daily Routine", templateModule: true });
  });
});

describe("buildScheduleTemplatePage", () => {
  it("seeds a Schedule Template page under libraryTemplatesFolderId with a Day container holding Due + slots", async () => {
    const { buildScheduleTemplatePage } = await import("../utils/liveSystemBuilders.js");
    const occs = [];
    const mkOcc = async (d) => { const id = d.id || `o${occs.length}`; occs.push({ ...d, id }); return id; };
    const ModuleStub = function (o) { Object.assign(this, o); this.save = async () => {}; };
    const { schedTplPageOccId, dayContainerOccId } = await buildScheduleTemplatePage({
      userId: "u", gridId: "g",
      timeSlots: [{ hour: 6, minute: 0, label: "6:00am" }, { hour: 7, minute: 0, label: "7:00am" }],
      timeslotFieldId: "TS",
      routineBySlot: { "6:00am": [{ sourceModId: "SRC", label: "Drink Water" }] },
      libraryTemplatesFolderId: "LIBT", mkOcc, Module: ModuleStub,
      findModule: async () => ({ fieldBindings: [{ fieldId: "c", role: "input", order: 0 }] }),
    });
    const page = occs.find(o => o.id === schedTplPageOccId);
    expect(page.parentId).toBe("LIBT");
    const day = occs.find(o => o.id === dayContainerOccId);
    expect(day.identitySignature).toBe("day-container");
    expect(day.parentId).toBe(schedTplPageOccId);
    // Day's occurrences[] = [Due, Todo, slot1, slot2]
    expect(day.occurrences).toHaveLength(4);
    const slotOccs = occs.filter(o => o.identitySignature?.startsWith("slot:"));
    expect(slotOccs).toHaveLength(4);
    expect(slotOccs.some(o => o.identitySignature === "slot:Due")).toBe(true);
    expect(slotOccs.some(o => o.identitySignature === "slot:Todo")).toBe(true);
    expect(slotOccs.every(o => o.parentId === dayContainerOccId)).toBe(true);
  });
});

// Guardrail: every reference in the build op should be picker-emittable —
// either a `$var` runtime ref, a path expression, or a picker-direct binding
// (`$allItemsById.<id>`). Raw bare UUIDs/nanoids appearing as `right` values
// in FIND/IF predicates or as `sourceId` in COPY_LINK would imply the op
// author had to type a literal id, which the picker UI never does.
// `left` paths can contain field/module ids (e.g. `fields.<fid>.value`) by
// design — those reflect the picker's "drill into this field" output —
// so we only scan `right` + a few cfg leaves where bare ids would be the
// smell.
function collectBareIdLeaks(node, path = "") {
  const leaks = [];
  const isBareId = (v) =>
    typeof v === "string"
    && !v.startsWith("$")        // not a var ref
    && !v.startsWith("literal:") // not an explicit literal
    && !v.startsWith("field:")   // not a picker field ref
    && !v.startsWith("op:")      // not a picker op ref
    && !v.includes("${")         // not a template string
    && !v.includes(" ")          // not a sentence (labels often have spaces)
    // 12-char nanoid OR uuid v4
    && (/^[A-Za-z0-9_-]{12}$/.test(v) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v));

  const visit = (n, p) => {
    if (n == null) return;
    if (Array.isArray(n)) { n.forEach((x, i) => visit(x, `${p}[${i}]`)); return; }
    if (typeof n !== "object") return;
    // Predicate rule shape
    if (typeof n.left === "string" && n.comparator && "right" in n) {
      if (isBareId(n.right)) leaks.push(`${p}.right="${n.right}"`);
    }
    // COPY_LINK / APPLY_TEMPLATE / CREATE leaf cfg keys where a bare id
    // would mean the author typed an id instead of picking a $var.
    for (const k of ["sourceId", "templateRef", "parent", "rootParent", "targetOccurrenceVar", "sourceOccurrenceVar"]) {
      if (typeof n[k] === "string" && isBareId(n[k])) leaks.push(`${p}.${k}="${n[k]}"`);
    }
    for (const [k, v] of Object.entries(n)) visit(v, p ? `${p}.${k}` : k);
  };
  visit(node, path);
  return leaks;
}

describe("schedule ops", () => {
  it("Build Schedule op has no hand-typed bare ids — every entity ref goes through a picker / runtime var", () => {
    const op = makeScheduleBuildScheduleOp({ userId: "u", gridId: "g", dateFieldId: "DF", dueFieldId: "DUE", timeslotFieldId: "TS", scheduleFormatFieldId: "SF", goalsPageOccId: "GP", schedulePageOccId: "SP", dayContainerOccId: "DAY" });
    // The seed-time picker-direct bindings (INIT_VAR $schedPage expr:
    // "$allItemsById.<id>") are INTENTIONAL and would be authored via
    // the picker — they show up as `expr` strings starting with
    // `$allItemsById.`, which our `isBareId` already excludes (starts
    // with `$`). The guardrail only catches truly-bare uuids/nanoids
    // sitting at right/sourceId/parent positions.
    const leaks = collectBareIdLeaks(op.pipeline);
    expect(leaks).toEqual([]);
  });

  it("Build Day op (test grid) is priority-1, onLoad+onFilterChange, references date/due/timeslot fields", () => {
    const op = makeScheduleBuildDayOp({ userId: "u", gridId: "g", dateFieldId: "DF", dueFieldId: "DUE", timeslotFieldId: "TS" });
    expect(op.name).toBe("Schedule: Build Day");
    expect(op.triggerTypes).toEqual(["onLoad", "onFilterChange"]);
    expect(op.triggerObjects.every(t => t.priority === 1)).toBe(true);
    expect(JSON.stringify(op.pipeline)).toContain("DF");
    expect(JSON.stringify(op.pipeline)).toContain("DUE");
    expect(JSON.stringify(op.pipeline)).toContain("TS");
  });
  it("Build Schedule op (live data) loops over $activePeriodDates and COPY_LINKs the Day container per day", () => {
    const op = makeScheduleBuildScheduleOp({ userId: "u", gridId: "g", dateFieldId: "DF", dueFieldId: "DUE", timeslotFieldId: "TS", scheduleFormatFieldId: "SF", goalsPageOccId: "GP", schedulePageOccId: "SP", dayContainerOccId: "DAY" });
    expect(op.name).toBe("Schedule: Build Schedule");
    expect(op.triggerTypes).toEqual(["onLoad", "onFilterChange"]);
    expect(op.triggerObjects.every(t => t.priority === 1)).toBe(true);
    const s = JSON.stringify(op.pipeline);
    expect(s).toContain("DF");
    expect(s).toContain("DAY");
    expect(s).toContain("SF");
    expect(s).toContain("$activePeriodDates");
    expect(s).toContain("COPY_LINK");
    expect(s).toContain("$dayContId");
  });

  it("Build Schedule sets targetOccurrenceId to the Schedule page so $activePeriodDates resolves from the page's effective filter (uniform with grid/page switches)", () => {
    // Without this the built-in date vars fall back to the GRID filter only,
    // so an on-page date switch (writes the page's filterOverride, not the
    // grid) left the period stale and the schedule rebuilt for the old day.
    const op = makeScheduleBuildScheduleOp({ userId: "u", gridId: "g", dateFieldId: "DF", dueFieldId: "DUE", timeslotFieldId: "TS", scheduleFormatFieldId: "SF", goalsPageOccId: "GP", schedulePageOccId: "SP", dayContainerOccId: "DAY" });
    expect(op.targetOccurrenceId).toBe("SP");
  });

  it("Build Schedule builds day-cols hybrid: CREATE day-col + shallow COPY_LINK slots + APPLY_TEMPLATE per-day instances with date stamps", () => {
    // Day-col: fresh CREATE so its label can carry the date.
    // Slots: shallow COPY_LINK (recursive:false) — module + linkedGroupId
    //        shared so editing template's "6:00am" propagates everywhere.
    // Instances: APPLY_TEMPLATE on each — deep clone (fresh module + fresh
    //            occurrence, no linkedGroupId). Completion is per-day.
    //            defaultFields stamps the date on instance-role clones.
    const op = makeScheduleBuildScheduleOp({ userId: "u", gridId: "g", dateFieldId: "DF", dueFieldId: "DUE", timeslotFieldId: "TS", scheduleFormatFieldId: "SF", goalsPageOccId: "GP", schedulePageOccId: "SP", dayContainerOccId: "DAY" });
    const s = JSON.stringify(op.pipeline);
    // Day-col created fresh via CREATE with date-stamped name.
    expect(s).toContain("\"type\":\"CREATE\"");
    expect(s).toContain("Schedule - ${dateLong:$day}");
    expect(s).toContain("\"filterOverride\":{\"DF\":\"$day\"}");
    // Shallow COPY_LINK of slot templates.
    expect(s).toContain("\"sourceId\":\"$tplChildId\"");
    expect(s).toContain("\"recursive\":false");
    // Per-instance APPLY_TEMPLATE with defaultFields date stamp.
    expect(s).toContain("\"type\":\"APPLY_TEMPLATE\"");
    expect(s).toContain("\"templateRef\":\"$tplInstId\"");
    expect(s).toContain("\"rootParent\":\"$slotCopyId\"");
    expect(s).toContain("\"defaultFields\":{\"DF\":\"$day\"}");
  });
  it("Stamp op writes the timeslot field on onCreate under the hub panel", () => {
    const op = makeStampDateTimeSlotOp({ userId: "u", gridId: "g", timeslotFieldId: "TS", hubPanelModuleId: "HUB" });
    expect(op.triggerObjects[0]).toMatchObject({ eventType: "onCreate", targetId: "HUB" });
    expect(JSON.stringify(op.pipeline)).toContain("TS");
  });
  // 2026-07-29: the ungated stamp wrote the destination CONTAINER'S LABEL into a
  // select of 48 time labels, so a drop onto the Schedule Canvas / Table / Due
  // stamped that page's NAME as the "time".
  it("Stamp op GATES the timeslot write on the destination being a slot, and clears it otherwise", () => {
    const op = makeStampDateTimeSlotOp({
      userId: "u", gridId: "g", timeslotFieldId: "TS", hubPanelModuleId: "HUB", scheduleFormatFieldId: "SF",
    });
    // Resolves the destination container off the trigger...
    const s = JSON.stringify(op.pipeline);
    expect(s).toContain("$trigger.containerId");
    // ...and the label write now lives inside an if on scheduleFormat IS "slot".
    const gate = op.pipeline.steps.find(st => st.type === "if");
    expect(gate).toBeTruthy();
    expect(gate.condition.rules[0]).toMatchObject({
      left: "$destContainer.fields.SF.value", comparator: "IS", right: "slot",
    });
    expect(JSON.stringify(gate.then)).toContain("$trigger.containerLabel");
    // The ELSE clears it — a COPY carries the source's fields, so a slotted item
    // copied onto a canvas must not keep a slot it no longer sits in.
    const els = JSON.stringify(gate.else);
    expect(els).toContain(`"path":"$item.fields.TS.value"`);
    expect(els).toContain(`"value":null`);
    // The label must NEVER be written outside the gate.
    const outsideGate = op.pipeline.steps.filter(st => st.type !== "if");
    expect(JSON.stringify(outsideGate)).not.toContain("$trigger.containerLabel");
  });
  it("Stamp op without a scheduleFormat field keeps the ungated stamp (test grid stays byte-identical)", () => {
    const op = makeStampDateTimeSlotOp({ userId: "u", gridId: "g", timeslotFieldId: "TS", hubPanelModuleId: "HUB" });
    expect(op.pipeline.steps.some(st => st.type === "if")).toBe(false);
    expect(JSON.stringify(op.pipeline)).toContain("$trigger.containerLabel");
  });
  it("Day Page: Build is named correctly, priority-1, embeds the folder + hub params", () => {
    const op = makeDayPageBuildOp({ userId: "u", gridId: "g", dateFieldId: "DF", dayPagesFolderId: "DPF", hubPanelOccIdVar: "HUBOCC", goalsPageOccId: "GP", schedulePageOccId: "SP", dayPageTemplateOccId: "TPL" });
    expect(op.name).toBe("Day Page: Build");
    expect(op.triggerObjects.every(t => t.priority === 1)).toBe(true);
    const s = JSON.stringify(op.pipeline);
    expect(s).toContain("DPF");
    expect(s).toContain("HUBOCC");
  });
  it("Day Page: Build binds its template by id — NEVER by meta.templateName", () => {
    // APPLY_TEMPLATE copies meta onto the clone, so a templateName FIND matches
    // every day page ever built; the multi-match array then breaks the apply.
    const op = makeDayPageBuildOp({ userId: "u", gridId: "g", dateFieldId: "DF", dayPagesFolderId: "DPF", hubPanelOccIdVar: "HUBOCC", goalsPageOccId: "GP", schedulePageOccId: "SP", dayPageTemplateOccId: "TPL" });
    const s = JSON.stringify(op.pipeline);
    expect(s).toContain("$allItemsById.TPL");
    expect(s).not.toContain("meta.templateName");
  });
  it("Day Page: Build refuses to build without a template id", () => {
    expect(() => makeDayPageBuildOp({ userId: "u", gridId: "g", dateFieldId: "DF", dayPagesFolderId: "DPF", hubPanelOccIdVar: "HUBOCC", goalsPageOccId: "GP", schedulePageOccId: "SP" }))
      .toThrow(/dayPageTemplateOccId required/);
  });
  it("Day Page: Build links the day-column's Todo container in — and skips it without the field ids", () => {
    const withLink = makeDayPageBuildOp({
      userId: "u", gridId: "g", dateFieldId: "DF", dayPagesFolderId: "DPF", hubPanelOccIdVar: "HUBOCC",
      goalsPageOccId: "GP", schedulePageOccId: "SP", dayPageTemplateOccId: "TPL",
      timeslotFieldId: "TS", scheduleFormatFieldId: "SF",
    });
    const s = JSON.stringify(withLink.pipeline);
    // Finds the day-col, then its Todo by the Time Slot identity MARKER.
    expect(s).toContain("fields.SF.value");
    expect(s).toContain('"right":"day-col"');
    expect(s).toContain('"left":"fields.TS.value","comparator":"IS","right":"Todo"');
    // Links it BOTH ways: child list + textmap embed (a doc page renders only
    // its textmap, so the child list alone would leave Todo invisible).
    expect(s).toContain("ADD_CHILD");
    expect(s).toContain("$dayPage.textmap");

    const without = makeDayPageBuildOp({
      userId: "u", gridId: "g", dateFieldId: "DF", dayPagesFolderId: "DPF", hubPanelOccIdVar: "HUBOCC",
      goalsPageOccId: "GP", schedulePageOccId: "SP", dayPageTemplateOccId: "TPL",
    });
    expect(JSON.stringify(without.pipeline)).not.toContain("$todoId");
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

  // ── 2026-07-11 policy: complete AND in the schedule ──
  function flat(stepsArr) {
    const out = [];
    for (const step of stepsArr || []) {
      out.push(step);
      if (step.body) out.push(...flat(step.body));
      if (step.then) out.push(...flat(step.then));
      if (step.else) out.push(...flat(step.else));
    }
    return out;
  }
  function loopRules(op) {
    // every AND-condition rule list of an if directly inside a $allItems loop
    return flat(op.pipeline.steps)
      .filter(s => s.type === "loop" && s.overExpr === "$allItems")
      .flatMap(l => (l.body || []).filter(b => b.type === "if").map(b => b.condition.rules));
  }

  it("accountRef trackers ALSO scope to the schedule page (toolkit items never count)", () => {
    const op = makeTrackerOp({
      ...base, name: "Tracker: Balance", goalLabel: "Bank", goalFieldId: "B",
      incomeFieldId: "INC", spentFieldId: "SPN", agg: "net", timeFilter: "daily",
      accountRefFieldId: "AR", accountOccurrenceId: "acct-1",
    });
    for (const rules of loopRules(op)) {
      const s = JSON.stringify(rules);
      expect(s).toContain("acct-1");                     // accountRef narrows…
      expect(s).toContain("HAS_ANCESTOR");               // …AND schedule scope applies
      expect(s).toContain("$scopePageId");
    }
  });

  it("completion gate is the OR-form: completed IS true OR the module never BINDS Completed", () => {
    const op = makeTrackerOp({ ...base, name: "Tracker: Water", goalLabel: "P", goalFieldId: "TW", sourceFieldId: "WF", agg: "sum", timeFilter: "daily" });
    const gates = loopRules(op).flatMap(rules =>
      rules.filter(r => r.operator === "OR" && JSON.stringify(r).includes("fields.CF.value")));
    expect(gates.length).toBeGreaterThanOrEqual(1);
    const s = JSON.stringify(gates[0]);
    expect(s).toContain("\"comparator\":\"IS\"");
    // Binding-based discriminator: a bound-but-unchecked Completed reads as
    // empty and must NOT count, so the fallback checks _boundFieldIds, never
    // the stored value.
    expect(s).toContain("_boundFieldIds");
    expect(s).toContain("\"comparator\":\"ARRAY_NOT_INCLUDES\"");
    expect(s).not.toContain("IS_EMPTY");
  });

  it("countTrue stays STRICT: completed IS true only (no unbound fallback)", () => {
    const op = makeTrackerOp({ ...base, name: "Tracker: Tasks", goalLabel: "P", goalFieldId: "TC", agg: "countTrue", timeFilter: "daily" });
    for (const rules of loopRules(op)) {
      const s = JSON.stringify(rules);
      expect(s).toContain("fields.CF.value");
      expect(s).not.toContain("_boundFieldIds");
    }
  });

  it("net loops gate on completion (a transaction moves the balance only once completed)", () => {
    const op = makeTrackerOp({
      ...base, name: "Tracker: Net", goalLabel: "Bank", goalFieldId: "NB",
      incomeFieldId: "INC", spentFieldId: "SPN", agg: "net", timeFilter: "daily",
    });
    for (const rules of loopRules(op)) {
      expect(JSON.stringify(rules)).toContain("fields.CF.value");
    }
  });

  it("supportsReplace: base scan reads flow:replace entries; value loops skip them + only count on/after the base date", () => {
    const op = makeTrackerOp({
      ...base, name: "Tracker: Balance", goalLabel: "Bank", goalFieldId: "B",
      incomeFieldId: "INC", spentFieldId: "SPN", agg: "net", timeFilter: "daily",
      accountRefFieldId: "AR", accountOccurrenceId: "acct-1", supportsReplace: true,
    });
    const s = JSON.stringify(op.pipeline);
    expect(s).toContain("$baseDate");
    expect(s).toContain("\"right\":\"replace\"");        // base scan: flow IS replace
    expect(s).toContain("\"comparator\":\"IS_NOT\"");    // value loops: flow IS_NOT replace
    expect(s).toContain("DATE_AFTER");
    expect(s).toContain("SAME_DAY");                     // start-of-day semantic
    // without the flag, none of the replace machinery is emitted
    const plain = makeTrackerOp({
      ...base, name: "Tracker: Balance", goalLabel: "Bank", goalFieldId: "B",
      incomeFieldId: "INC", spentFieldId: "SPN", agg: "net", timeFilter: "daily",
    });
    expect(JSON.stringify(plain.pipeline)).not.toContain("$baseDate");
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

describe("trackers fire on instance drops + carry no task-concept rules (2026-07-07 fixes)", () => {
  const base = {
    userId: "u", gridId: "g",
    dateFieldId: "DF", completedFieldId: "CF",
    scopePageLabel: "Schedule", goalOccurrenceId: "GOAL1", schedPageOccId: "SCHED1",
  };

  it("makeTrackerOp triggers include instance-role onAdd + onDelete (drops must re-aggregate)", () => {
    const op = makeTrackerOp({ ...base, name: "Completed", goalLabel: "x", goalFieldId: "TC", agg: "countTrue", timeFilter: "daily" });
    const roles = (ev) => op.triggerObjects.filter(t => t.eventType === ev).map(t => t.subjectRole);
    expect(roles("onAdd")).toContain("instance");
    expect(roles("onDelete")).toContain("instance");
  });

  it("makeTrackerOp accepts no isTaskFieldId and emits no is-task rule", () => {
    const op = makeTrackerOp({ ...base, name: "Completed", goalLabel: "x", goalFieldId: "TC", agg: "countTrue", timeFilter: "daily", isTaskFieldId: "ITF" });
    expect(JSON.stringify(op.pipeline)).not.toContain("ITF");
  });

  it("makeTrackerOp presenceFieldId gates the loop on field presence (data-driven discriminator)", () => {
    const op = makeTrackerOp({ ...base, name: "Pomodoros Today", goalLabel: "x", goalFieldId: "PC", agg: "countTrue", timeFilter: "daily", presenceFieldId: "PNUM" });
    const s = JSON.stringify(op.pipeline);
    expect(s).toContain('"$item.fields.PNUM.value"');
    expect(s).toContain("IS_NOT_EMPTY");
  });

  it("makeDayPageBuildTasksCompletedOp emits no is-task rule", () => {
    const op = makeDayPageBuildTasksCompletedOp({ userId: "u", gridId: "g", dateFieldId: "DF", completedFieldId: "CF", isTaskFieldId: "ITF" });
    expect(JSON.stringify(op.pipeline)).not.toContain("ITF");
  });

  it("buildDailyRoutineTemplate ignores isTaskFieldId (no task-marker stamping)", async () => {
    const occs = [];
    const mods = [];
    const mkOcc = async (o) => { occs.push(o); return o.id; };
    class FakeModule { constructor(d) { this.d = d; } async save() { mods.push(this.d); } }
    await buildDailyRoutineTemplate({
      userId: "u", gridId: "g",
      timeSlots: [{ label: "6:00am" }],
      timeslotFieldId: "TSF",
      routineBySlot: { "6:00am": [{ sourceModId: null, label: "Drink Water" }] },
      tplManifestRootFolderId: "F",
      mkOcc, Module: FakeModule, findModule: async () => null,
      completedFieldId: "CF", waterFieldId: "WF", isTaskFieldId: "ITF",
    });
    expect(JSON.stringify(occs)).not.toContain("ITF");
  });
});

describe("makeAlarmOp schedule-insert steps", () => {
  it("with sched, appends the Schedule day-col + slot resolution + de-dup CREATE (timeslot field)", async () => {
    const { makeAlarmOp } = await import("../utils/liveSystemBuilders.js");
    const sched = { dateFieldId: "DF", timeslotFieldId: "TF", scheduleFormatFieldId: "SF", pageOccurrenceId: "PAGE" };
    const op = makeAlarmOp({ userId: "u", gridId: "g", label: "5 PM", time: "17:00", sched });
    expect(op.alarm.sched).toEqual(sched);
    const raw = JSON.stringify(op.pipeline);
    // NOTIFY + schedule insert.
    expect(op.pipeline.steps.length).toBeGreaterThan(1);
    // Day-col resolved by scheduleFormat + today; slot + de-dup match on the TIMESLOT field.
    expect(raw).toContain('"fields.SF.value"');
    expect(raw).toContain('"fields.TF.value"');
    expect(raw).toContain('"5:00pm"');
    // CREATE stamps date + timeslot on the alarm instance.
    expect(raw).toContain('"CREATE"');
    expect(raw).toContain('"⏰ 5 PM"');
    // The destination page is resolved by ID — never by the name "Schedule".
    expect(raw).toContain('"PAGE"');
    expect(raw).not.toContain('"Schedule"');
  });

  it("off-slot minutes (e.g. :15) still stamp the exact timeslot label and skip the slot FIND", async () => {
    const { makeAlarmOp } = await import("../utils/liveSystemBuilders.js");
    const op = makeAlarmOp({ userId: "u", gridId: "g", label: "X", time: "17:15",
      sched: { dateFieldId: "DF", timeslotFieldId: "TF", scheduleFormatFieldId: "SF", pageOccurrenceId: "PAGE" } });
    const raw = JSON.stringify(op.pipeline);
    expect(raw).toContain('"5:15pm"');
    // No exact half-hour slot to match → only the day-col + de-dup FINDs (one $allContainers FIND).
    expect((raw.match(/"\$allContainers"/g) || []).length).toBe(1);
  });

  it("without a destination page id, the schedule steps are skipped entirely", async () => {
    const { makeAlarmOp } = await import("../utils/liveSystemBuilders.js");
    const op = makeAlarmOp({ userId: "u", gridId: "g", label: "5 PM", time: "17:00",
      sched: { dateFieldId: "DF", timeslotFieldId: "TF", scheduleFormatFieldId: "SF" } });
    expect(op.pipeline.steps).toHaveLength(1);   // the NOTIFY only
  });

  it("without sched, the pipeline is a bare NOTIFY", async () => {
    const { makeAlarmOp } = await import("../utils/liveSystemBuilders.js");
    const op = makeAlarmOp({ userId: "u", gridId: "g", label: "5 PM", time: "17:00" });
    expect(op.pipeline.steps).toHaveLength(1);
    expect(op.alarm.sched).toBeUndefined();
  });
});

describe("makeMediaHistoryOp", () => {
  // Movies Watched / Books Read / Podcasts Listened were three hand-written
  // Operation literals with an identical 19-node pipeline — ~12KB of duplicated
  // JSON, which is exactly why their trigger surfaces had drifted apart. The
  // extraction was verified against the seed export as a byte-for-byte no-op
  // (modulo per-reseed ids); these lock the shape it emits.
  const base = {
    uid: (() => { let n = 0; return () => `id${n++}`; })(),
    userId: "u1", gridId: "g1",
    name: "Movies Watched", description: "d",
    goalOccurrenceId: "goalOcc", schedulePageOccId: "schedOcc",
    sourceTemplateId: "tplWatch", pickFieldId: "fPick",
    rowsFieldId: "fRows", lastTitleFieldId: "fLast", triggerFieldId: "fPick",
    dateFieldId: "fDate", timeslotFieldId: "fSlot",
  };

  it("binds the goal and schedule page picker-direct, never by label", () => {
    const op = makeMediaHistoryOp(base);
    const json = JSON.stringify(op.pipeline);
    expect(json).toContain("$allItemsById.goalOcc");
    expect(json).toContain("$allItemsById.schedOcc");
    // FIND-by-label is the pattern this codebase moved OFF (2026-05-22) — a
    // label match picks the wrong occurrence as soon as one is duplicated.
    expect(json).not.toContain('"label", comparator: "IS"');
  });

  it("scopes the source loop to the Schedule page and excludes feed copies", () => {
    const rules = makeMediaHistoryOp(base).pipeline.steps[6].then[2].body[0].condition.rules;
    expect(rules.map(r => r.comparator)).toEqual(
      expect.arrayContaining(["DATE_IN_PERIOD", "HAS_ANCESTOR", "IS_EMPTY", "IS"]));
    // Feed copies carry their source's fields; counting them double-counts.
    expect(rules.find(r => r.left.endsWith("meta.feedSourceId")).comparator).toBe("IS_EMPTY");
  });

  it("names every loop variable from the prefix by default", () => {
    const op = makeMediaHistoryOp({ ...base, varPrefix: "movie" });
    const json = JSON.stringify(op.pipeline);
    expect(json).toContain("$movieInst");
    expect(json).toContain("$movieOccId");
  });

  it("honours explicit var names — that is what made the extraction byte-exact", () => {
    const op = makeMediaHistoryOp({ ...base, instVar: "$watchInst", itemVar: "$movie" });
    const json = JSON.stringify(op.pipeline);
    expect(json).toContain("$watchInst");
    expect(json).toContain("$movie.label");
  });

  it("places row extras in the requested SLOT so key order is preserved", () => {
    const op = makeMediaHistoryOp({
      ...base,
      rowBeforeLabel: { poster: "P" },
      rowAfterLabel: { pages: "G" },
    });
    const push = op.pipeline.steps[6].then[2].body[0].then[0].body[1].then[0];
    expect(Object.keys(push.cfg.value)).toEqual(["poster", "label", "pages", "timeslot", "date"]);
  });

  it("emits the full trigger surface, including the onChange field", () => {
    const op = makeMediaHistoryOp(base);
    expect(op.triggerTypes).toEqual(["onChange", "onAdd", "onDelete", "onFilterChange", "onLoad"]);
    expect(op.triggerObjects[0]).toMatchObject({ eventType: "onChange", targetId: "fPick" });
    // The drift this extraction removes: all three now get the same surface.
    expect(op.triggerObjects).toHaveLength(7);
  });
});
