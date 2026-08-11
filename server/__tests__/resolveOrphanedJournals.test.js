// 0080 decides whether a homeless journal is DUPLICATE (removable) or REAL
// (must be kept and resolved). The classifier is pure, so the decision is
// testable without a database — and it is the part with branches, which is the
// part worth pinning.
//
// Every case here A/B's against a way the guard could be wrong. The dangerous
// direction is deleting the user's writing, so the majority of these assert
// that something is KEPT.
import { describe, it, expect } from "vitest";
import { classifyJournal, subtreeTextLength } from "../migrations/0080-resolve-orphaned-journals.mjs";

const MOOD = "fld-mood";
const mk = (id, extra = {}) => ({ id, fields: {}, occurrences: [], ...extra });

// A homeless journal with a healthy same-day twin.
const withTwin = (occ) => ({
  sameDaySiblings: [occ, { id: "healthy", reachesSchedule: true }],
  reachesSchedule: false, textLength: 0, moodFieldId: MOOD,
});

describe("0080 classifyJournal", () => {
  it("REMOVES an empty duplicate of a reachable same-day journal", () => {
    const occ = mk("dup");
    expect(classifyJournal(occ, withTwin(occ)).action).toBe("remove");
  });

  it("KEEPS a duplicate that holds WRITING — the guard that matters most", () => {
    // 0038 scored field values, fired on the app's own date stamp and refused
    // to delete anything; its header records making that mistake twice. Text is
    // the only thing that may veto, and it MUST veto.
    const occ = mk("dup");
    const v = classifyJournal(occ, { ...withTwin(occ), textLength: 12 });
    expect(v.action).toBe("keep");
    expect(v.why).toMatch(/writing/);
  });

  it("KEEPS a duplicate that carries a recorded mood", () => {
    const occ = mk("dup", { fields: { [MOOD]: { value: ["occ-lonely"] } } });
    expect(classifyJournal(occ, withTwin(occ)).action).toBe("keep");
  });

  it("KEEPS a duplicate that has children", () => {
    const occ = mk("dup", { occurrences: ["child"] });
    expect(classifyJournal(occ, withTwin(occ)).action).toBe("keep");
  });

  it("RESOLVES the only journal for its day — homeless is not duplicate", () => {
    // The Schedule's day columns are transient, so an older day's journal is
    // unreachable simply because the user is not looking at that day. Deleting
    // it would be deleting a real journal.
    const occ = mk("lonely-day");
    const v = classifyJournal(occ, {
      sameDaySiblings: [occ], reachesSchedule: false, textLength: 0, moodFieldId: MOOD,
    });
    expect(v.action).toBe("resolve");
  });

  it("RESOLVES when the same-day sibling is ALSO unreachable — neither is the healthy one", () => {
    // Two homeless journals on one day: there is no proven-good copy to prefer,
    // so removing either would be a guess about which the user kept.
    const occ = mk("a");
    const v = classifyJournal(occ, {
      sameDaySiblings: [occ, { id: "b", reachesSchedule: false }],
      reachesSchedule: false, textLength: 0, moodFieldId: MOOD,
    });
    expect(v.action).toBe("resolve");
  });

  it("KEEPS anything already reachable, untouched", () => {
    const occ = mk("healthy");
    const v = classifyJournal(occ, {
      sameDaySiblings: [occ], reachesSchedule: true, textLength: 0, moodFieldId: MOOD,
    });
    expect(v.action).toBe("keep");
  });
});

describe("0080 subtreeTextLength", () => {
  const occById = (arr) => new Map(arr.map((o) => [o.id, o]));

  it("counts text through a plain (uncompressed) textmap", () => {
    const m = occById([mk("a", { textmap: { content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }] } })]);
    expect(subtreeTextLength("a", m)).toBe(5);
  });

  it("counts text in CHILDREN, not just the root", () => {
    // A journal whose own body is empty but whose child textblock holds the
    // entry must never read as empty.
    const m = occById([
      mk("a", { occurrences: ["b"] }),
      mk("b", { textmap: { content: [{ type: "text", text: "an entry" }] } }),
    ]);
    expect(subtreeTextLength("a", m)).toBe(8);
  });

  it("ignores whitespace-only text", () => {
    const m = occById([mk("a", { textmap: { content: [{ type: "text", text: "   \n " }] } })]);
    expect(subtreeTextLength("a", m)).toBe(0);
  });

  it("terminates on a cycle instead of hanging", () => {
    const m = occById([mk("a", { occurrences: ["b"] }), mk("b", { occurrences: ["a"] })]);
    expect(subtreeTextLength("a", m)).toBe(0);
  });
});
