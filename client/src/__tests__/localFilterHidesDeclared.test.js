// EVERY condition-bearing filter entry on the live grid must DECLARE `hides`.
//
// User, 2026-08-22: *"i dont want backwards compatible. that creates bug"*. So `hides` has
// no default. That is only true as long as the DATA is complete — a flag that is merely
// "usually present" is an implicit default with extra steps, and the next entry someone
// creates without it silently takes one of the two behaviours.
//
// This is the guard that keeps it complete. It reads the live fixture, so it fails the day
// an entry is added without the flag rather than six weeks later on a screen.
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

let entries;
beforeAll(() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fx = JSON.parse(brotliDecompressSync(readFileSync(path.join(here, "fixtures", "pomsGrid.json.br"))).toString("utf8"));
  entries = fx.occurrences.flatMap((o) =>
    (o.filters || []).map((f) => ({ occ: o.label ?? o.id, f })));
});

describe("every live condition filter declares whether it hides", () => {
  it("the grid carries condition-bearing entries at all — the control", () => {
    // Without this, "none are undeclared" is vacuously true of an empty list.
    expect(entries.filter((e) => e.f?.condition != null).length).toBeGreaterThan(0);
  });

  it("not one of them leaves `hides` undeclared", () => {
    const undeclared = entries
      .filter((e) => e.f?.condition != null && typeof e.f.hides !== "boolean")
      .map((e) => `${e.occ}: ${e.f.id ?? "(no id)"}`);
    expect(undeclared).toEqual([]);
  });

  it("a PLAIN entry needs no flag — it has no condition to gate", () => {
    const plain = entries.filter((e) => e.f?.condition == null);
    expect(plain.every((e) => e.f.fieldId || e.f.active === false)).toBe(true);
  });
});
