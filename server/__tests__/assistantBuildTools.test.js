import { describe, it, expect } from "vitest";
import {
  findFolder, pickDestination, findFieldByName, coerceValue, parseDuration, parseDay,
  predicateTags, filterEntryFor, bindingsFor, selectMetaFor, buildToolPack, asList, expandRepeats,
} from "../services/assistantBuildTools.js";

describe("name resolution", () => {
  const folders = [
    { id: "root", name: "Root", parentId: null },
    { id: "intf", name: "Interfaces", parentId: "root" },
    { id: "lib", name: "Library", parentId: "root" },
    { id: "ref", name: "Reading", parentId: "lib" },
  ];
  it("finds a folder by name and by path", () => {
    expect(findFolder(folders, "interfaces").folder.id).toBe("intf");
    expect(findFolder(folders, "Library/Reading").folder.id).toBe("ref");
    expect(findFolder(folders, "Nope").error).toMatch(/no folder/);
  });
  it("picks a container by path, preferring a container over a same-named page", () => {
    const hits = [
      { id: "a", label: "Appointments", crumb: "Tasks", role: "container" },
      { id: "b", label: "Appointments", crumb: "Boards › Social", role: "container" },
      { id: "p", label: "Tasks", crumb: "", role: "page" },
      { id: "c", label: "Tasks", crumb: "Interfaces", role: "container" },
    ];
    expect(pickDestination(hits, "Tasks › Appointments").destination.id).toBe("a");
    expect(pickDestination(hits, "Appointments").error).toMatch(/matches 2/);
    expect(pickDestination(hits, "Tasks").destination.id).toBe("c");
    // what llama3.2 3B actually wrote for "Tasks › Appointments" (2026-11-02)
    expect(pickDestination(hits, "Tasks … Appointments").destination?.id).toBe("a");
    expect(pickDestination(hits, "Tasks» Appointments").destination?.id).toBe("a");
  });
  it("a field name must be exact", () => {
    const fs = [{ id: "1", name: "Date" }, { id: "2", name: "Date Added" }];
    expect(findFieldByName(fs, "date").field.id).toBe("1");
    expect(findFieldByName(fs, "Dat").error).toBeTruthy();
  });
});

describe("values", () => {
  it("durations and days", () => {
    expect(parseDuration("4h")).toBe(240);
    expect(parseDuration("1h 30m")).toBe(90);
    expect(parseDuration(240)).toBe(240);
    expect(parseDay("2026-11-2")).toBe("2026-11-02");
    expect(parseDay("Nov 30 2026")).toBe("2026-11-30");
  });
  it("a select value must be one of its options, stored as the option's value", () => {
    const f = { name: "Time Slot", type: "select", meta: selectMetaFor(["4:00pm", "4:30pm"]) };
    expect(coerceValue(f, "4:00PM").value).toBe("4:00pm");
    expect(coerceValue(f, "4:15pm").error).toMatch(/not one of/);
    const multi = { name: "T", type: "select", meta: selectMetaFor(["a", "b"], { multiSelect: true }) };
    expect(coerceValue(multi, "a").value).toEqual(["a"]);
  });
  it("the option query's literal tags", () => {
    const f = { meta: { optionsSource: { mode: "find", predicate: { rules: [
      { left: "fields.BC.value", comparator: "CONTAINS", right: "appointment" },
      { left: "meta.feedSourceId", comparator: "IS_EMPTY", right: "" },
      { left: "fields.X.value", comparator: "IS", right: "$this.fields.Y.value" },
    ] } } } };
    expect(predicateTags(f)).toEqual([{ fieldId: "BC", value: "appointment" }]);
  });
  it("a filter entry: nothing set, nav showing, options from the field", () => {
    // The Filter menu's own shape: NO condition, so the client turns it into "field IS the picks" and it hides rows.
    // The old shape (a $nav condition with hides:false) was skipped by getLocalFilterConditions, so clicking a value
    // filtered nothing (user 2026-11-02, Quick Links).
    const e = filterEntryFor({ id: "F", type: "select", meta: selectMetaFor(["social", "media"]) }, "x");
    expect(e).toEqual({ id: "x", fieldId: "F", active: true, showNav: true, condition: null });
    const d = filterEntryFor({ id: "D", type: "date" }, "y");
    expect(d).toMatchObject({ condition: null, timeUnit: "day", defaultNavValue: "today" });
    expect(d.hides).toBeUndefined();
  });
  it("bindings keep the siblings', un-hide what is set, add what is missing", () => {
    const b = bindingsFor([{ _id: "x", fieldId: "A", order: 0, hidden: true }, { fieldId: "M", order: 98, hidden: true, role: "media" }], ["A", "N"]);
    expect(b).toEqual([
      { fieldId: "A", order: 0, hidden: false },
      { fieldId: "M", order: 98, hidden: true, role: "media" },
      { fieldId: "N", order: 99, hidden: false, role: "input" },
    ]);
  });
});

// A fake /api/v1 holding the CPS case: Appointments with one row, a Schedule
// Type field whose options live in a Schedule Types container that has no "Class".
function fakeApi() {
  const fields = [
    { id: "BC", name: "Board Category", type: "select", meta: { multiSelect: true } },
    { id: "D", name: "Date", type: "date" },
    { id: "TS", name: "Time Slot", type: "select", meta: selectMetaFor(["4:00pm"]) },
    { id: "DU", name: "Duration", type: "duration" },
    { id: "ST", name: "Schedule Type", type: "occurrence", meta: { optionsSource: { mode: "find",
      predicate: { rules: [{ left: "fields.BC.value", comparator: "CONTAINS", right: "appointment" }] },
      addNew: { parentOccurrenceId: "types" } } } },
  ];
  const modules = new Map([
    ["mAppt", { id: "mAppt", label: "Dentist cleaning", fieldBindings: [{ fieldId: "D", order: 0 }, { fieldId: "ST", order: 1 }] }],
    ["mDoc", { id: "mDoc", label: "Doctor", fieldBindings: [{ fieldId: "BC", order: 0, hidden: true }] }],
  ]);
  const occs = [
    { id: "row1", moduleId: "mAppt", parentId: "appts" },
    { id: "doc", moduleId: "mDoc", parentId: "types" },
  ];
  let n = 0; const posts = [];
  const call = async (method, path, body) => {
    const url = new URL(`http://x${path}`);
    if (method === "GET" && url.pathname === "/fields") return { status: 200, body: { fields } };
    if (method === "GET" && url.pathname === "/destinations") return { status: 200, body: { destinations: [{ id: "appts", label: "Appointments", crumb: "Tasks", role: "container" }] } };
    if (method === "GET" && url.pathname === "/occurrences") {
      const p = url.searchParams.get("parentId");
      return { status: 200, body: { occurrences: occs.filter((o) => o.parentId === p) } };
    }
    if (method === "GET" && url.pathname.startsWith("/modules/")) {
      const m = modules.get(url.pathname.split("/")[2]); return m ? { status: 200, body: { module: m } } : { status: 404, body: {} };
    }
    if (method === "GET" && url.pathname.startsWith("/occurrences/")) return { status: 404, body: {} };
    if (method === "POST" && url.pathname === "/modules") { const m = { ...body, id: `m${++n}` }; modules.set(m.id, m); posts.push(["module", m]); return { status: 201, body: { module: m } }; }
    if (method === "POST" && url.pathname === "/occurrences") { const o = { ...body, id: `o${++n}` }; occs.push(o); posts.push(["occ", o]); return { status: 201, body: { occurrence: o } }; }
    return { status: 404, body: { message: `${method} ${path}` } };
  };
  return { call, posts, occs, modules };
}

describe("create_items", () => {
  it("adds the missing 'Class' option once, tagged, and every class points at it", async () => {
    const api = fakeApi();
    const tool = buildToolPack({ call: api.call, gridId: "g" }).find((t) => t.name === "create_items");
    const days = ["2026-11-02", "2026-11-03", "2026-11-30"];
    const r = await tool.run({ container: "Tasks › Appointments", items: days.map((d) => ({
      label: "CPS Class", fields: { Date: d, "Time Slot": "4:00pm", Duration: "4h", "Schedule Type": "Class" },
    })) });
    expect(r).toMatchObject({ ok: true, created: 3, alsoAdded: ['Schedule Type option "Class"'] });

    const classOcc = api.occs.find((o) => o.parentId === "types" && o.id !== "doc");
    expect(classOcc.fields.BC.value).toEqual(["appointment"]);              // the query finds it
    expect(api.modules.get(classOcc.moduleId).label).toBe("Class");
    expect(api.modules.get(classOcc.moduleId).fieldBindings[0]).toMatchObject({ fieldId: "BC", hidden: true });

    const rows = api.occs.filter((o) => o.parentId === "appts" && o.id !== "row1");
    expect(rows.map((o) => o.fields.D.value)).toEqual(days);
    for (const o of rows) {
      expect(o.fields.ST.value).toBe(classOcc.id);
      expect(o.fields.DU.value).toBe(240);
      expect(o.fields.TS.value).toBe("4:00pm");
    }
    expect(new Set(rows.map((o) => o.moduleId)).size).toBe(1);             // one template
  });

  it("an existing option is reused, never duplicated", async () => {
    const api = fakeApi();
    const tool = buildToolPack({ call: api.call, gridId: "g" }).find((t) => t.name === "create_items");
    const r = await tool.run({ container: "Appointments", items: [{ label: "Checkup", fields: { "Schedule Type": "doctor" } }] });
    expect(r.alsoAdded).toEqual([]);
    expect(api.occs.filter((o) => o.parentId === "types")).toHaveLength(1);
    expect(api.occs.at(-1).fields.ST.value).toBe("doc");
  });

  it("a bad value is reported and that row is skipped, not guessed", async () => {
    const api = fakeApi();
    const tool = buildToolPack({ call: api.call, gridId: "g" }).find((t) => t.name === "create_items");
    const r = await tool.run({ container: "Appointments", items: [{ label: "X", fields: { "Time Slot": "4:15pm" } }] });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/not one of/);
    expect(api.posts).toHaveLength(0);
  });
});

describe("lists sent as JSON text", () => {
  it("asList parses a JSON array string and refuses anything else", () => {
    expect(asList('[{"label":"a"}]')).toEqual([{ label: "a" }]);
    expect(asList([1])).toEqual([1]);
    expect(asList("not json")).toEqual([]);
    expect(asList('{"a":1}')).toEqual([]);
    expect(asList(undefined)).toEqual([]);
  });
  it("create_items accepts items as a JSON string", async () => {
    const api = fakeApi();
    const tool = buildToolPack({ call: api.call, gridId: "g" }).find((t) => t.name === "create_items");
    const r = await tool.run({ container: "Appointments", items: JSON.stringify([{ label: "A" }, { label: "B" }]) });
    expect(r).toMatchObject({ ok: true, created: 2 });
  });
});

describe("repeating items (the model does not list dates itself)", () => {
  it("expandRepeats: Mon-Thu for November is all 17 days, none skipped", () => {
    const out = expandRepeats([{ label: "CPS Class", fields: { "Time Slot": "4:00pm" },
      repeat: { from: "2026-11-01", to: "2026-11-30", weekdays: ["Mon", "Tue", "Wed", "Thu"] } }]);
    expect(out.error).toBeUndefined();
    const days = out.items.map((i) => i.fields.Date);
    expect(days).toHaveLength(17);
    expect(days).toContain("2026-11-23");
    expect(days).toContain("2026-11-26");
    expect(out.items.every((i) => i.fields["Time Slot"] === "4:00pm" && !i.repeat)).toBe(true);
  });
  it("a Date the model also put in fields does not survive the expansion (3B does this)", () => {
    const out = expandRepeats([{ label: "X", fields: { Date: "2026-11-01" }, repeat: { from: "2026-11-01", to: "2026-11-30", weekdays: ["Mon"] } }]);
    expect(out.items.map((i) => i.fields.Date)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]);
  });
  it("a repeat sent as JSON text inside a JSON-text item list still expands", () => {
    const out = expandRepeats(asList('[{"label":"X","repeat":"{\\"from\\":\\"2026-11-02\\",\\"to\\":\\"2026-11-03\\"}"}]'));
    expect(out.items).toHaveLength(2);
  });
  it("accepts full weekday names, a custom date field, and skips 'except' days", () => {
    const out = expandRepeats([{ label: "X", repeat: { from: "2026-11-02", to: "2026-11-09", weekdays: ["monday"], dateField: "Due", except: ["2026-11-09"] } }]);
    expect(out.items.map((i) => i.fields.Due)).toEqual(["2026-11-02"]);
  });
  it("no weekdays = every day; items without repeat pass through untouched", () => {
    const out = expandRepeats([{ label: "A" }, { label: "B", repeat: { from: "2026-11-01", to: "2026-11-03" } }]);
    expect(out.items.map((i) => i.label)).toEqual(["A", "B", "B", "B"]);
  });
  it("refuses a bad range or an unknown weekday instead of guessing", () => {
    expect(expandRepeats([{ label: "X", repeat: { from: "2026-11-30", to: "2026-11-01" } }]).error).toMatch(/before/);
    expect(expandRepeats([{ label: "X", repeat: { from: "2026-11-01", to: "2026-11-30", weekdays: ["Funday"] } }]).error).toMatch(/weekday/);
    expect(expandRepeats([{ label: "X", repeat: { from: "2026-01-01", to: "2028-01-01" } }]).error).toMatch(/too many/);
  });
  it("create_items with repeat creates every date and reports them", async () => {
    const api = fakeApi();
    const tool = buildToolPack({ call: api.call, gridId: "g" }).find((t) => t.name === "create_items");
    const r = await tool.run({ container: "Appointments", items: [{ label: "CPS Class", fields: { "Time Slot": "4:00pm" },
      repeat: { from: "2026-11-01", to: "2026-11-30", weekdays: ["Mon", "Tue", "Wed", "Thu"] } }] });
    expect(r).toMatchObject({ ok: true, created: 17 });
    expect(r.dates).toHaveLength(17);
    expect(api.occs.filter((o) => o.parentId === "appts" && o.id !== "row1").map((o) => o.fields.D.value)).toContain("2026-11-24");
  });
});
