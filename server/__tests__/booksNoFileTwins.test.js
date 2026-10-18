import { describe, it, expect } from "vitest";
import { planBooks } from "../migrations/0422-books-no-file-and-twins.mjs";

const row = (id, label, files = [], extra = 0) => ({ id, label, files, doc: { id, label, fields: Object.fromEntries([...Array(extra)].map((_, i) => [`f${i}`, { value: i }])) } });
const base = [
  row("aa1", "Alcoholics Anonymous: The Big Book"), row("aa2", "- Alcoholics Anonymous (Big Book)-AA", ["fa"]),
  row("c1", "(Expanse #2) James S.A. Corey - Caliban's War"), row("c2", "Caliban's War", ["fc"]),
  row("d1", "Chris Smith, Jon Stewart - The Daily Show"), row("d2", "The Daily Show (The Book): An Oral History", ["fd"]),
  row("g1", "(Expanse #2.50) James S.A. Corey - Gods of Risk"), row("g2", "Gods of Risk: An Expanse Novella", ["fg"]),
  row("w1", "Carol A. Fleming PhD - It's the Way You Say It: X"), row("w2", "It's the Way You Say It: Becoming Articulate, Y", ["fw"]),
  row("m1", "(Penguin Classics) Marcus Aurelius, Martin Hammond, Diskin Clay - Meditations -P"), row("m2", "Meditations", ["fm"]),
  row("t1", "(Expanse 8) James S.A. Corey - Tiamat’s Wrath"), row("t2", "Tiamat's Wrath: Book 8 of the Expanse (Now)", ["ft"]),
  row("h1", "The Hitchhiker's Guide to the Galaxy Omnibus: A Trilogy in Five Parts"), row("h2", "The Hitchhiker's Guide to the Galaxy", ["fh"]),
  row("s1", "How to Stop Worrying and Start Living, the Art of Public Speaking, X"), row("s2", "How To Stop Worrying And Start Living", ["fs"]),
  row("e1", "The Manga Guide to Electricity", ["fe1"]), row("e2", "Manga Guide to Electricity, The", ["fe2"], 3),
  row("q1", "The Manga Guide to Statistics", ["fq1"]), row("q2", "Manga Guide to Statistics, The", ["fq2"]),
  row("j1", "The daily stoic journal: 366 days of writing", ["fj1"]), row("j2", "Hanselman, Stephen Hol - The daily stoic journal 366 day", ["fj2"]),
  row("j3", "Hanselman, Stephen Holiday, Ryan", [], 9),
  row("x1", "The Silmarillion"), row("ok", "Dune", ["fdune"]),
];

describe("0422 plan", () => {
  it("merges twins into the row with the file, deletes other file-less rows, keeps the rest", () => {
    const { merges, deletes, problems } = planBooks(base);
    expect(problems).toEqual([]);
    expect(deletes).toEqual(["x1"]);
    expect(merges.find((m) => m.dropIds.includes("aa1")).keepId).toBe("aa2");
    expect(merges.flatMap((m) => [m.keepId, ...m.dropIds])).not.toContain("ok");
  });
  it("a duplicate group never keeps the row without a file, even when it is fuller", () => {
    const j = planBooks(base).merges.find((m) => m.dropIds.includes("j3"));
    expect(["j1", "j2"]).toContain(j.keepId);
    expect(j.dropIds).toHaveLength(2);
  });
  it("among file rows the fuller is kept", () => {
    expect(planBooks(base).merges.find((m) => m.label === "The Manga Guide to Electricity").keepId).toBe("e2");
  });
  it("refuses when a measured row is missing", () => {
    expect(planBooks(base.filter((r) => r.id !== "c2")).problems.join()).toMatch(/Caliban/);
  });
});
