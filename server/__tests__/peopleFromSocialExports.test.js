// 0352 — the pure parts: what each person gets, stable ids, reference cleanup.
import { describe, it, expect } from "vitest";
import { personFieldValues, externalIdsFor, stripIds, stripEmbeds, TEST_PEOPLE } from "../migrations/0352-people-from-social-exports.mjs";

const F = { name: "n", instagram: "ig", relationship: "rel", howMet: "how", notes: "notes",
  fbSince: "fbs", igSince: "igs", foundVia: "via", category: "cat", library: "lib" };

describe("personFieldValues", () => {
  it("a Facebook friend: name, friend, since-date, found via facebook, a person", () => {
    const v = personFieldValues({ name: "Sam Lee", facebook: true, facebookSince: "2014-03-02" }, F);
    expect(v).toEqual({ n: "Sam Lee", rel: "friend", how: "Facebook friends since Mar 2014", fbs: "2014-03-02",
      via: ["facebook"], cat: ["person"], lib: "person" });
  });
  it("an Instagram close friend merged with Facebook", () => {
    const v = personFieldValues({ name: "Ann Po", facebook: true, instagram: "annpo", closeFriend: true,
      followsYou: true, youFollow: true, instagramSince: "2020-01-05" }, F);
    expect(v.rel).toBe("close friend");
    expect(v.ig).toBe("annpo");
    expect(v.via).toEqual(["facebook", "instagram", "close friend", "mutual"]);
  });
  it("a username-only guess is an acquaintance, marked unconfirmed, with the Facebook hint in notes", () => {
    const v = personFieldValues({ name: "jdoe92", instagram: "jdoe92", youFollow: true, igBasis: "judged", maybeFacebook: "Jane Doe" }, F);
    expect(v.rel).toBe("acquaintance");
    expect(v.via).toEqual(["instagram", "you follow", "unconfirmed"]);
    expect(v.notes).toMatch(/Jane Doe/);
  });
  it("invents nothing: no email/phone/birthday keys, and absent data is left unset", () => {
    const v = personFieldValues({ name: "X", facebook: true }, F);
    expect(Object.keys(v).sort()).toEqual(["cat", "how", "lib", "n", "rel", "via"]);
  });
});

describe("externalIdsFor", () => {
  it("is stable, and two Facebook friends with the same name stay two people", () => {
    expect(externalIdsFor([{ name: "A B", facebook: true }, { name: "A B", facebook: true }, { name: "u", instagram: "u" }]))
      .toEqual(["fb:A B", "fb:A B#2", "ig:u"]);
  });
});

describe("reference cleanup", () => {
  const ids = new Set(["t1", "t2"]);
  it("strips removed people out of field values, keeping everything else", () => {
    expect(stripIds({ value: ["t1", "keep"], flow: "in" }, ids)).toEqual({ value: ["keep"], flow: "in" });
    expect(stripIds({ value: "t2" }, ids)).toEqual({});
    const untouched = { value: ["a"] };
    expect(stripIds(untouched, ids)).toBe(untouched);
  });
  it("strips embeds of removed people from a document, at any depth", () => {
    const doc = { type: "doc", content: [{ type: "paragraph" }, { type: "moduleEmbed", attrs: { occurrenceId: "t1" } },
      { type: "wrapGroup", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "t2" } }, { type: "moduleEmbed", attrs: { occurrenceId: "k" } }] }] };
    const r = stripEmbeds(doc, ids);
    expect(r.removed).toBe(2);
    expect(JSON.stringify(r.node)).not.toMatch(/"t1"|"t2"/);
    expect(JSON.stringify(r.node)).toMatch(/"k"/);
    expect(r.node.content.some(n => n.type === "wrapGroup")).toBe(false);   // one member left → flattened
    expect(r.node.content.at(-1)).toEqual({ type: "moduleEmbed", attrs: { occurrenceId: "k" } });
  });
  it("names the ten seeded people, not Keith or Angela", () => {
    expect(Object.keys(TEST_PEOPLE)).toHaveLength(10);
    expect(Object.keys(TEST_PEOPLE).some(n => /keith|angela/i.test(n))).toBe(false);
  });
});
