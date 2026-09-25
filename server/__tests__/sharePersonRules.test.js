// The two people share rules (0361), run through the REAL server executor with
// the database faked: a contact whose name matches someone MERGES into them
// (empty fields filled, the photo added beside theirs, nothing overwritten);
// an unknown contact and a profile link ADD a person with the board's field set.
import { describe, it, expect, vi, beforeEach } from "vitest";

const minted = [];
vi.mock("../services/occurrenceMint.js", () => ({
  mintOccurrence: async (a) => { minted.push(a); return { occurrenceId: "new1", moduleId: "newmod", status: "created" }; },
}));
vi.mock("../models/Secret.js", () => ({ default: { findOne: async () => null } }));
vi.mock("../models/Folder.js", () => ({ default: { findOne: () => ({ lean: async () => null }) } }));

const F = { name: "fName", phone: "fPhone", email: "fEmail", website: "fWeb", instagram: "fIg",
  media: "fPoster", files: "fFiles", library: "fLib", foundVia: "fVia" };
const LIKE = { id: "likeMod", userId: "u1", gridId: "g1", role: "instance", label: "Max Lamb", fieldBindings: [
  { fieldId: "fLib", role: "input", hidden: true, order: 0 },
  { fieldId: "fPoster", role: "media", hidden: true, order: 1 },
  { fieldId: "fName", role: "input", order: 2 },
  { fieldId: "fPhone", role: "input", order: 3 },
  { fieldId: "fWeb", role: "input", hidden: true, order: 4 },
  { fieldId: "fFiles", role: "files", hidden: true, order: 5 },
] };
let modules, occs, writes;
const matches = (d, q) => Object.entries(q).every(([k, v]) => d[k] === v);
vi.mock("../models/Module.js", () => ({ default: {
  find: (q) => ({ lean: async () => modules.filter(m => matches(m, q)) }),
  findOne: (q) => ({ lean: async () => modules.find(m => matches(m, q)) || null }),
  updateOne: async (q, u) => { writes.push({ model: "module", q, u }); const m = modules.find(x => x.id === q.id); Object.assign(m, u.$set); },
}}));
vi.mock("../models/Occurrence.js", () => ({ default: {
  find: (q) => ({ lean: async () => occs.filter(o => matches(o, q)) }),
  findOne: (q) => ({ lean: async () => occs.find(o => matches(o, q)) || null }),
  updateOne: async (q, u) => {
    writes.push({ model: "occurrence", q, u });
    const o = occs.find(x => x.id === q.id);
    for (const [k, v] of Object.entries(u.$set)) o.fields[k.replace(/^fields\./, "")] = v;
  },
}}));

const { runOperationServerSide } = await import("../services/serverExecutor.js");
const { buildPeopleShareRules } = await import("../migrations/0361-people-share-rules.mjs");
const [CONTACT, PROFILE] = buildPeopleShareRules({ boardId: "board", likeModuleId: "likeMod", f: F });
const run = (rule, person) => runOperationServerSide({ id: "r", pipeline: rule.pipeline },
  { userId: "u1", gridId: "g1", vars: { $share: { type: rule.shareType, externalId: "x", person } } });

beforeEach(() => {
  minted.length = 0; writes = [];
  modules = [structuredClone(LIKE), { id: "timMod", userId: "u1", gridId: "g1", role: "instance", label: "Tim Clark",
    fieldBindings: [{ fieldId: "fName", role: "input" }, { fieldId: "fPoster", role: "media", hidden: true },
      { fieldId: "fFiles", role: "files", hidden: true }, { fieldId: "fPhone", role: "input", hidden: true }] }];
  occs = [{ id: "tim", userId: "u1", gridId: "g1", moduleId: "timMod", parentId: "board", label: null,
    fields: { fName: { value: "Tim Clark" }, fPoster: { value: "oldPhoto" }, fFiles: { value: ["oldPhoto"] } } }];
});

describe("Share: add contact", () => {
  it("a card named like someone on the board MERGES into them", async () => {
    const r = await run(CONTACT, { name: "tim  CLARK", phone: "555", email: "t@x", photoOccurrenceId: "newPhoto", photoIds: ["newPhoto"] });
    expect(r.ok).toBe(true);
    expect(minted).toHaveLength(0);
    const tim = occs[0].fields;
    expect(tim.fName.value).toBe("Tim Clark");            // kept, not overwritten
    expect(tim.fPoster.value).toBe("oldPhoto");           // cover kept
    expect(tim.fFiles.value).toEqual(["oldPhoto", "newPhoto"]); // both photos on the record
    expect(tim.fPhone.value).toBe("555");                 // an empty field filled
    expect(modules.find(m => m.id === "timMod").fieldBindings.find(b => b.fieldId === "fPhone").hidden).toBe(false);
  });

  it("an unknown name ADDS a person with the board's field set, photo as cover", async () => {
    await run(CONTACT, { name: "Ana Ruiz", phone: "1", photoOccurrenceId: "p", photoIds: ["p"] });
    expect(minted).toHaveLength(1);
    const m = minted[0];
    expect(m.parentId).toBe("board");
    expect(m.fields.fPoster.value).toBe("p");
    expect(m.fieldBindings.find(b => b.fieldId === "fPoster")).toMatchObject({ role: "media" });
    expect(m.fieldBindings.find(b => b.fieldId === "fPhone").hidden).toBeFalsy();
    expect(m.moduleMeta).toEqual({ mediaInline: true });
  });

  it("a person elsewhere on the grid (not on the board) is not a match", async () => {
    occs[0].parentId = "somewhere-else";
    await run(CONTACT, { name: "Tim Clark", photoIds: [] });
    expect(minted).toHaveLength(1);
  });
});

describe("Share: add profile", () => {
  it("always adds a new person, even when the name matches, with the handle for Instagram", async () => {
    await run(PROFILE, { name: "Tim Clark", network: "instagram", handle: "tim.c", profileUrl: "https://www.instagram.com/tim.c/",
      foundVia: ["instagram"], photoOccurrenceId: "p", photoIds: ["p"] });
    expect(minted).toHaveLength(1);
    expect(minted[0].fields.fIg.value).toBe("tim.c");
    expect(minted[0].fields.fWeb.value).toBe("https://www.instagram.com/tim.c/");
    expect(minted[0].fieldBindings.find(b => b.fieldId === "fWeb").hidden).toBe(false);
  });
  it("a TikTok profile has no Instagram handle", async () => {
    await run(PROFILE, { name: "Zed", network: "tiktok", handle: "zed", profileUrl: "https://www.tiktok.com/@zed", foundVia: [], photoIds: [] });
    expect(minted[0].fields.fIg).toBeUndefined();
    expect(minted[0].fields.fFiles).toBeUndefined();   // no photo → no empty list written
    expect(minted[0].fields.fVia).toBeUndefined();
  });
});
