import { describe, it, expect } from "vitest";
import { planNotes } from "../migrations/0491-copies-show-their-notes.mjs";
import { textmapFansTo } from "../socketHandlers/occurrences.js";

const tbDoc = (id) => ({ type: "doc", content: [{ type: "instanceTextblock", attrs: { instanceId: "m-tb", occurrenceId: id } }, { type: "paragraph" }] });
const empty = { type: "doc", content: [{ type: "paragraph" }, { type: "paragraph" }] };
const text = (t) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });

describe("0491 planNotes", () => {
  const rows = [
    { id: "orig", moduleId: "m", role: "instance", tm: tbDoc("tb1") },
    { id: "tb1", moduleId: "m-tb", role: "textblock", parentId: "orig", tm: text("Meeting ID 1") },
    { id: "wiped", moduleId: "m", role: "instance", tm: empty },
    { id: "tb2", moduleId: "m-tb", role: "textblock", parentId: "wiped", tm: text("Meeting ID 2") },
    { id: "dated", moduleId: "m", role: "instance", linkedGroupId: "lg", meta: { copyLinkSource: "wiped" }, tm: null },
    { id: "span", moduleId: "m", role: "instance", meta: { spanOf: "dated", copyLinkSource: "dated" }, tm: null },
    { id: "table", moduleId: "m-t", role: "container", tm: empty },
    { id: "cell", moduleId: "m-tb", role: "textblock", parentId: "table", tm: text("2000") },
    { id: "kept", moduleId: "m", role: "instance", meta: { copyLinkSource: "orig" }, tm: text("my own") },
  ];
  const plan = planNotes(rows, new Set(["m-tb"]));
  const by = Object.fromEntries(plan.map((p) => [p.id, p]));
  it("re-embeds a wiped row's own textblock", () => expect(by.wiped.textmap.content[0].attrs.occurrenceId).toBe("tb2"));
  it("a copy takes its source's body, through a chain", () => {
    expect(by.dated.textmap.content[0].attrs.occurrenceId).toBe("tb2");
    expect(by.span.textmap.content[0].attrs.occurrenceId).toBe("tb2");
  });
  it("leaves a table's cell chips alone and never overwrites a body", () => {
    expect(by.table).toBeUndefined();
    expect(by.kept).toBeUndefined();
    expect(by.orig).toBeUndefined();
  });
});

describe("textmapFansTo", () => {
  it("an empty save never wipes a sibling holding text", () => expect(textmapFansTo({ incoming: empty, sibling: tbDoc("x") })).toBe(false));
  it("an empty sibling always takes the text", () => expect(textmapFansTo({ incoming: tbDoc("x"), sibling: empty })).toBe(true));
  it("a sibling whose text the writer never saw is left alone", () => {
    expect(textmapFansTo({ incoming: text("b"), sibling: text("other"), basis: "not-its-digest" })).toBe(false);
  });
  it("no basis: text over text still fans (old rule)", () => expect(textmapFansTo({ incoming: text("b"), sibling: text("a") })).toBe(true));
});
