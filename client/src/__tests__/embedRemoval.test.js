// "Remove" on a row embedded in a doc: a row the doc OWNS is deleted; a row
// referenced from elsewhere is only unlinked. Unlinking an owned Check In left
// it alive with its mood lit on the Emotions Wheel (user, 2026-09-19).
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { embedRemoval, hostOccurrenceIdOf } from "../helpers/embedRegistry";

describe("embedRemoval", () => {
  it("deletes a row the host doc owns", () => {
    expect(embedRemoval({ id: "ci", parentId: "col" }, "col")).toBe("delete");
  });
  // THE CONTROL: a row living elsewhere is only unlinked from this doc.
  it("only unlinks a row that lives elsewhere", () => {
    expect(embedRemoval({ id: "task", parentId: "schedule-slot" }, "col")).toBe("unlink");
  });
  it("unlinks when the host is unknown", () => {
    expect(embedRemoval({ id: "ci", parentId: "col" }, null)).toBe("unlink");
  });
});

describe("hostOccurrenceIdOf", () => {
  it("is the nearest [data-occ-id] ABOVE the editor root, not the root's own embeds", () => {
    document.body.innerHTML = `<div data-occ-id="col"><div class="wrap">
      <div id="pm" class="ProseMirror"><div data-occ-id="ci"></div></div></div></div>`;
    expect(hostOccurrenceIdOf({ view: { dom: document.getElementById("pm") } })).toBe("col");
  });
});

describe("the embedded instance row uses it", () => {
  const src = readFileSync(resolve(__dirname, "../docs/ModuleEmbedNode.jsx"), "utf-8");
  it("passes removeRow, not the bare deleteNode, to an instance row", () => {
    const at = src.indexOf('mod?.role === "instance" ? (');
    const branch = src.slice(at, src.indexOf("/>", at));
    expect(branch).toContain("embedOnDelete={removeRow}");
  });
  it("removeRow deletes through removeOccurrence when owned", () => {
    const body = src.slice(src.indexOf("const removeRow = useCallback"), src.indexOf("// Resize drag state"));
    expect(body).toContain('embedRemoval(occurrence, hostId) !== "delete"');
    expect(body).toContain("CommitHelpers.removeOccurrence(");
  });
});
