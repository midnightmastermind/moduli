// The field type list lived in two hand-written copies and both had drifted to
// eight while the server enum had eleven — so `address`, `markdown` and
// `button` could not be created by a user at all. This reads the enum out of
// the model and fails if the client list drifts from it again.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIELD_TYPES, ASSISTANT_FIELD_TYPES } from "../helpers/fieldTypes.js";

function serverEnum() {
  const src = readFileSync(join(process.cwd(), "..", "server", "models", "Field.js"), "utf8");
  // The `type` field's enum — the first `enum: [...]` after "Field data type".
  const m = src.slice(src.indexOf("Field data type")).match(/enum:\s*\[([^\]]+)\]/);
  if (!m) throw new Error("could not find the type enum in server/models/Field.js");
  return m[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

describe("field types", () => {
  it("reads the server enum (the probe works)", () => {
    // A comparison against an empty list would pass vacuously.
    expect(serverEnum().length).toBeGreaterThan(5);
  });

  it("offers exactly what the schema allows", () => {
    expect([...FIELD_TYPES].sort()).toEqual([...serverEnum()].sort());
  });

  it("the assistant's narrower set is a real subset", () => {
    for (const t of ASSISTANT_FIELD_TYPES) expect(FIELD_TYPES).toContain(t);
    expect(ASSISTANT_FIELD_TYPES.length).toBeLessThan(FIELD_TYPES.length);
  });
});
