import { describe, test, expect, beforeEach, vi } from "vitest";
import {
  registerProvisionalTextblock, isProvisionalTextblock,
  commitProvisionalTextblock, discardProvisionalTextblock, forgetProvisionalTextblock,
  suppressTextblockMint, isTextblockMintSuppressed,
  isEmptyTextblockDoc, hasProvisionalTextblock,
  _resetProvisionalTextblocks,
} from "../helpers/provisionalTextblock";

const doc = (...content) => ({ type: "doc", content });
const para = (text) => (text
  ? { type: "paragraph", content: [{ type: "text", text }] }
  : { type: "paragraph", content: [] });
const block = (occurrenceId) => ({ type: "instanceTextblock", attrs: { occurrenceId, instanceId: "m" } });

beforeEach(() => _resetProvisionalTextblocks());

describe("provisional registry", () => {
  test("commit runs the commit side ONCE and forgets the block", () => {
    const commit = vi.fn();
    const discard = vi.fn();
    registerProvisionalTextblock("o1", { commit, discard });
    expect(isProvisionalTextblock("o1")).toBe(true);

    expect(commitProvisionalTextblock("o1", doc(para("hi")))).toBe(true);
    expect(commit).toHaveBeenCalledWith(doc(para("hi")));
    expect(discard).not.toHaveBeenCalled();
    // The save path calls this on every keystroke — the second call must be a
    // no-op, not a second create.
    expect(commitProvisionalTextblock("o1", doc(para("hi there")))).toBe(false);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(isProvisionalTextblock("o1")).toBe(false);
  });

  test("discard runs the discard side once, and cannot run after a commit", () => {
    const commit = vi.fn();
    const discard = vi.fn();
    registerProvisionalTextblock("o1", { commit, discard });

    expect(discardProvisionalTextblock("o1")).toBe(true);
    expect(discard).toHaveBeenCalledTimes(1);
    expect(discardProvisionalTextblock("o1")).toBe(false);
    expect(discard).toHaveBeenCalledTimes(1);

    // A committed block is no longer provisional: blurring it empty later must
    // NOT delete the row it earned.
    registerProvisionalTextblock("o2", { commit, discard });
    commitProvisionalTextblock("o2", doc(para("x")));
    expect(discardProvisionalTextblock("o2")).toBe(false);
    expect(discard).toHaveBeenCalledTimes(1);
  });

  test("forget drops the entry without running either side", () => {
    const commit = vi.fn();
    const discard = vi.fn();
    registerProvisionalTextblock("o1", { commit, discard });
    expect(forgetProvisionalTextblock("o1")).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    expect(discard).not.toHaveBeenCalled();
    expect(isProvisionalTextblock("o1")).toBe(false);
  });

  test("an unknown id is never provisional", () => {
    expect(isProvisionalTextblock("nope")).toBe(false);
    expect(isProvisionalTextblock(null)).toBe(false);
    expect(commitProvisionalTextblock("nope")).toBe(false);
    expect(discardProvisionalTextblock("nope")).toBe(false);
  });
});

describe("mint suppression", () => {
  test("suppresses for the requested window, then releases", () => {
    const t0 = Date.now();
    expect(isTextblockMintSuppressed(null, t0)).toBe(false);
    suppressTextblockMint(null, 600);
    expect(isTextblockMintSuppressed(null, t0 + 100)).toBe(true);
    expect(isTextblockMintSuppressed(null, t0 + 700)).toBe(false);
  });

  // The reported bug (2026-08-06): clicking a DIFFERENT empty line right after
  // abandoning one produced nothing — the collapse armed a blanket window and
  // the new line's mint was skipped. Suppression is per-LINE now.
  test("suppresses ONLY the line it was armed for", () => {
    const t0 = Date.now();
    suppressTextblockMint(42, 600);
    expect(isTextblockMintSuppressed(42, t0 + 100)).toBe(true);   // the collapsed line
    expect(isTextblockMintSuppressed(99, t0 + 100)).toBe(false);  // a different line
    expect(isTextblockMintSuppressed(42, t0 + 700)).toBe(false);  // window elapsed
  });

  test("a caller that cannot say WHERE still suppresses everywhere", () => {
    const t0 = Date.now();
    suppressTextblockMint(null, 600);
    expect(isTextblockMintSuppressed(99, t0 + 100)).toBe(true);
  });
});

describe("isEmptyTextblockDoc", () => {
  test("empty docs and empty paragraphs are empty", () => {
    expect(isEmptyTextblockDoc(null)).toBe(true);
    expect(isEmptyTextblockDoc({ type: "doc" })).toBe(true);
    expect(isEmptyTextblockDoc(doc())).toBe(true);
    expect(isEmptyTextblockDoc(doc(para()))).toBe(true);
    expect(isEmptyTextblockDoc(doc(para(), para()))).toBe(true);
  });

  test("any text keeps the block", () => {
    expect(isEmptyTextblockDoc(doc(para("a")))).toBe(false);
    expect(isEmptyTextblockDoc(doc(para(), para("a")))).toBe(false);
  });

  test("a doc with no characters but real content is NOT empty", () => {
    // A dropped image / embed / an empty list item is worth keeping — the
    // vanish-on-blur rule is about lines the user never used, not about text.
    expect(isEmptyTextblockDoc(doc({ type: "image", attrs: { src: "x.png" } }))).toBe(false);
    expect(isEmptyTextblockDoc(doc({ type: "bulletList", content: [] }))).toBe(false);
    expect(isEmptyTextblockDoc(doc(block("o1")))).toBe(false);
  });
});

describe("hasProvisionalTextblock", () => {
  test("false when nothing is pending, whatever the doc holds", () => {
    expect(hasProvisionalTextblock(doc(block("o1"), para("x")))).toBe(false);
  });

  test("true only for a doc embedding a block that has no server row", () => {
    registerProvisionalTextblock("o1", { commit: () => {}, discard: () => {} });
    expect(hasProvisionalTextblock(doc(para("x"), block("o1")))).toBe(true);
    // A committed sibling must not hold the parent's save hostage.
    expect(hasProvisionalTextblock(doc(para("x"), block("o2")))).toBe(false);
  });

  test("finds a provisional block nested below the top level", () => {
    registerProvisionalTextblock("o1", { commit: () => {}, discard: () => {} });
    const nested = doc({ type: "wrapGroup", content: [block("o1"), para("host")] });
    expect(hasProvisionalTextblock(nested)).toBe(true);
  });

  test("releases the parent the moment the block commits", () => {
    registerProvisionalTextblock("o1", { commit: () => {}, discard: () => {} });
    const parent = doc(block("o1"));
    expect(hasProvisionalTextblock(parent)).toBe(true);
    commitProvisionalTextblock("o1", doc(para("typed")));
    expect(hasProvisionalTextblock(parent)).toBe(false);
  });
});
