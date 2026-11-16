// services/buildPlan — one `build` call plans every record (Jonah builds anything, 2026-11-15).
import { describe, it, expect } from "vitest";
import { planBuild, parseShort, nodeKind } from "../services/buildPlan.js";

let k = 0;
const ctx = (over = {}) => ({
  gridId: "g", userId: "u", rootFolderId: "root", mint: () => `id${++k}`,
  folders: [{ id: "f-boards", name: "Boards", parentId: "root" }],
  fields: [
    { id: "f-date", name: "Date", type: "date" },
    { id: "f-dur", name: "Duration", type: "duration" },
  ],
  find: (name) => ({ schedule: { occId: "sched", role: "page", kind: "board" }, tasks: { occId: "tasks", role: "page", kind: "board" },
    routines: { occId: "routines", role: "page", kind: "doc", moduleId: "m-routines" } })[String(name).toLowerCase()] || null,
  buttonFieldFor: () => null,
  ...over,
});

const GLOSSARY = [
  { page: "Glossary", children: [
    { section: "Places", children: ["Schedule ->", "Tasks ->"] },
    { section: "Quick Links", children: [
      { button: "Open in browser", does: "open links" },
      { section: "Mail", children: [{ button: "Open in browser", does: "open links" }, "Gmail | https://mail.google.com", "Proton Mail | https://mail.proton.me"] },
    ] },
  ] },
];

describe("short forms", () => {
  it("reads links, in-app links and items", () => {
    expect(parseShort("Gmail | https://mail.google.com")).toEqual({ kind: "link", name: "Gmail", url: "https://mail.google.com" });
    expect(parseShort("Drive | drive.google.com")).toEqual({ kind: "link", name: "Drive", url: "https://drive.google.com" });
    expect(parseShort("Schedule ->")).toEqual({ kind: "link", name: "Schedule", to: "Schedule" });
    expect(parseShort("Plans -> Day Page")).toEqual({ kind: "link", name: "Plans", to: "Day Page" });
    expect(parseShort("Buy milk")).toEqual({ kind: "item", name: "Buy milk" });
  });
  it("names a node by its key or type", () => {
    expect(nodeKind({ page: "Home" })).toEqual({ kind: "page", name: "Home" });
    expect(nodeKind({ type: "section", name: "Mail" })).toEqual({ kind: "section", name: "Mail" });
    expect(nodeKind({ nope: 1 }).kind).toBe(null);
  });
});

describe("the glossary", () => {
  const p = planBuild({ nodes: GLOSSARY, ctx: ctx() });
  const occ = Object.fromEntries(p.occurrences.map((o) => [o.id, o]));
  const mod = Object.fromEntries(p.modules.map((m) => [m.id, m]));
  const named = (label, role) => p.occurrences.find((o) => mod[o.moduleId].label === label && (!role || mod[o.moduleId].role === role));

  it("makes a doc page in the root folder holding the sections", () => {
    const page = named("Glossary", "page");
    expect(mod[page.moduleId].kind).toBe("doc");
    expect(page.parentId).toBe("root");
    expect(page.occurrences.map((id) => mod[occ[id].moduleId].label)).toEqual(["Places", "Quick Links"]);
    expect(p.problems).toEqual([]);
  });
  it("every child is listed AND embedded by its doc parent", () => {
    for (const o of p.occurrences) {
      if (o.parentId === "root") continue;
      expect(occ[o.parentId].occurrences).toContain(o.id);
      expect(JSON.stringify(occ[o.parentId].textmap)).toContain(o.id);
    }
  });
  it("in-app links point at the real pages; web links are url chips in a bullet list", () => {
    const links = p.occurrences.filter((o) => o.meta?.link).map((o) => o.meta.link);
    expect(links).toContainEqual({ kind: "occurrence", occId: "sched" });
    expect(links).toContainEqual({ kind: "url", url: "https://mail.google.com" });
    const mailTb = occ[named("Mail").occurrences[0]];
    expect(mailTb.textmap.content[0].type).toBe("bulletList");
    expect(mailTb.textmap.content[0].content).toHaveLength(2);
  });
  it("a doc section ends in one hover line", () => {
    const c = named("Mail").textmap.content;
    expect(c.at(-1)).toEqual({ type: "paragraph" });
    expect(c.at(-2).type).not.toBe("paragraph");
  });
  it("one Open in browser field, bound on both sections, with ONE listening operation", () => {
    expect(p.fields).toHaveLength(1);
    expect(p.fields[0]).toMatchObject({ name: "Open in browser", type: "button" });
    for (const label of ["Quick Links", "Mail"]) expect(mod[named(label).moduleId].fieldBindings.map((b) => b.fieldId)).toEqual([p.fields[0].id]);
    expect(p.operations).toHaveLength(1);
    expect(p.operations[0].pipeline.steps.map((s) => s.config.type)).toEqual(["FIND", "OPEN_URLS"]);
  });
});

describe("other shapes", () => {
  it("a board page with a board section: links are bookmark cards, items are rows with field values", () => {
    const p = planBuild({ nodes: [{ page: "Links", kind: "board", children: [{ section: "Web", children: ["GitHub | https://github.com", { item: "Call mom", fields: { Date: "2026-11-20" } }] }] }], ctx: ctx() });
    const mod = Object.fromEntries(p.modules.map((m) => [m.id, m]));
    const sec = p.occurrences.find((o) => mod[o.moduleId].label === "Web");
    expect(mod[sec.moduleId].kind).toBe("board");
    const kids = sec.occurrences.map((id) => p.occurrences.find((o) => o.id === id));
    expect(mod[kids[0].moduleId]).toMatchObject({ role: "artifact", kind: "bookmark", fileRef: "https://github.com" });
    expect(kids[1].fields["f-date"].value).toBe("2026-11-20");
  });
  it("repeat makes one row per matching day", () => {
    const p = planBuild({ nodes: [{ page: "Classes", kind: "board", children: [{ section: "CPS", children: [
      { item: "CPS Class", fields: { Duration: "4h" }, repeat: { from: "2026-11-01", to: "2026-11-30", weekdays: ["Mon", "Tue", "Wed", "Thu"] } }] }] }], ctx: ctx() });
    const rows = p.occurrences.filter((o) => o.fields?.["f-date"]);
    expect(rows).toHaveLength(17);
    expect(rows[0].fields["f-dur"].value).toBe(240);
  });
  it("under: adds into an existing page without rewriting it", () => {
    const p = planBuild({ under: "Routines", nodes: [{ section: "Coffee", children: [{ item: "Espresso" }] }], ctx: ctx() });
    const sec = p.occurrences.find((o) => p.modules.find((m) => m.id === o.moduleId).label === "Coffee");
    expect(sec.parentId).toBe("routines");
    expect(p.attach).toEqual([{ parentId: "routines", childId: sec.id, doc: true }]);
  });
  it("a show-page button points at the page; unknown names are problems, never guesses", () => {
    const p = planBuild({ nodes: [{ page: "Home", children: [{ button: "Go to tasks", does: "show page Tasks" }, { button: "Bad", does: "show page Nowhere" }, "Nope ->"] }], ctx: ctx() });
    const ok = p.operations.find((o) => o.name.startsWith("Go to tasks"));
    expect(ok.pipeline.steps[0].config).toMatchObject({ type: "UPDATE_VIEW", viewId: "$trigger.panelViewId", activeOccurrenceId: "tasks" });
    expect(p.problems).toEqual(expect.arrayContaining([expect.stringMatching(/Nowhere/), expect.stringMatching(/Nope/)]));
    expect(p.operations.find((o) => o.name.startsWith("Bad")).enabled).toBe(false);
  });
  it("a field node defines a field; a select gets its options", () => {
    const p = planBuild({ nodes: [{ field: "Mood", fieldType: "select", options: ["calm", "busy"] }], ctx: ctx() });
    expect(p.fields[0]).toMatchObject({ name: "Mood", type: "select" });
    expect(JSON.stringify(p.fields[0].meta)).toContain("busy");
  });
  it("an existing button that already does the job is reused, not duplicated", () => {
    const listening = new Set(["open links"]);
    const p = planBuild({ nodes: [{ page: "X", children: [{ section: "S", children: [{ button: "Open in browser", does: "open links" }] }] }],
      ctx: ctx({ buttonFieldFor: (l) => (l === "Open in browser" ? { fieldId: "btn", listening } : null) }) });
    expect(p.fields).toEqual([]);
    expect(p.operations).toEqual([]);
  });
});

// What Jonah (Qwen2.5 7B) actually wrote on 2026-11-15: the links INSIDE the button's `does`. Accepted: the button
// opens links, and those addresses become the section's link chips.
describe("a button that carries its links", () => {
  it("open links | url | url → the button, plus a chip per address in that section", () => {
    const p = planBuild({ nodes: [{ page: "G", children: [{ section: "Social", children: [
      { button: "Open Social", does: "open links | https://www.facebook.com | https://fetlife.com" },
      { button: "Open Mail", does: "open links | https://mail.google.com", fields: { Text: "Gmail" } },
    ] }] }], ctx: ctx() });
    expect(p.problems).toEqual([]);
    const urls = p.occurrences.filter((o) => o.meta?.link?.kind === "url").map((o) => o.meta.link.url);
    expect(urls).toEqual(["https://www.facebook.com", "https://fetlife.com", "https://mail.google.com"]);
    const labels = p.modules.filter((m) => m.meta?.link).map((m) => m.label);
    expect(labels).toContain("Gmail");
    expect(labels).toContain("facebook.com");
    expect(p.operations.every((o) => o.pipeline.steps.some((s) => s.config.type === "OPEN_URLS"))).toBe(true);
  });
});

// Markdown is what a small model writes most reliably (2026-11-15: three runs of the tree form put each link in its own
// button). A page or section may carry its content as markdown; it becomes the same nodes.
import { markdownToNodes } from "../services/buildPlan.js";
describe("markdown content", () => {
  const MD = "Everything in one place.\n\n## Places\n- [[Schedule]]\n- [[Tasks]]\n\n## Quick Links [open links]\n### Mail [open links]\n- [Gmail](https://mail.google.com)\n- Proton Mail | https://mail.proton.me\n";
  it("headings are sections, [open links] a button, links chips, [[x]] in-app links, prose text", () => {
    expect(markdownToNodes(MD)).toEqual([
      { text: "Everything in one place." },
      { section: "Places", children: ["Schedule -> Schedule", "Tasks -> Tasks"] },
      { section: "Quick Links", children: [
        { button: "Open in browser", does: "open links" },
        { section: "Mail", children: [{ button: "Open in browser", does: "open links" }, "Gmail | https://mail.google.com", "Proton Mail | https://mail.proton.me"] },
      ] },
    ]);
  });
  it("a page with markdown plans like the tree", () => {
    const p = planBuild({ nodes: [{ page: "Glossary", markdown: MD }], ctx: ctx() });
    expect(p.problems).toEqual([]);
    expect(p.occurrences.filter((o) => o.meta?.link?.kind === "url")).toHaveLength(2);
    expect(p.occurrences.filter((o) => o.meta?.link?.kind === "occurrence")).toHaveLength(2);
    expect(p.operations).toHaveLength(1);
  });
});

// What Jonah wrote with markdown (2026-11-15): in-app links as [Name](Name), and the open-all button as a link line
// "[Open all in browser](javascript:…)". Both read as meant; a javascript: address is never kept.
describe("markdown as Jonah writes it", () => {
  it("[Name](Name) is an in-app link", () => {
    expect(markdownToNodes("## Places\n- [Schedule](Schedule)\n- [Day Page](Day Pages)")).toEqual([
      { section: "Places", children: ["Schedule -> Schedule", "Day Page -> Day Pages"] },
    ]);
  });
  it("an 'open … in browser' link line is the section's open-links button", () => {
    const nodes = markdownToNodes("## Quick Links\n[Open all in browser](javascript:window.open('https://a.io'))\n### Mail\n- [Open in browser](javascript:x)\n- [Gmail](https://mail.google.com)");
    expect(nodes).toEqual([{ section: "Quick Links", children: [
      { button: "Open in browser", does: "open links" },
      { section: "Mail", children: [{ button: "Open in browser", does: "open links" }, "Gmail | https://mail.google.com"] },
    ] }]);
    expect(JSON.stringify(nodes)).not.toMatch(/javascript/);
  });
  it("a section never gets two open-links buttons", () => {
    expect(markdownToNodes("## Mail [open links]\n[Open all in browser](javascript:x)")[0].children).toHaveLength(1);
  });
});

describe("more markdown habits (Jonah, 2026-11-15)", () => {
  it("several links on one line are several links", () => {
    expect(markdownToNodes("## Q\n- [Gmail](https://mail.google.com) | [Proton](https://mail.proton.me)")).toEqual([
      { section: "Q", children: ["Gmail | https://mail.google.com", "Proton | https://mail.proton.me"] },
    ]);
  });
  it("a bold-only list item with indented items under it is a sub-section", () => {
    expect(markdownToNodes("## Quick Links\n- **Mail**\n  - [Gmail](https://mail.google.com)\n- **Social**\n  - [Facebook](https://www.facebook.com)")).toEqual([
      { section: "Quick Links", children: [
        { section: "Mail", children: ["Gmail | https://mail.google.com"] },
        { section: "Social", children: ["Facebook | https://www.facebook.com"] },
      ] },
    ]);
  });
  it("[Open All In Browser] alone is the button", () => {
    expect(markdownToNodes("## Quick Links\n[Open All In Browser]")[0].children).toEqual([{ button: "Open in browser", does: "open links" }]);
  });
});

describe("a button sent beside its page", () => {
  it("goes on the page this build made", () => {
    const p = planBuild({ nodes: [{ page: "Home", markdown: "## Mail\n- [Gmail](https://mail.google.com)" }, { button: "Open in browser", does: "open links" }], ctx: ctx() });
    expect(p.problems).toEqual([]);
    const page = p.modules.find((m) => m.role === "page");
    expect(page.fieldBindings).toHaveLength(1);
  });
});

describe("made-up addresses are reported", () => {
  it("knows a placeholder from a real site", async () => {
    const { placeholderAddress } = await import("../services/buildPlan.js");
    for (const u of ["https://example.com/schedule", "https://www.example.org", "http://localhost:3000", "https://site.test", "https://yourdomain.com"]) expect(placeholderAddress(u)).toBe(true);
    for (const u of ["https://mail.google.com", "https://github.com", "https://example-music.com", "https://myexample.com"]) expect(placeholderAddress(u)).toBe(false);
  });
  it("a placeholder link is a problem (and still planned)", () => {
    const p = planBuild({ nodes: [{ page: "G", markdown: "## Places\n- [Schedule](https://example.com/schedule)\n- [Gmail](https://mail.google.com)" }], ctx: ctx() });
    expect(p.problems).toEqual(['"Schedule": https://example.com/schedule is a made-up address — use the site\'s real one']);
  });
});

describe("did you mean", () => {
  it("names the close real page and never guesses between ties", async () => {
    const { closestName } = await import("../services/buildPlan.js");
    const names = ["Schedule", "Day Page", "Routines", "Tasks", "Trackers"];
    expect(closestName("Scheduling", names)).toBe("Schedule");
    expect(closestName("Day Pages", names)).toBe("Day Page");
    expect(closestName("Task", names)).toBe("Tasks");
    expect(closestName("Gardening", names)).toBe(null);
    expect(closestName("Cat", ["Bat", "Hat"])).toBe(null);
  });
  it("a missing in-app link says which page was probably meant, and still does not link it", () => {
    const c = { ...ctx(), names: ["Schedule"] };
    const p = planBuild({ nodes: [{ page: "G", markdown: "- [[Scheduling]]" }], ctx: c });
    expect(p.problems[0]).toMatch(/no page or folder named "Scheduling" — left as plain text — did you mean "Schedule"\?/);
    expect(JSON.stringify(p.modules)).not.toMatch(/"kind":"occurrence"/);
  });
});
