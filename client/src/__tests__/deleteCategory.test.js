// Deleting a field / operation CATEGORY (a category folder) puts its members in Uncategorized
// (folderId null) and then deletes the folder — one undo step. There was no delete at all
// (2026-10-15), and the server deletes only the folder record, so members must be moved first.
import { describe, it, expect, vi, beforeEach } from "vitest";
const emits = [];
const CH = await import("../helpers/CommitHelpers");
const SOCK = { connected: true, emit: (ev, p) => emits.push([ev, p]) };
beforeEach(() => { emits.length = 0; });
describe("deleteCategory", () => {
  it("uncategorizes every member, then deletes the folder, all under one action", () => {
    const folder = { id: "cat1", name: "Body", folderType: "category" };
    CH.deleteCategory({ dispatch: () => {}, socket: SOCK, folder, fields: [{ id: "f1", name: "A", folderId: "cat1" }, { id: "f2", name: "B", folderId: "cat1" }], operations: [{ id: "o1", name: "Op", folderId: "cat1" }] });
    const evs = emits.map((e) => e[0]);
    expect(evs.filter((e) => e === "update_field")).toHaveLength(2);
    expect(evs).toContain("update_operation");
    expect(evs.at(-1)).toBe("delete_folder");
    for (const [ev, p] of emits) if (ev !== "delete_folder") expect((p.field || p.operation).folderId).toBeNull();
    const ids = new Set(emits.map((e) => e[1].__actionId));
    expect(ids.size).toBe(1); expect([...ids][0]).toBeTruthy();
  });
  it("CONTROL — a non-category folder is refused", () => {
    CH.deleteCategory({ dispatch: () => {}, socket: SOCK, folder: { id: "x", folderType: "manifest" }, fields: [] });
    expect(emits).toHaveLength(0);
  });
});

import fs from "node:fs"; import path from "node:path";
describe("wiring", () => {
  it("both tabs' category headers offer delete, which goes through deleteCategory", () => {
    for (const f of ["FieldsTab.jsx", "OperationsTab.jsx"]) {
      const src = fs.readFileSync(path.join(__dirname, "../ui/commandCenter", f), "utf8");
      expect(src).toMatch(/onDelete=\{folderObj \? \(\) => CommitHelpers\.deleteCategory\(/);
    }
    const h = fs.readFileSync(path.join(__dirname, "../ui/commandCenter/CategoryColumnHeader.jsx"), "utf8");
    expect(h).toMatch(/title="Delete category"/);
  });
});
