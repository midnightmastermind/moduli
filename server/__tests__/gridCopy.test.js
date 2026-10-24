import { describe, it, expect } from "vitest";
import { mapFields, planGridCopy, fieldIdsOf } from "../services/gridCopy.js";

let n = 0; const newId = () => `n${++n}`;

const sub = {
  occurrences: [
    { id: "page", moduleId: "pm", parentId: "folderA", occurrences: ["doc", "outside"], viewId: "v1", linkedGroupId: "g", meta: { feedSourceId: "x" } },
    { id: "doc", moduleId: "dm", parentId: "page", occurrences: [], fields: { fDate: { value: "2026-10-24" }, fGone: { value: 1 } },
      textmap: { type: "doc", content: [{ type: "moduleEmbed", attrs: { occurrenceId: "pic", instanceId: "picm" } }] } },
    { id: "pic", moduleId: "picm", parentId: null },
  ],
  modules: [
    { id: "pm", role: "page", kind: "board" },
    { id: "dm", role: "container", kind: "doc", fieldBindings: [{ fieldId: "fDate" }, { fieldId: "fGone" }] },
    { id: "picm", role: "artifact", kind: "image", fileRef: "/uploads/a.png" },
  ],
  views: [{ id: "v1", activeOccurrenceId: "doc" }],
};

describe("copying into another grid", () => {
  it("matches fields by name and type, and makes the ones the target lacks", () => {
    n = 0;
    const { map, created } = mapFields({
      fieldIds: ["fDate", "fNotes"],
      sourceFieldsById: { fDate: { id: "fDate", name: "Date", type: "date" }, fNotes: { id: "fNotes", name: "Notes", type: "text" } },
      targetFields: [{ id: "tDate", name: "Date", type: "date" }, { id: "tNotesNum", name: "Notes", type: "number" }],
      targetGridId: "G2", userId: "u", newId,
    });
    expect(map.get("fDate")).toBe("tDate");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: "Notes", type: "text", gridId: "G2" });
    expect(map.get("fNotes")).toBe(created[0].id);
  });

  it("gives every row, module and view a new id on the target grid, and keeps the links between them", () => {
    n = 0;
    const fieldMap = new Map([["fDate", "tDate"]]);
    const plan = planGridCopy({ rootId: "page", sub, fieldMap, targetGridId: "G2", userId: "u", parentId: "dropBox", newId });
    const byOld = (old) => plan.occurrences[sub.occurrences.findIndex((o) => o.id === old)];
    const page = byOld("page"); const doc = byOld("doc"); const pic = byOld("pic");
    expect(plan.rootId).toBe(page.id);
    expect(page.parentId).toBe("dropBox");
    expect(page.occurrences).toEqual([doc.id]);              // "outside" is not part of the copy
    expect(doc.parentId).toBe(page.id);
    expect(doc.textmap.content[0].attrs.occurrenceId).toBe(pic.id);
    expect(doc.fields).toEqual({ tDate: { value: "2026-10-24" } }); // a field the target cannot hold is left out
    expect(plan.modules.find((m) => m.kind === "doc").fieldBindings).toEqual([{ fieldId: "tDate" }]);
    expect(plan.views[0].activeOccurrenceId).toBe(doc.id);
    expect(page.viewId).toBe(plan.views[0].id);
    for (const o of plan.occurrences) expect(o.gridId).toBe("G2");
    expect(page.linkedGroupId).toBeUndefined();
    expect(page.meta.feedSourceId).toBeUndefined();
    expect(plan.modules.every((m) => !["pm", "dm", "picm"].includes(m.id))).toBe(true);
  });

  it("collects the fields the subtree uses", () => {
    expect(fieldIdsOf(sub).sort()).toEqual(["fDate", "fGone"]);
  });
});
