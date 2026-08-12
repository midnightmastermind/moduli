import { describe, it, expect } from "vitest";
import { assignQuestions } from "../migrations/0075-backfill-empty-daily-questions.mjs";

const pool = ["q1", "q2", "q3", "q4"];
const first = () => 0;   // deterministic: always take the head of the candidate list

describe("0075 assignQuestions", () => {
  it("gives each empty container a question", () => {
    const out = assignQuestions(["a", "b"], pool, { rand: first });
    expect(out.size).toBe(2);
    expect([...out.values()].every((v) => pool.includes(v))).toBe(true);
  });

  // Two consecutive days drawing the same question reads like the feature is
  // broken, which is the whole reason this is not a plain random pick.
  it("does not repeat within one run", () => {
    const out = assignQuestions(["a", "b", "c"], pool, { rand: first });
    expect(new Set(out.values()).size).toBe(3);
  });

  it("avoids questions already in use on other days", () => {
    const out = assignQuestions(["a"], pool, { inUse: ["q1", "q2"], rand: first });
    expect(["q3", "q4"]).toContain(out.get("a"));
  });

  it("falls back to a repeat rather than leaving a day empty when the pool runs dry", () => {
    const out = assignQuestions(["a", "b"], ["only"], { rand: first });
    expect(out.get("a")).toBe("only");
    expect(out.get("b")).toBe("only");
  });

  it("returns nothing for an empty pool rather than throwing", () => {
    expect(assignQuestions(["a"], [], { rand: first }).size).toBe(0);
  });

  it("returns nothing when there is nothing to fill", () => {
    expect(assignQuestions([], pool, { rand: first }).size).toBe(0);
  });

  it("stays in range for rand() at the top of its interval", () => {
    const out = assignQuestions(["a"], pool, { rand: () => 0.999999 });
    expect(pool).toContain(out.get("a"));
  });
});
