import { test, expect } from "vitest";
import { rowsUnder } from "../migrations/0450-tasks-rows-copylink.mjs";

test("walks containers under the page and returns only instances", () => {
  const occs = [
    { id: "page", moduleId: "p", occurrences: ["box", "loose"] },
    { id: "box", moduleId: "c", occurrences: ["a", "inner"] },
    { id: "inner", moduleId: "c", occurrences: ["b"] },
    { id: "a", moduleId: "i" }, { id: "b", moduleId: "i" }, { id: "loose", moduleId: "i" },
    { id: "elsewhere", moduleId: "i" },
  ];
  const role = (m) => ({ p: "page", c: "container", i: "instance" })[m];
  expect(rowsUnder(["page"], occs, role).sort()).toEqual(["a", "b", "loose"]);
});
