import { describe, it, expect } from "vitest";
import { safeNext } from "../promo/pages/LoginRoute.jsx";

describe("after sign-in, ?next= only goes somewhere on this site", () => {
  it("follows a path on this site", () => {
    expect(safeNext("?next=" + encodeURIComponent("/share-pending?id=abc"))).toBe("/share-pending?id=abc");
  });
  it("refuses another site, a protocol-relative address and junk", () => {
    for (const n of ["https://evil.test/", "//evil.test/x", "/\\evil.test", "javascript:alert(1)", "share-pending", ""]) {
      expect(safeNext("?next=" + encodeURIComponent(n))).toBe("/");
    }
  });
  it("no next: the grid", () => { expect(safeNext("")).toBe("/"); });
});
