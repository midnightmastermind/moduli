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

describe("an embed whose row has not arrived yet", () => {
  const src = readFileSync(join(process.cwd(), "src/docs/ModuleEmbedNode.jsx"), "utf8");
  it("holds a quiet line before the 'embed: <id>' marker, which waits MISSING_MARKER_MS", () => {
    expect(src).toMatch(/export const MISSING_MARKER_MS = 3000;/);
    const quiet = src.indexOf("if (!mod && !missingLong)");
    const marker = src.indexOf('embed: {occurrenceId || "missing"}');
    expect(quiet).toBeGreaterThan(0);
    expect(quiet).toBeLessThan(marker); // control: the marker is still there for a row that never comes
  });
});
