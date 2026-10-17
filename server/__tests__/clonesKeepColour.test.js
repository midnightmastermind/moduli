import { describe, it, expect } from "vitest";
import { healCloneStyle } from "../migrations/0415-clones-keep-their-colour.mjs";

const src = { id: "s", styleMode: "own", ownStyle: { bg: "#98431f" } };
describe("0415 healCloneStyle", () => {
  it("an unstyled clone gets its source's style", () => {
    expect(healCloneStyle({ id: "c", styleMode: "inherit" }, src)).toEqual({ styleMode: "own", ownStyle: { bg: "#98431f" } });
  });
  it("a clone styled on its own is left alone", () => {
    expect(healCloneStyle({ id: "c", styleMode: "own", ownStyle: { bg: "#111" } }, src)).toBeNull();
  });
  it("nothing to copy from an unstyled source", () => {
    expect(healCloneStyle({ id: "c" }, { id: "s", styleMode: "inherit" })).toBeNull();
  });
});
