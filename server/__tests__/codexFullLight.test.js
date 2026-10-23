import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listNotes, noteTitle } from "../migrations/0429-codex-full-light.mjs";

describe("0429 — the whole codex, light", () => {
  it("lists every .md / .txt note with its first two folder levels as its folder (deeper ones fold in)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-"));
    const put = (p, s = "x") => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), s); };
    put("top.md"); put("health/sleep.md"); put("environment/inventory/library/Books/Dune.md"); put("misc/a.txt"); put("misc/pic.png");
    const notes = listNotes(root);
    expect(notes.map((n) => [n.relPath, n.folderKey])).toEqual([
      ["environment/inventory/library/Books/Dune.md", "environment/inventory"],
      ["health/sleep.md", "health"],
      ["misc/a.txt", "misc"],
      ["top.md", ""],
    ]);
  });

  it("names a page after its file, else its first heading", () => {
    expect(noteTitle("health/sleep.md")).toBe("sleep");
    expect(noteTitle("misc/a.txt")).toBe("a");
    expect(noteTitle("x/.md", "# Rewards number\nabc")).toBe("Rewards number");
  });
});
