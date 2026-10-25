import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// "Remove" (unlink) on an embed inside a wrap left a one-member group, which the schema repairs with an empty
// moduleEmbed drawn as "embed: missing" (user, 2026-10-25). It detaches the group member like the delete path does.
describe("Remove on an embed in a wrap", () => {
  const src = readFileSync(join(process.cwd(), "src/docs/ModuleEmbedNode.jsx"), "utf8");
  it("detaches the group member instead of deleting the bare node", () => {
    const at = src.indexOf('embedRemoval(occurrence, hostId) !== "delete"');
    expect(at).toBeGreaterThan(0);
    const branch = src.slice(at, at + 600);
    expect(branch).toMatch(/findGroupMember\(editor\.state\.doc, occurrenceId\)/);
    expect(branch).toMatch(/if \(member\) detachGroupMember\(editor, member\.groupPos, occurrenceId\);\s*else deleteNode\?\.\(\);/);
  });
});
