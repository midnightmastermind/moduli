/**
 * 0275 — the pure halves: token replacement, the relative Due date, and the
 * starter-task table's own invariants.
 */
import { describe, it, expect } from "vitest";
import { replaceTokens, resolveField, isoPlusDays, STARTERS, VIA_FLUERE_SCOPE, PAUL_SCOPE }
  from "../migrations/0275-two-real-projects.mjs";

const KANBAN_COLUMNS = ["Backburner", "Docket", "Working On", "In Review", "Test", "Complete"];

describe("replaceTokens — the template's tokens, everywhere they appear", () => {
  const tmap = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Project Scope — {ProjectName}" }] },
      { type: "paragraph", content: [{ type: "text", text: "{ProjectScope}" }] },
      { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Goal 1" }] }] }] },
    ],
  };
  const done = replaceTokens(tmap, { "{ProjectName}": "Via Fluere", "{ProjectScope}": "SCOPE" });

  it("replaces at every depth", () => {
    expect(done.content[0].content[0].text).toBe("Project Scope — Via Fluere");
    expect(done.content[1].content[0].text).toBe("SCOPE");
  });
  it("leaves untokened text alone — the control", () => {
    expect(done.content[2].content[0].content[0].content[0].text).toBe("Goal 1");
  });
  it("preserves node types and attrs", () => {
    expect(done.type).toBe("doc");
    expect(done.content[0].attrs).toEqual({ level: 1 });
  });
  it("does not mutate the source — the template must survive being cloned from", () => {
    expect(tmap.content[0].content[0].text).toBe("Project Scope — {ProjectName}");
  });
  it("replaces EVERY occurrence in one string, not just the first", () => {
    const n = { type: "text", text: "{ProjectName} and {ProjectName}" };
    expect(replaceTokens(n, { "{ProjectName}": "X" }).text).toBe("X and X");
  });
  it("only touches `text` keys — an attr that happens to hold the token is left alone", () => {
    const n = { type: "x", attrs: { href: "{ProjectName}" }, content: [{ type: "text", text: "{ProjectName}" }] };
    const r = replaceTokens(n, { "{ProjectName}": "X" });
    expect(r.attrs.href).toBe("{ProjectName}");
    expect(r.content[0].text).toBe("X");
  });
  it("survives null and arrays", () => {
    expect(replaceTokens(null, {})).toBe(null);
    expect(replaceTokens([{ type: "text", text: "{a}" }], { "{a}": "b" })[0].text).toBe("b");
  });
});

describe("resolveField — name AND type", () => {
  const fields = [
    { id: "due-num", name: "Due", type: "number" },
    { id: "due-date", name: "Due", type: "date" },
  ];
  it("picks the one matching both", () => expect(resolveField(fields, "Due", "date")).toBe("due-date"));
  it("returns null on a miss rather than a wrong id", () => expect(resolveField(fields, "Due", "select")).toBe(null));
  it("returns null when ambiguous rather than picking the first", () =>
    expect(resolveField([...fields, { id: "x", name: "Due", type: "date" }], "Due", "date")).toBe(null));
});

describe("isoPlusDays — relative, and local-midnight safe", () => {
  // `new Date("2026-08-28")` is UTC midnight, i.e. the 27th in CDT. Building
  // from parts is what stops a Due date landing a day early west of UTC — the
  // same trap the `weekday:` token was written around (2026-08-20).
  it("adds days without a UTC round trip", () => {
    expect(isoPlusDays(new Date(2026, 7, 28), 3)).toBe("2026-08-31");
  });
  it("rolls the month", () => expect(isoPlusDays(new Date(2026, 7, 30), 3)).toBe("2026-09-02"));
  it("rolls the year", () => expect(isoPlusDays(new Date(2026, 11, 30), 3)).toBe("2027-01-02"));
  it("zero-pads", () => expect(isoPlusDays(new Date(2026, 0, 1), 0)).toBe("2026-01-01"));
  it("is stable across a DST boundary (US spring forward 2026-03-08)", () => {
    expect(isoPlusDays(new Date(2026, 2, 7), 2)).toBe("2026-03-09");
  });
});

describe("STARTERS — the table's own invariants", () => {
  const all = Object.entries(STARTERS).flatMap(([p, list]) => list.map(s => ({ ...s, project: p })));

  it("covers both projects the user asked for", () => {
    expect(Object.keys(STARTERS).sort()).toEqual(["Paul's Clown Website", "Via Fluere"]);
  });

  // A task whose Status disagrees with the column it sits in gets MOVED by
  // Project: Status Router the first time anything touches it — the starter
  // set would rearrange itself on first use.
  it("every task's column is a real kanban column", () => {
    for (const s of all) expect(KANBAN_COLUMNS).toContain(s.column);
  });

  it("no two tasks in one project share a label — the idempotency key is the label", () => {
    for (const [p, list] of Object.entries(STARTERS)) {
      const labels = list.map(s => s.label);
      expect(new Set(labels).size, `${p} has duplicate starter labels`).toBe(labels.length);
    }
  });

  it("at least one task per project carries a Due, so the schedule path is exercised", () => {
    for (const [p, list] of Object.entries(STARTERS)) {
      expect(list.some(s => s.dueInDays != null), `${p} has no due-dated starter`).toBe(true);
    }
  });

  it("every Due is in the FUTURE — a past due lands the task on the schedule immediately", () => {
    for (const s of all) if (s.dueInDays != null) expect(s.dueInDays).toBeGreaterThan(0);
  });

  // The 2026-08-23 (3) defect: a row carrying a Date value is visible on exactly
  // one day of the year, because the grid filters on Date.
  it("no starter carries a Date value", () => {
    for (const s of all) expect(s).not.toHaveProperty("date");
  });

  it("both scopes are real prose, not a placeholder dash", () => {
    for (const t of [VIA_FLUERE_SCOPE, PAUL_SCOPE]) {
      expect(t.length).toBeGreaterThan(80);
      expect(t).not.toContain("{Project");
    }
  });
});
