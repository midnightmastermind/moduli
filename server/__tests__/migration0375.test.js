import { describe, it, expect } from "vitest";
import { tokenSearches } from "../migrations/0375-lookup-search-tokens.mjs";
describe("0375 tokenSearches", () => {
  it("maps a token to the search inside `continue`", () => {
    const m = tokenSearches([{ url: "https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Daurora%2Bdewey%2Bcenter&q=EgRIh_REGNjVzM0GIijizFkLT_IDFV5mPhhSgiZrylzfuoAldnRo17m8Pvvg" }]);
    expect(m.get("egrih_regnjvzm0giijizfklt_idfv5mphhsgizrylzfuoaldnro17m8pvvg")).toBe("aurora dewey center");
  });
  // The control: an ordinary search is not a token and is not mapped.
  it("ignores ordinary searches", () => {
    expect(tokenSearches([{ url: "https://www.google.com/search?q=samsara" }]).size).toBe(0);
  });
});
