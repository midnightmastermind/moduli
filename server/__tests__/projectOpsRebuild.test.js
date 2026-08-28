/**
 * 0274 — the two project ops that could never fire.
 *
 * The pure halves of the migration (which template, which field) plus the two
 * builder contracts the migration regenerates from. Both builders had never
 * been under test, which is part of why the defects survived: `Project: Create`
 * resolved its template by a marker `0035` retired, and `Sync To Todo List`
 * lived inline in the seed where nothing could import it.
 */
import { describe, it, expect } from "vitest";
import { findProjectTemplate, resolveField, shapeOf } from "../migrations/0274-project-ops-that-could-never-fire.mjs";
import { makeProjectCreateOp, makeProjectSyncToTodoOp } from "../utils/liveSystemBuilders.js";

const page = (id, label) => ({ id, moduleId: `m-${id}`, label });
const mods = (...ids) => Object.fromEntries(ids.map(id => [`m-${id}`, { role: "page" }]));

describe("findProjectTemplate — the unreplaced token IS the marker", () => {
  it("finds the template by its {ProjectName} token", () => {
    const occs = [page("tpl", "Project: {ProjectName}"), page("live", "Project: Moduli v1 Launch")];
    expect(findProjectTemplate(occs, mods("tpl", "live"))).toEqual({ id: "tpl" });
  });

  // THE DISCRIMINATING CASE. APPLY_TEMPLATE copies meta onto every clone, so a
  // meta marker matches the clones too and a multi-match FIND binds an ARRAY
  // that APPLY_TEMPLATE cannot use — the defect this replaces. A clone cannot
  // carry the token, because the token is what APPLY_TEMPLATE replaced.
  it("ignores clones however many there are", () => {
    const occs = [
      page("tpl", "Project: {ProjectName}"),
      page("a", "Project: Via Fluere"),
      page("b", "Project: Paul's Clown Website"),
      page("c", "Project: Moduli v1 Launch"),
    ];
    expect(findProjectTemplate(occs, mods("tpl", "a", "b", "c"))).toEqual({ id: "tpl" });
  });

  it("refuses rather than guessing when two templates carry the token", () => {
    const occs = [page("t1", "Project: {ProjectName}"), page("t2", "Old: {ProjectName}")];
    const r = findProjectTemplate(occs, mods("t1", "t2"));
    expect(r.id).toBeUndefined();
    expect(r.error).toMatch(/ambiguous/i);
  });

  it("refuses when the template is missing entirely", () => {
    expect(findProjectTemplate([page("live", "Project: Via Fluere")], mods("live")).error).toMatch(/missing/i);
  });

  it("only considers PAGE occurrences — a container carrying the token is not the template", () => {
    const occs = [page("c", "Project: {ProjectName}")];
    const r = findProjectTemplate(occs, { "m-c": { role: "container" } });
    expect(r.error).toMatch(/missing/i);
  });

  it("reads the MODULE label when the occurrence has none", () => {
    const occs = [{ id: "tpl", moduleId: "m-tpl", label: null }];
    expect(findProjectTemplate(occs, { "m-tpl": { role: "page", label: "Project: {ProjectName}" } })).toEqual({ id: "tpl" });
  });
});

describe("resolveField — name AND type, because this grid has duplicate field names", () => {
  const fields = [
    { id: "due-num",  name: "Due", type: "number" },   // the display tile
    { id: "due-date", name: "Due", type: "date" },     // the real one
    { id: "status",   name: "Status", type: "select" },
  ];
  it("picks the one matching BOTH", () => {
    expect(resolveField(fields, "Due", "date")).toEqual({ id: "due-date" });
    expect(resolveField(fields, "Due", "number")).toEqual({ id: "due-num" });
  });
  it("refuses on a miss", () => {
    expect(resolveField(fields, "Due", "select").error).toMatch(/no select field/i);
  });
  it("refuses rather than picking the first when two share name AND type", () => {
    const dup = [...fields, { id: "status2", name: "Status", type: "select" }];
    expect(resolveField(dup, "Status", "select").error).toMatch(/ambiguous/i);
  });
});

describe("makeProjectCreateOp", () => {
  const build = () => makeProjectCreateOp({ userId: "u", gridId: "g", projectsFolderId: "PF", projectTemplateOccId: "TPL" });

  it("resolves the template PICKER-DIRECT, never by meta.templateName", () => {
    const j = JSON.stringify(build());
    expect(j).toContain("$allItemsById.TPL");
    // `0035` retired this key. A pipeline naming it is the defect.
    expect(j).not.toContain("templateName");
  });

  // Fixing the lookup WITHOUT this would wake a 25-day-dormant onLoad op that
  // mints a page nobody asked for on the next load.
  it("is manual only — no onLoad arm, no onLoad trigger, no hardcoded demo project", () => {
    const op = build();
    expect(op.triggerObjects).toEqual([]);
    expect(op.triggerTypes).toEqual(["manual"]);
    const j = JSON.stringify(op);
    expect(j).not.toContain("onLoad");
    expect(j).not.toContain("Moduli v1 Launch");
  });

  it("still prompts for name and scope, and still mints into the Projects folder", () => {
    const j = JSON.stringify(build());
    expect(j).toContain("What's the project name?");
    expect(j).toContain("APPLY_TEMPLATE");
    expect(j).toContain('"rootParent":"PF"');
    expect(j).toContain("{ProjectName}");
  });

  it("keeps the idempotency-by-label gate — a re-run must not mint a second page", () => {
    expect(JSON.stringify(build())).toContain("$existingProjectPageId");
  });

  it("REFUSES to build without a template id rather than emitting a dead FIND", () => {
    expect(() => makeProjectCreateOp({ userId: "u", gridId: "g", projectsFolderId: "PF" })).toThrow(/projectTemplateOccId/);
  });
});

describe("makeProjectSyncToTodoOp — the mirror lands per project", () => {
  const build = () => makeProjectSyncToTodoOp({
    userId: "u", gridId: "g",
    statusFieldId: "S", projectFieldId: "P",
    tasksPageOccId: "TASKS", fallbackContainerOccId: "OCCUPATIONAL",
  });

  it("finds the destination by the container's Project VALUE, not its label", () => {
    const j = JSON.stringify(build());
    expect(j).toContain("fields.P.value");
    expect(j).toContain('"right":"$projKey"');
    // A label match is one rename from wrong — the SCHEDULE_LABEL_PREFIX lesson.
    expect(j).not.toContain('"comparator":"IS","right":"Paul');
  });

  it("scopes the destination to the Tasks page", () => {
    expect(JSON.stringify(build())).toContain('"comparator":"HAS_ANCESTOR","right":"TASKS"');
  });

  // FAILS OPEN: a task naming no project still gets its mirror. Dropping it
  // instead reads as the sync silently breaking.
  it("falls back to the given container when the task names no project", () => {
    expect(JSON.stringify(build())).toContain("literal:OCCUPATIONAL");
  });

  // MOVE_OCCURRENCE reads `toContainerId` RAW and only resolves
  // `toContainerIdExpr` — so the raw key with a $var in it is a silent no-op.
  it("moves the mirror through toContainerIdExpr, never the raw key", () => {
    const j = JSON.stringify(build());
    expect(j).toContain('"toContainerIdExpr":"$mirrorParent"');
    expect(j).not.toContain('"toContainerId":');
  });

  it("COPY_LINKs into the resolved parent", () => {
    expect(JSON.stringify(build())).toContain('"parent":"$mirrorParent"');
  });

  it("still deletes the mirror once Status leaves Backburner/Docket", () => {
    const j = JSON.stringify(build());
    expect(j).toContain('"type":"DELETE"');
    expect(j).toContain('"comparator":"IS_NOT","right":"Backburner"');
    expect(j).toContain('"comparator":"IS_NOT","right":"Docket"');
  });

  it("triggers on the Status field and nothing else", () => {
    const op = build();
    expect(op.triggerObjects).toHaveLength(1);
    expect(op.triggerObjects[0]).toMatchObject({ eventType: "onChange", subjectType: "field", targetId: "S" });
  });

  it("REFUSES to build without each id it needs", () => {
    const full = { userId: "u", gridId: "g", statusFieldId: "S", projectFieldId: "P", tasksPageOccId: "T", fallbackContainerOccId: "F" };
    for (const k of ["statusFieldId", "projectFieldId", "tasksPageOccId", "fallbackContainerOccId"]) {
      expect(() => makeProjectSyncToTodoOp({ ...full, [k]: undefined })).toThrow(new RegExp(k));
    }
  });
});

describe("shapeOf — what makes 'already converged' mean something", () => {
  const build = () => makeProjectCreateOp({ userId: "u", gridId: "g", projectsFolderId: "PF", projectTemplateOccId: "TPL" });

  // The builders mint a fresh uid() per step on every call. Without stripping
  // ids the migration reports a rewrite on every run and churns every step id.
  it("two builds of the same op compare EQUAL despite fresh step ids", () => {
    const a = build(), b = build();
    expect(JSON.stringify(a.pipeline)).not.toBe(JSON.stringify(b.pipeline)); // ids differ — the premise
    expect(shapeOf(a)).toBe(shapeOf(b));
  });

  it("but a REAL difference still shows — the control", () => {
    const a = build();
    const b = makeProjectCreateOp({ userId: "u", gridId: "g", projectsFolderId: "OTHER", projectTemplateOccId: "TPL" });
    expect(shapeOf(a)).not.toBe(shapeOf(b));
  });

  it("a changed trigger surface shows", () => {
    const a = build();
    const b = { ...build(), triggerObjects: [{ eventType: "onLoad", subjectType: "grid", targetId: "", priority: 5 }] };
    expect(shapeOf(a)).not.toBe(shapeOf(b));
  });

  it("ignores Mongo's _id too — a lean doc carries one and a fresh build does not", () => {
    const a = build();
    expect(shapeOf({ ...a, _id: "abc" })).toBe(shapeOf(a));
  });
});

/**
 * THE CLASS GUARD. A FIND rule's `left` is a RECORD PATH — it is NOT evaluated
 * against `$vars`. A `$var` there looks for a record key of that literal name,
 * matches nothing, and empties the whole FIND while every log line still reads
 * correctly. It cost two silently-broken behaviours in `Sync To Todo List`
 * (`0276`), one of them present from the day the op was written.
 *
 * A `$var` on the RIGHT is fine and is used everywhere — which is exactly what
 * makes the mistake easy to make.
 */
describe("no $var may sit on the LEFT of a FIND rule", () => {
  const findRuleLefts = (node, out = []) => {
    if (Array.isArray(node)) { node.forEach(n => findRuleLefts(n, out)); return out; }
    if (!node || typeof node !== "object") return out;
    if (node.type === "FIND" && node.predicate) {
      const walk = (g) => {
        for (const r of g?.rules || []) {
          if (r.rules) walk(r);
          else if (typeof r.left === "string" && r.left.startsWith("$")) out.push(r.left);
        }
      };
      walk(node.predicate);
    }
    Object.values(node).forEach(v => findRuleLefts(v, out));
    return out;
  };

  it("Project: Sync To Todo List has none", () => {
    const op = makeProjectSyncToTodoOp({
      userId: "u", gridId: "g", statusFieldId: "S", projectFieldId: "P",
      tasksPageOccId: "T", fallbackContainerOccId: "F",
    });
    expect(findRuleLefts(op.pipeline)).toEqual([]);
  });

  it("Project: Create has none", () => {
    const op = makeProjectCreateOp({ userId: "u", gridId: "g", projectsFolderId: "PF", projectTemplateOccId: "TPL" });
    expect(findRuleLefts(op.pipeline)).toEqual([]);
  });

  // THE CONTROL. Without it, a walker that simply never finds anything passes
  // both assertions above and proves nothing — the 2026-08-01 (16) trap.
  it("the walker DOES find one when it is there", () => {
    const planted = { pipeline: { steps: [{ type: "action", config: {
      type: "FIND", over: "$allContainers",
      predicate: { operator: "AND", rules: [
        { left: "id", comparator: "IS", right: "$x" },
        { left: "$x", comparator: "IS_NOT_EMPTY", right: "" },
      ]},
    }}]}};
    expect(findRuleLefts(planted.pipeline)).toEqual(["$x"]);
  });

  it("and finds one NESTED in a sub-group", () => {
    const planted = { pipeline: { steps: [{ type: "action", config: {
      type: "FIND",
      predicate: { operator: "AND", rules: [
        { operator: "OR", rules: [{ left: "$deep", comparator: "IS_NOT_EMPTY", right: "" }] },
      ]},
    }}]}};
    expect(findRuleLefts(planted.pipeline)).toEqual(["$deep"]);
  });

  // A $var on the RIGHT is legal and used throughout — this must NOT flag it.
  it("does not flag a $var on the RIGHT", () => {
    const ok = { pipeline: { steps: [{ type: "action", config: {
      type: "FIND", predicate: { operator: "AND", rules: [{ left: "id", comparator: "IS", right: "$taskId" }] },
    }}]}};
    expect(findRuleLefts(ok.pipeline)).toEqual([]);
  });

  // And an IF condition is where such a guard BELONGS — never flagged.
  it("does not flag a $var on an IF condition's left", () => {
    const op = makeProjectSyncToTodoOp({
      userId: "u", gridId: "g", statusFieldId: "S", projectFieldId: "P",
      tasksPageOccId: "T", fallbackContainerOccId: "F",
    });
    const ifLefts = JSON.stringify(op.pipeline).match(/"left":"\$(lgId|projKey)"/g) || [];
    expect(ifLefts.length, "the guards must still exist, just in an IF").toBeGreaterThan(0);
  });
});
