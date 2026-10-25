// Deleting a page from its radial menu, the file tree, a folder card or a headset shelf is ONE delete
// (helpers/confirmDeleteOccurrence → CommitHelpers.deleteOccurrence). The old `delete_page` path unpinned from one
// panel, trashed the module and recorded no undo — it must not come back.
import fs from "fs";
import path from "path";
import { describe, it, expect, vi } from "vitest";

const read = (f) => fs.readFileSync(path.join(process.cwd(), "src", f), "utf8");

describe("one delete for pages and books", () => {
  it("the page radial, the file tree, folder cards and the shelf all use confirmDeleteOccurrence's delete", () => {
    expect(read("modules/ModulePage.jsx")).toMatch(/confirmDeleteOccurrence\(\{ occurrence, module: pageModule/);
    expect(read("modules/ManifestTree.jsx")).toMatch(/confirmDeleteOccurrence\(/);
    expect(read("modules/PreviewNode.jsx")).toMatch(/confirmDeleteOccurrence\(/);
    expect(read("vr/NativeOffice.jsx")).toMatch(/deleteOccurrenceEverywhere\(/);
  });
  it("no client code emits delete_page any more", () => {
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? (e.name === "__tests__" ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]);
    const hits = walk(path.join(process.cwd(), "src")).filter((f) => /\.(js|jsx)$/.test(f) && /"delete_page"/.test(fs.readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
  it("asks, then deletes through CommitHelpers.deleteOccurrence", async () => {
    vi.resetModules();
    const del = vi.fn();
    vi.doMock("../helpers/CommitHelpers.js", () => ({ deleteOccurrence: del }));
    const { confirmDeleteOccurrence, deleteOccurrenceEverywhere } = await import("../helpers/confirmDeleteOccurrence.js");
    const occ = { id: "p1", label: "Page" };
    expect(await confirmDeleteOccurrence({ occurrence: occ, dispatch: () => {}, socket: {}, confirm: () => false })).toBe(false);
    expect(del).not.toHaveBeenCalled();
    expect(await confirmDeleteOccurrence({ occurrence: occ, dispatch: () => {}, socket: {}, confirm: async () => true })).toBe(true);
    expect(deleteOccurrenceEverywhere({ occurrence: occ, dispatch: () => {}, socket: {} })).toBe(true);
    expect(del).toHaveBeenCalledTimes(2);
    expect(del.mock.calls[0][0]).toMatchObject({ occurrenceId: "p1" });
    vi.doUnmock("../helpers/CommitHelpers.js");
  });
});
