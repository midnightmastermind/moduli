// 0359 — Instagram CSV: who each row is, merges by full name, photo targets.
// Synthetic names only; the real CSV names other people and stays out of git.
import { describe, it, expect } from "vitest";
import { readRows, planRows, normName } from "../migrations/0359-people-from-instagram-csv.mjs";

const IG = "fIg";
const card = (id, ext, label, fields = {}) => ({ id, moduleId: `m-${id}`, label, meta: { externalId: ext }, fields });
const people = [
  card("ig1", "ig:tclark", "tclark"),
  card("fb1", "fb:Tim Clark", "Tim Clark"),
  card("fb2", "fb:Ana Ruiz", "Ana Ruiz"),
  card("fb3", "fb:Devin K Conway", "Devin K Conway"),
  card("fb4", "fb:Sam Lee", "Sam Lee", { [IG]: { value: "samlee" } }),
  card("fb5", "fb:Jo Park", "Jo Park"),
  card("fb6", "fb:Jo Park", "Jo Park"),
  card("ig2", "ig:onlyme", "onlyme"),
];
const labelOf = (o) => o.label;
const rows = [
  { handle: "tclark", name: "Tim Clark", src: "u1" },       // ig card + fb by name -> merge
  { handle: "ana.r", name: "𝗔𝗻𝗮 𝗥𝘂𝗶𝘇", src: "u2" },         // bold unicode name, no ig card -> handle + photo
  { handle: "laughable", name: "Devin Conway", src: "u3" },   // first + last, middle initial allowed
  { handle: "other.sam", name: "Sam Lee", src: "u4" },        // fb already has a DIFFERENT handle -> not him
  { handle: "jp", name: "Jo Park", src: "u5" },               // two Jo Parks -> ambiguous, no match
  { handle: "onlyme", name: "", src: "u6" },                  // handle only -> that card
  { handle: "celebrity", name: "Famous Person", src: "u7" },  // nobody -> left alone
  { handle: "ana.photos", name: "Ana Ruiz", src: "u8" },      // a 2nd handle for someone already claimed
];
const plan = planRows({ rows, people, labelOf, igFieldId: IG });

describe("0359 planRows", () => {
  it("merges the Instagram card into the Facebook friend with the same full name", () => {
    expect(plan.merges.map(m => [m.ig.id, m.fb.id])).toEqual([["ig1", "fb1"]]);
  });
  it("a name-only match gains the handle; bold Unicode and a middle initial still match", () => {
    expect(plan.handles.map(h => [h.occ.id, h.handle])).toEqual([["fb2", "ana.r"], ["fb3", "laughable"]]);
  });
  it("never matches a friend linked to another handle, or an ambiguous name", () => {
    expect(plan.unmatched.map(r => r.handle).sort()).toEqual(["ana.photos", "celebrity", "jp", "other.sam"]);
  });
  it("each matched person gets exactly one photo, on the surviving card", () => {
    expect(plan.photos.map(p => [p.occId, p.url])).toEqual([["fb1", "u1"], ["fb2", "u2"], ["fb3", "u3"], ["ig2", "u6"]]);
  });
});

describe("0359 readRows", () => {
  it("reads handle, display name and photo from the scraped following list", () => {
    const csv = '﻿"index","tag","text","href","linkText","src","alt"\n'
      + '"1","div","tclark · Follow 𝗧𝗶𝗺 𝗖𝗹𝗮𝗿𝗸 Remove","https://www.instagram.com/tclark/","","https://x/p.jpg","a"\n'
      + '"2","div","nobody Remove","https://www.instagram.com/nobody/","","https://x/q.jpg","b"\n';
    expect(readRows(csv)).toEqual([
      { handle: "tclark", name: "Tim Clark", src: "https://x/p.jpg" },
      { handle: "nobody", name: "", src: "https://x/q.jpg" },
    ]);
  });
  it("normName folds accents and punctuation", () => {
    expect(normName("  Inês  O'Neil ")).toBe("ines o neil");
  });
});
