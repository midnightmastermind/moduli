// server/__tests__/transactionSchema.test.js
//
// Schema invariants the undo/redo path depends on. These are cheap assertions
// guarding an expensive lesson: the `minimize` one below was a SILENT
// correctness bug that every unit test passed and only an end-to-end run
// against a real database exposed.
import { describe, it, expect } from "vitest";
import Transaction from "../models/Transaction.js";

describe("Transaction schema — undo/redo invariants", () => {
  it("declares the snapshot fields undo restores from", () => {
    const paths = Transaction.schema.paths;
    expect(paths.docs).toBeDefined();
    expect(paths.actionId).toBeDefined();
    expect(paths.sequence).toBeDefined();
  });

  it("keeps EMPTY OBJECTS in snapshots (minimize:false on the docs subdocument)", () => {
    // Mongoose's default `minimize: true` DROPS empty objects on save, and it
    // does NOT inherit from the parent schema. Without this, a snapshot of an
    // occurrence whose `fields` is `{}` persists with no `fields` key at all —
    // so undo's `$set: before` has nothing to clear the field with and the
    // value the user just added SURVIVES the undo. Undo silently half-works.
    const docsSchema = Transaction.schema.path("docs").schema;
    expect(docsSchema.options.minimize).toBe(false);
  });

  it("stores before/after as Mixed so any entity shape round-trips", () => {
    const docsSchema = Transaction.schema.path("docs").schema;
    expect(docsSchema.path("before").instance).toBe("Mixed");
    expect(docsSchema.path("after").instance).toBe("Mixed");
  });

  it("indexes the stack query by sequence, not timestamp", () => {
    // Two writes can share a millisecond; a stack ordered by timestamp can skip
    // or repeat an undo step.
    const hasStackIndex = Transaction.schema.indexes().some(([spec]) =>
      spec.userId === 1 && spec.gridId === 1 && spec.state === 1 && spec.sequence === -1
    );
    expect(hasStackIndex).toBe(true);
  });
});
