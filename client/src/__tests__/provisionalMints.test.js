/**
 * provisionalMints.test.js
 *
 * The bug this replaces: DocContent held its click-minted blocks in two SINGLE
 * SLOTS while the registry they feed is a map. A second click overwrote the
 * first id, so the first block leaked — and a leaked registry entry keeps
 * `hasProvisionalTextblock` true, which makes `Editor.persistContent` return
 * early FOREVER. The parent document stops saving and says nothing.
 */
import { describe, test, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createMintLedger } from "../helpers/provisionalMints";

describe("createMintLedger", () => {
  // THE DEFECT, stated directly: clicking several empty lines leaves several
  // provisional blocks, and ALL of them have to be discarded on unmount.
  test("drain hands back EVERY outstanding id, not just the last", () => {
    const l = createMintLedger();
    l.add("a", vi.fn()); l.add("b", vi.fn()); l.add("c", vi.fn());
    expect(l.size()).toBe(3);
    expect(l.drain().sort()).toEqual(["a", "b", "c"]);
    expect(l.size()).toBe(0);
  });

  test("drain cancels every pending write", () => {
    const a = vi.fn(), b = vi.fn();
    const l = createMintLedger();
    l.add("a", a); l.add("b", b);
    l.drain();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
  });

  // The second half of the defect: minting a block cancelled the PREVIOUS
  // block's writes, denying a block still on screen its server row.
  test("adding one block does not cancel another's writes", () => {
    const a = vi.fn();
    const l = createMintLedger();
    l.add("a", a);
    l.add("b", vi.fn());
    expect(a).not.toHaveBeenCalled();
  });

  test("a settled block is neither returned nor cancelled again", () => {
    const a = vi.fn(), b = vi.fn();
    const l = createMintLedger();
    l.add("a", a); l.add("b", b);
    l.settle("a");
    expect(l.drain()).toEqual(["b"]);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  // A cancel that throws must not strand the blocks behind it — draining is the
  // last chance any of them get.
  test("one throwing cancel does not stop the rest", () => {
    const boom = vi.fn(() => { throw new Error("nope"); });
    const ok = vi.fn();
    const l = createMintLedger();
    l.add("a", boom); l.add("b", ok);
    expect(l.drain().sort()).toEqual(["a", "b"]);
    expect(ok).toHaveBeenCalledTimes(1);
  });

  test("is inert for a missing id and a block with no cancel", () => {
    const l = createMintLedger();
    l.add(null); l.settle(null); l.settle("never-added");
    l.add("a");
    expect(l.drain()).toEqual(["a"]);
  });
});

// ── THE WIRING, WHICH NO TEST CAN MOUNT ────────────────────────────────────
//
// DocContent's mint path needs the whole grid store, so the ledger above is
// where the decision is testable — and a source guard is what stops the two
// single slots coming back and taking the fix with them.
describe("DocContent uses the ledger, not a single slot", () => {
  const src = readFileSync(resolve(__dirname, "../modules/DocContent.jsx"), "utf-8");

  test("the ledger is wired", () => {
    expect(src).toContain("createMintLedger");
    expect(src).toContain("ledger.drain()");
  });

  // The exact shapes that held only the LAST minted block.
  test("neither single slot is back", () => {
    expect(src).not.toContain("provisionalOccIdRef");
    expect(src).not.toContain("mintWritesRef");
  });

  // The CONTROL: without it, "no single slot" also passes against a file where
  // the whole mint path was deleted.
  test("the mint path is still there", () => {
    expect(src).toContain("registerProvisionalTextblock");
    expect(src).toContain("handleCaretMintTextblock");
  });
});
