// A create that would give one parent two children with the SAME
// identitySignature is refused.
//
// This is the shared create path, so the tests are weighted to the REFUSE side:
// a wrong refusal is a silently dropped write, which presents as data loss.
//
// A/B'd. The parent-must-exist narrowing, the subtree expansion and the
// same-id-is-not-a-duplicate rule each fail EXACTLY their own case. The
// unsigned case is different and is recorded rather than overstated: the source
// checks `!sig` in TWO places (the index build and the row loop) and they are
// REDUNDANT WITH EACH OTHER, so removing either alone changes nothing and this
// test passes against it. Only removing BOTH makes it fail. So that one pins
// the CONTRACT, not a line — defence in depth, not a fourth discriminating A/B,
// and calling it one would overstate the coverage.
import { describe, it, expect } from "vitest";
import { refusedDuplicateCreates, refusedByStoredSiblings } from "../utils/duplicateSignature.js";

const occ = (id, over = {}) => ({ id, parentId: null, identitySignature: null, ...over });
// A node whose CALLER declared the signature to be its identity here — what
// APPLY_TEMPLATE stamps when given `rootSignature`.
const uniq = (id, over = {}) => occ(id, { ...over, meta: { ...(over.meta || {}), signatureUnique: true } });
const create = (o) => ({ occurrence: o });

describe("refusedDuplicateCreates", () => {
  it("refuses a second child carrying a signature a sibling already has", () => {
    const cache = {
      board: occ("board"),
      col1: uniq("col1", { parentId: "board", identitySignature: "daypage:col:2026-09-03" }),
    };
    const out = refusedDuplicateCreates(
      [create(uniq("col2", { parentId: "board", identitySignature: "daypage:col:2026-09-03" }))],
      cache,
    );
    expect([...out]).toEqual(["col2"]);
  });

  // The case that makes the guard usable rather than a blanket block: a board
  // holds MANY applications of one template on purpose, one per date.
  it("allows a sibling whose signature differs", () => {
    const cache = {
      board: occ("board"),
      col1: uniq("col1", { parentId: "board", identitySignature: "daypage:col:2026-09-03" }),
    };
    const out = refusedDuplicateCreates(
      [create(uniq("col2", { parentId: "board", identitySignature: "daypage:col:2026-09-04" }))],
      cache,
    );
    expect(out.size).toBe(0);
  });

  it("allows the same signature under a DIFFERENT parent", () => {
    const cache = {
      a: occ("a"), b: occ("b"),
      x: uniq("x", { parentId: "a", identitySignature: "daypage:Journal" }),
    };
    const out = refusedDuplicateCreates(
      [create(uniq("y", { parentId: "b", identitySignature: "daypage:Journal" }))],
      cache,
    );
    expect(out.size).toBe(0);
  });

  // NARROWING 1 — an unsigned node has no declared identity.
  it("never refuses an UNSIGNED create", () => {
    const cache = { board: occ("board"), col1: occ("col1", { parentId: "board" }) };
    const out = refusedDuplicateCreates([create(occ("col2", { parentId: "board" }))], cache);
    expect(out.size).toBe(0);
  });

  // NARROWING 2 — the only (parentId, signature) collisions on live data are
  // groups whose parentId names nothing: eight weekday templates sharing a
  // hand-authored `day-container`, and two project pages.
  it("never refuses when the shared parent does not exist", () => {
    const cache = { t1: uniq("t1", { parentId: "gone", identitySignature: "day-container" }) };
    const out = refusedDuplicateCreates(
      [create(uniq("t2", { parentId: "gone", identitySignature: "day-container" }))],
      cache,
    );
    expect(out.size).toBe(0);
  });

  // A fresh subtree: parent and children arrive together, so nothing it
  // contains can duplicate anything that exists.
  it("never refuses rows whose parent is arriving in the same batch", () => {
    const cache = { board: occ("board") };
    const out = refusedDuplicateCreates([
      create(uniq("kid", { parentId: "newcol", identitySignature: "daypage:Journal" })),
      create(uniq("newcol", { parentId: "board", identitySignature: "daypage:col:2026-09-04", occurrences: ["kid"] })),
    ], cache);
    expect(out.size).toBe(0);
  });

  // NARROWING 3 — refusing only the root would persist orphans whose parent
  // never arrives, trading a visible duplicate for invisible debris.
  it("takes the refused root's whole subtree with it, depth-first emission included", () => {
    const cache = {
      board: occ("board"),
      col1: uniq("col1", { parentId: "board", identitySignature: "daypage:col:2026-09-03" }),
    };
    const out = refusedDuplicateCreates([
      // emitted leaves-first, exactly as APPLY_TEMPLATE emits them
      create(occ("grandkid", { parentId: "kid" })),
      create(occ("kid", { parentId: "dupe", occurrences: ["grandkid"] })),
      create(uniq("dupe", { parentId: "board", identitySignature: "daypage:col:2026-09-03", occurrences: ["kid"] })),
    ], cache);
    expect([...out].sort()).toEqual(["dupe", "grandkid", "kid"]);
  });

  // Two identical creates inside ONE burst — the shape a double-fire produces.
  it("collapses duplicates WITHIN a single batch to the first", () => {
    const cache = { board: occ("board") };
    const out = refusedDuplicateCreates([
      create(uniq("a", { parentId: "board", identitySignature: "daypage:col:2026-09-04" })),
      create(uniq("b", { parentId: "board", identitySignature: "daypage:col:2026-09-04" })),
    ], cache);
    expect([...out]).toEqual(["b"]);
  });

  // Re-sending the SAME id must not refuse itself — a retry is not a duplicate.
  it("does not refuse a re-send of the occurrence that already owns the signature", () => {
    const cache = {
      board: occ("board"),
      col1: uniq("col1", { parentId: "board", identitySignature: "daypage:col:2026-09-03" }),
    };
    const out = refusedDuplicateCreates(
      [create(uniq("col1", { parentId: "board", identitySignature: "daypage:col:2026-09-03" }))],
      cache,
    );
    expect(out.size).toBe(0);
  });

  // THE CASE THAT CAUGHT THE FIRST VERSION. Eight weekday/layer templates on
  // poms grid deliberately share `identitySignature: "day-container"` under ONE
  // REAL PAGE. Keyed on "any signature under an existing parent", the guard
  // refused a legitimate ninth — a dropped write presenting as data loss.
  it("never refuses a SHARED MARKER under a real parent (no opt-in flag)", () => {
    const cache = {
      tplPage: occ("tplPage"),
      mon: occ("mon", { parentId: "tplPage", identitySignature: "day-container" }),
      tue: occ("tue", { parentId: "tplPage", identitySignature: "day-container" }),
    };
    const out = refusedDuplicateCreates(
      [create(occ("sat", { parentId: "tplPage", identitySignature: "day-container" }))],
      cache,
    );
    expect(out.size).toBe(0);
  });

  // BOTH sides must opt in: honouring the flag on one side only would let a
  // shared marker refuse a declared-unique sibling and vice versa.
  it("does not refuse when only ONE side is declared unique", () => {
    const marker = { tplPage: occ("tplPage"), mon: occ("mon", { parentId: "tplPage", identitySignature: "day-container" }) };
    expect(refusedDuplicateCreates([create(uniq("sat", { parentId: "tplPage", identitySignature: "day-container" }))], marker).size).toBe(0);

    const declared = { tplPage: occ("tplPage"), mon: uniq("mon", { parentId: "tplPage", identitySignature: "day-container" }) };
    expect(refusedDuplicateCreates([create(occ("sat", { parentId: "tplPage", identitySignature: "day-container" }))], declared).size).toBe(0);
  });

  it("is empty for an empty or malformed batch", () => {
    expect(refusedDuplicateCreates([], {}).size).toBe(0);
    expect(refusedDuplicateCreates(null, {}).size).toBe(0);
    expect(refusedDuplicateCreates([{}, { occurrence: null }], {}).size).toBe(0);
  });
});

// ── THE CACHE IS NOT THE AUTHORITY ────────────────────────────────────────
//
// On 2026-09-09 poms grid grew a SECOND `daypage:col:2026-09-09` 94 seconds
// after the first. Both carried the signature, `meta.signatureUnique`, and a
// `parentId` that resolves — exactly the state `refusedDuplicateCreates` exists
// to reject. It answers from the warm cache, and the cache did not show the
// first one. Why is NOT established, so this asks the database instead.
describe("refusedByStoredSiblings — the net behind the cache", () => {
  const SIG = "daypage:col:2026-09-09";
  const uniqCreate = (id, over = {}) => ({ occurrence: {
    id, parentId: "board", identitySignature: SIG, meta: { signatureUnique: true }, ...over } });
  // A stand-in for the model: records the query so the shape can be asserted.
  const modelReturning = (rows) => { const calls = [];
    return { calls, find: (q, p) => { calls.push(q); return { lean: async () => rows }; } }; };

  it("refuses a create whose sibling is in the DB but not the cache", () => {
    const Occurrence = modelReturning([
      { id: "existing", parentId: "board", identitySignature: SIG, meta: { signatureUnique: true } }]);
    return refusedByStoredSiblings([uniqCreate("newcol")], { gridId: "g1", Occurrence })
      .then((r) => expect([...r]).toEqual(["newcol"]));
  });

  it("allows it when the DB has nothing — the control", () => {
    // Without this, "refuses duplicates" is also satisfied by a guard that
    // refuses every signed create and silently drops legitimate ones.
    const Occurrence = modelReturning([]);
    return refusedByStoredSiblings([uniqCreate("newcol")], { gridId: "g1", Occurrence })
      .then((r) => expect(r.size).toBe(0));
  });

  it("never refuses a row against ITSELF — a retry is idempotent", () => {
    const Occurrence = modelReturning([
      { id: "newcol", parentId: "board", identitySignature: SIG, meta: { signatureUnique: true } }]);
    return refusedByStoredSiblings([uniqCreate("newcol")], { gridId: "g1", Occurrence })
      .then((r) => expect(r.size).toBe(0));
  });

  it("uniqueness stays OPT-IN on the STORED side too", () => {
    // `0303`'s line. A signature is also a shared MARKER — eight weekday
    // templates share `day-container` on purpose. A stored row that never
    // claimed uniqueness cannot refuse anything.
    const Occurrence = modelReturning([
      { id: "existing", parentId: "board", identitySignature: SIG }]);
    return refusedByStoredSiblings([uniqCreate("newcol")], { gridId: "g1", Occurrence })
      .then((r) => expect(r.size).toBe(0));
  });

  it("queries nothing at all when no create opts in", async () => {
    // The cost argument: a batch with no signed-unique create must not touch
    // the database, or every drop pays for this.
    const Occurrence = modelReturning([]);
    const plain = { occurrence: { id: "x", parentId: "board" } };
    const r = await refusedByStoredSiblings([plain], { gridId: "g1", Occurrence });
    expect(r.size).toBe(0);
    expect(Occurrence.calls).toEqual([]);
  });

  it("skips a create the pure pass already refused", async () => {
    const Occurrence = modelReturning([]);
    await refusedByStoredSiblings([uniqCreate("dup")],
      { gridId: "g1", Occurrence, already: new Set(["dup"]) });
    expect(Occurrence.calls).toEqual([]);
  });

  it("one indexed query per batch, not one per row", async () => {
    const Occurrence = modelReturning([]);
    await refusedByStoredSiblings(
      [uniqCreate("a"), uniqCreate("b"), uniqCreate("c")], { gridId: "g1", Occurrence });
    expect(Occurrence.calls).toHaveLength(1);
    expect(Occurrence.calls[0].gridId).toBe("g1");
    expect(Occurrence.calls[0].parentId.$in).toEqual(["board"]);
  });
});
