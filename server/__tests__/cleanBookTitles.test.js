import { describe, it, expect } from "vitest";
import { cleanBookTitle, looksUnrecoverable } from "../migrations/0270-clean-book-titles.mjs";

const AUTHORS = new Set(["george orwell", "carl sagan", "alan w watts", "alan watts", "unknown", "karl pilkington"]);
const clean = (t) => cleanBookTitle(t, AUTHORS);

describe("cleanBookTitle — removes import debris", () => {
  it("decodes the mangled &#039; that lost its & and ;", () => {
    expect(clean("[Guruslodge.com]1. Assassin: #039 s Creed Renaissance (Book 1)"))
      .toBe("Assassin's Creed Renaissance (Book 1)");
  });
  it("strips a trailing hash blob a downloader appended", () => {
    expect(clean("7 Habits of Highly Effective People_VSB5ASBCMOFDOZ5TTY2VBHI2EXFEJOAE"))
      .toBe("7 Habits of Highly Effective People");
  });
  it("strips a known publisher glued on with a hyphen", () => {
    expect(clean("Our Revolution: A Future to Believe In-Thomas Dunne Books"))
      .toBe("Our Revolution: A Future to Believe In");
  });
  it("restores an underscore standing for an apostrophe or a colon", () => {
    expect(clean("Caliban_s War")).toBe("Caliban's War");
    expect(clean("The 5 Love Languages_ The Secret to Love")).toBe("The 5 Love Languages: The Secret to Love");
  });
  it("strips an author segment at EITHER end — but only a KNOWN author", () => {
    expect(clean("Animal Farm - George Orwell")).toBe("Animal Farm");
    expect(clean("Carl Sagan - Cosmos")).toBe("Cosmos");
    // Not in the pool: left completely alone rather than guessed at.
    expect(clean("Some Title - Nigel Notinthepool")).toBe("Some Title - Nigel Notinthepool");
  });
});

describe("cleanBookTitle — the gaps a surviving duplicate exposed", () => {
  it("strips a publisher followed by a YEAR parenthetical", () => {
    // Anchoring the publisher at `$` alone missed every "-Publisher (2012)",
    // which is how a fourth copy of Tao: The Watercourse Way survived.
    expect(cleanBookTitle("Tao: the Watercourse Way-Souvenir Press (2012_2010)", AUTHORS))
      .toBe("Tao: the Watercourse Way");
  });

  it("recognises an author written 'Last, First'", () => {
    // Calibre writes it both ways; only "Alan Watts" was ever tested, so
    // "Watts, Alan - Tao…" kept its author and stayed a separate book.
    expect(cleanBookTitle("Watts, Alan - Tao: the Watercourse Way", AUTHORS))
      .toBe("Tao: the Watercourse Way");
  });

  it("collapses a subtitle that repeats verbatim", () => {
    expect(clean("Tao: The Watercourse Way: The Watercourse Way"))
      .toBe("Tao: The Watercourse Way");
  });

  it("does NOT collapse a subtitle that merely resembles the title", () => {
    // The control: only an EXACT repeat collapses.
    const t = "Tao: The Watercourse Way: A Study";
    expect(clean(t)).toBe(t);
  });
});

describe("cleanBookTitle — what it must NOT do", () => {
  it("NEVER eats a real title that ends in a dash phrase", () => {
    // THE CONTROL. A generic "strip trailing -Words" rule destroys all three,
    // which is why PUBLISHERS is an enumerated list and not a pattern.
    expect(clean("Six Pillars of Self-Esteem")).toBe("Six Pillars of Self-Esteem");
    expect(clean("Object-Oriented JavaScript")).toBe("Object-Oriented JavaScript");
    expect(clean("Tao Te Ching - Lao Tzu")).toBe("Tao Te Ching - Lao Tzu");
  });
  it("never empties or truncates a title to nothing", () => {
    expect(clean("Ish")).toBe("Ish");
    expect(clean("A - George Orwell")).toBe("A - George Orwell"); // stripping would leave "A"
  });
  it("leaves a clean title byte-identical", () => {
    const t = "The Wisdom of Insecurity: A Message for an Age of Anxiety";
    expect(clean(t)).toBe(t);
  });
  it("is idempotent — cleaning twice changes nothing", () => {
    const once = clean("[Guruslodge.com]2. Assassin: #039 s Creed Brotherhood (Book 2)");
    expect(clean(once)).toBe(once);
  });
});

describe("looksUnrecoverable", () => {
  it("flags a filename that is not a title", () => {
    expect(looksUnrecoverable("20220209104606372")).toBe(true);
    expect(looksUnrecoverable("temp1744025251402229693")).toBe(true);
  });
  it("does not flag a real title containing digits — the control", () => {
    expect(looksUnrecoverable("7 Habits of Highly Effective People")).toBe(false);
    expect(looksUnrecoverable("1984")).toBe(false);
  });
});
