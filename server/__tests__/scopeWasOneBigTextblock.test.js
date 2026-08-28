import { describe, it, expect } from "vitest";
import { planScopeSections, textSurvives, nodeText }
  from "../migrations/0280-a-scope-that-was-one-big-textblock.mjs";

const h = (level, text) => ({ type: "heading", attrs: { level }, content: [{ type: "text", text }] });
const p = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
const ul = (...items) => ({ type: "bulletList", content: items.map(t => (
  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] })) });

// The live shape, verbatim: H1 then five H2 sections.
const LIVE = () => ([
  h(1, "Project Scope — Via Fluere"),
  h(2, "Overview"), p("Via Fluere is the workspace this grid runs on."),
  h(2, "Goals"), ul("Goal 1", "Goal 2"),
  h(2, "Milestones"), ul("M1"),
  h(2, "Risks"), p("—"),
  h(2, "Success Criteria"), p("—"),
]);

describe("0280 — planScopeSections", () => {
  it("splits the live scope into its five sections", () => {
    const plan = planScopeSections(LIVE());
    expect(plan.sections.map(s => s.title))
      .toEqual(["Overview", "Goals", "Milestones", "Risks", "Success Criteria"]);
    expect(nodeText(plan.sections[0].body[0])).toContain("workspace this grid runs on");
    expect(plan.sections[1].body[0].type).toBe("bulletList");
  });

  it("treats a heading-only preamble as a title to drop", () => {
    const plan = planScopeSections(LIVE());
    expect(plan.preambleIsTitleOnly).toBe(true);
    expect(plan.preamble).toHaveLength(1);
  });

  // NOTHING THE USER TYPED IS THROWN AWAY. Once there is real content above the
  // first heading, the WHOLE preamble moves into the first section — the title
  // included. Deliberately conservative: guessing which of several leading
  // nodes was "just the title" is how a migration deletes a sentence.
  it("moves a real preamble into the first section, title and all", () => {
    const body = [h(1, "Title"), p("typed above the first heading"), ...LIVE().slice(1)];
    const plan = planScopeSections(body);
    expect(plan.preambleIsTitleOnly).toBe(false);
    expect(plan.sections[0].body.slice(0, 2).map(nodeText))
      .toEqual(["Title", "typed above the first heading"]);
    // and the guard agrees nothing was lost
    expect(textSurvives(body, plan).ok).toBe(true);
  });

  // FAIL CLOSED — this migration was written for one shape and must not
  // "convert" anything else.
  it("refuses a body with no H2 sections", () => {
    expect(planScopeSections([p("just prose"), p("more prose")])).toBeNull();
    expect(planScopeSections([h(1, "only a title")])).toBeNull();
    expect(planScopeSections([])).toBeNull();
    expect(planScopeSections(null)).toBeNull();
  });

  it("keeps an empty section rather than skipping it", () => {
    const plan = planScopeSections([h(2, "Overview"), h(2, "Goals"), p("g")]);
    expect(plan.sections.map(s => s.title)).toEqual(["Overview", "Goals"]);
    expect(plan.sections[0].body).toEqual([]);
  });
});

describe("0280 — textSurvives (the guard that makes this safe)", () => {
  it("passes on the live shape: every word of prose lands in a section", () => {
    const content = LIVE();
    const check = textSurvives(content, planScopeSections(content));
    expect(check.ok).toBe(true);
    expect(check.after).toContain("workspace this grid runs on");
    expect(check.after).toContain("Goal 1");
  });

  // THE DISCRIMINATOR. If the splitter ever drops a node, the guard has to
  // notice — otherwise it is decoration. Here the plan is deliberately damaged.
  it("FAILS when a section body is dropped", () => {
    const content = LIVE();
    const plan = planScopeSections(content);
    plan.sections[0].body = [];                    // lose the Overview prose
    expect(textSurvives(content, plan).ok).toBe(false);
  });

  it("FAILS when a section's prose is truncated", () => {
    const content = LIVE();
    const plan = planScopeSections(content);
    plan.sections[0].body = [p("Via Fluere is")];  // half the sentence
    expect(textSurvives(content, plan).ok).toBe(false);
  });

  // The headings are SUPPOSED to disappear from the prose — they become
  // container labels. The guard must not read that as loss, or it would refuse
  // every scope on the grid.
  it("does not count the section headings as lost text", () => {
    const content = LIVE();
    const check = textSurvives(content, planScopeSections(content));
    expect(check.ok).toBe(true);
    expect(check.after).not.toContain("Success Criteria");
  });
});
