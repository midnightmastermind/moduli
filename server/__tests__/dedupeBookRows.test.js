import { describe, it, expect } from "vitest";
import { planBookDedupe, titleKeys, normaliseTitle, MIN_KEY_LEN } from "../migrations/0265-dedupe-book-rows.mjs";

const row = (id, title, fieldCount = 5, userFields = []) => ({ id, title, fieldCount, userFields: new Set(userFields) });
const run = (rows) => planBookDedupe({ rows });

describe("normalisation", () => {
  it("collapses the three importers' spellings of one title", () => {
    // Calibre writes `_` for `:` and `'`; media.md appends a "(152)" count.
    const a = normaliseTitle("Don_t Sweat the Small Stuff ... And It_s All Small Stuff");
    const b = normaliseTitle("Don't Sweat the Small Stuff ... And It's All Small Stuff (152)");
    expect(a).toBe(b);
  });
  it("strips an author segment at EITHER end", () => {
    expect(titleKeys("Ryan Holiday - The Obstacle Is the Way")).toContain("the obstacle is the way");
    expect(titleKeys("Our Oriental Heritage - Will Durant")).toContain("our oriental heritage");
  });
  it("NEVER emits the author's own name as a key", () => {
    // "bernie sanders" is 14 characters and clears MIN_KEY_LEN, so emitting
    // both sides of an "Author - Title" split made every book by an author
    // match every other. On live data it chained "Our Revolution" to "The
    // Speech", and two Karl Pilkington books, and two V. Anton Spraul books.
    expect(titleKeys("Bernie Sanders - The Speech: A Historic Filibuster"))
      .not.toContain("bernie sanders");
    expect(titleKeys("The Further Adventures of an Idiot - Karl Pilkington"))
      .not.toContain("karl pilkington");
  });

  it("keeps the TITLE side whichever end the author is written at", () => {
    expect(titleKeys("Ryan Holiday - The Obstacle Is the Way")).toContain("the obstacle is the way");
    expect(titleKeys("Our Oriental Heritage - Will Durant")).toContain("our oriental heritage");
  });

  it("never emits a key short enough to match half the shelf", () => {
    expect(titleKeys("Bob - Yes").every((k) => k.length >= MIN_KEY_LEN)).toBe(true);
  });
});

describe("planBookDedupe", () => {
  it("groups a media.md truncation with its full title and keeps the RICHEST row", () => {
    const { groups } = run([
      row("trunc", "The Meaning of Happiness: The Q", 5),
      row("full", "The Meaning of Happiness: The Quest For Freedom Of The Spirit", 7),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].keep.id).toBe("full");          // richest, NOT longest-first by accident
    expect(groups[0].drop.map((d) => d.id)).toEqual(["trunc"]);
  });

  it("keeps the richest row even when the POORER one has the longer title", () => {
    // The bug the first dry run exposed: ranking by title length kept the
    // Calibre filename spelling (5 fields) over the clean one (7).
    const { groups } = run([
      row("mangled", "Don_t Sweat the Small Stuff ... And It_s All Small Stuff Extra Words", 5),
      row("clean", "Don't Sweat the Small Stuff", 7),
    ]);
    expect(groups[0].keep.id).toBe("clean");
  });

  it("NEVER groups two volumes of the same series", () => {
    // The discriminating case. A 30-char shared-prefix rule merges these and
    // destroys a distinct book; a true-prefix rule cannot.
    const { groups } = run([
      row("v1", "Jesus Christ in the Name of the Gun 01 (2009)", 6),
      row("v2", "Jesus Christ in the Name of the Gun v02", 6),
    ]);
    expect(groups).toEqual([]);
  });

  it("matches only on a WORD BOUNDARY", () => {
    const { groups } = run([
      row("a", "The Life of Greece", 6),
      row("b", "The Life of Greeceland Adventures", 6),
    ]);
    expect(groups).toEqual([]);
  });

  it("REFUSES a group when a doomed row holds user data the survivor lacks", () => {
    // THE GUARD. Without a case that makes it fire, "0 refusals" on live data
    // is indistinguishable from a guard that cannot fire at all.
    const { groups, refusals } = run([
      row("rich", "The Wisdom of Insecurity: A Message for an Age of Anxiety", 9, ["f-owned"]),
      row("rated", "The Wisdom of Insecurity", 4, ["f-owned", "f-rating"]),
    ]);
    expect(groups).toEqual([]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].lost[0].field).toBe("f-rating");
  });

  it("does NOT refuse when the survivor already carries everything", () => {
    // The control for the test above — otherwise "refuses" could mean "always".
    const { groups, refusals } = run([
      row("rich", "The Wisdom of Insecurity: A Message for an Age of Anxiety", 9, ["f-owned", "f-rating"]),
      row("thin", "The Wisdom of Insecurity", 4, ["f-owned"]),
    ]);
    expect(refusals).toEqual([]);
    expect(groups[0].keep.id).toBe("rich");
  });

  it("accepts a MID-WORD prefix only at the truncation width", () => {
    // media.md cuts at a fixed width and does not respect words, so the cut
    // itself is the evidence. 30 characters => a truncation.
    const { groups } = run([
      row("full", "The Varieties of Religious Experience: A Study in Human Nature", 7),
      row("trunc", "The Varieties of Religious Expe", 5),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].drop[0].id).toBe("trunc");
  });

  it("still refuses a mid-word prefix that is NOT at the truncation width", () => {
    // The control for the rule above: without the width window this widens into
    // "any prefix at all" and starts eating real books.
    const { groups } = run([
      row("a", "The Life of Greece", 6),
      row("b", "The Life of Greeceland Adventures Continue On", 6),
    ]);
    expect(groups).toEqual([]);
  });

  it("REFUSES a truncation that fits two different books", () => {
    // A 30-char cut can be a prefix of volume 01 AND volume 02. Assigning it to
    // whichever survivor happens to be richest is a guess, and a guess deletes
    // a real row.
    const { groups, refusals } = run([
      row("v1", "Jesus Christ in the Name of the Gun 01 Collected Edition", 7),
      row("v2", "Jesus Christ in the Name of the Sun 02 Collected Edition", 6),
      row("cut", "Jesus Christ in the Name of th", 4),
    ]);
    expect(groups).toEqual([]);
    expect(refusals.length).toBeGreaterThan(0);
    expect(refusals.some((r) => r.ambiguous?.length)).toBe(true);
  });

  it("REFUSES a companion work — a journal is not a duplicate of the book", () => {
    // "The Daily Stoic" and "The Daily Stoic Journal: 366 Days" are different
    // books, and the second is a clean word-boundary extension of the first —
    // exactly the shape this merges. Without this guard it deletes a real book.
    const { groups, refusals } = run([
      row("book", "The Daily Stoic", 6),
      row("journal", "The Daily Stoic Journal 366 Days", 5),
    ]);
    expect(groups).toEqual([]);
    expect(refusals[0].companions.map((c) => c.id)).toEqual(["journal"]);
  });

  it("does NOT refuse when the survivor carries the same word — the control", () => {
    // "The Pragmatist's Guide to Life" vs a truncated "The Pragmatist's Guide"
    // is one book. One-directional, or every subtitle becomes a refusal.
    const { groups } = run([
      row("full", "The Pragmatists Guide to Life A Guide to Creating Your Own", 7),
      row("cut", "The Pragmatists Guide", 5),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].drop[0].id).toBe("cut");
  });

  it("a lone title is never a group", () => {
    expect(run([row("only", "A Book Nobody Duplicated")]).groups).toEqual([]);
  });

  it("is deterministic across a re-run when rows tie on everything", () => {
    const rows = [row("bbb", "Same Exact Title Here", 5), row("aaa", "Same Exact Title Here", 5)];
    expect(run(rows).groups[0].keep.id).toBe(run([...rows].reverse()).groups[0].keep.id);
  });
});
