// 0363 — Facebook About CSV onto People (synthetic names).
import { describe, it, expect } from "vitest";
import { matchRows, valuesFor, isoBirthday, genderOption } from "../migrations/0363-facebook-about-into-people.mjs";

const f = { birthday: "bd", birthdayMonthDay: "md", city: "city", hometown: "home", relationshipStatus: "rs",
  languages: "lang", gender: "g", notes: "notes", facebook: "fb" };
const person = (id, label, fields = {}) => ({ id, label, fields });

describe("0363", () => {
  it("dates: a full date only when the year is known; gender onto the select's options", () => {
    expect(isoBirthday("July 4", "1992")).toBe("1992-07-04");
    expect(isoBirthday("July 4", "")).toBeNull();
    expect(genderOption("Female")).toBe("female");
    expect(genderOption("Gender nonbinary")).toBe("non-binary");
    expect(genderOption("Potato")).toBe("other");
    expect(genderOption("")).toBeNull();
  });

  it("matches by label, by the Facebook value, or first + last; ambiguous names are skipped", () => {
    const people = [person("a", "Tim Clark"), person("b", "Inês Muñoz"), person("c", "X", { fb: { value: "Sam Q Lee" } }),
      person("d", "Jo Park"), person("e", "Jo Park")];
    const r = matchRows({ rows: [{ name: "tim clark" }, { name: "Ines Munoz" }, { name: "Sam Lee" }, { name: "Jo Park" }, { name: "Nobody" }],
      people, labelOf: (o) => o.label, fbValueOf: (o) => o.fields.fb?.value || "" });
    expect(r.matches.map(m => m.occ.id)).toEqual(["a", "b", "c"]);
    expect(r.ambiguous.map(x => x.name)).toEqual(["Jo Park"]);
    expect(r.unmatched.map(x => x.name)).toEqual(["Nobody"]);
  });

  it("fills only empty fields; a yearless birthday goes to month/day; family is added to notes once", () => {
    const occ = person("a", "Tim", { city: { value: "Kept City" }, notes: { value: "met at work" }, fb: { value: "Tim Clark" } });
    const set = valuesFor(occ, { birthday: "May 5", birth_year: "", current_city: "Milwaukee", hometown: "Racine",
      relationship: "Single", gender: "Male", family: "Ann (Sister)", profile_url: "https://www.facebook.com/tim.c" }, f);
    expect(set).toEqual({ md: "May 5", home: "Racine", rs: "Single", g: "male",
      notes: "met at work\nFamily: Ann (Sister)", fb: "https://www.facebook.com/tim.c" });
    const again = valuesFor({ ...occ, fields: { ...occ.fields, notes: { value: set.notes }, fb: { value: set.fb } } },
      { family: "Ann (Sister)", profile_url: "https://www.facebook.com/tim.c" }, f);
    expect(again).toEqual({});
  });

  it("a full birthday fills Birthday, not month/day", () => {
    expect(valuesFor(person("a", "T"), { birthday: "July 4", birth_year: "1992" }, f)).toEqual({ bd: "1992-07-04" });
  });
});
