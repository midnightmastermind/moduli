// server/__tests__/apiTokenParse.test.js
//
// A token is "moduli_<tokenId>_<secret>". mint() draws the id as 12 base64url
// characters, and base64url includes "_", so about 1 token in 6 had an id with
// "_" in it. parse() split on the FIRST "_", cut those ids short, and the token
// never authenticated (found 2026-11-06: a sweep's freshly minted token was
// refused with "Invalid or revoked token"; its id was "sG9drTxWOD3_").
import { describe, it, expect, vi, afterEach } from "vitest";
import bcrypt from "bcryptjs";
import ApiToken from "../models/ApiToken.js";

afterEach(() => vi.restoreAllMocks());

describe("ApiToken.parse", () => {
  it("reads a 12-character id that contains an underscore", () => {
    expect(ApiToken.parse("moduli_ab_cdefghijk_SECRET_x")).toEqual({ tokenId: "ab_cdefghijk", secret: "SECRET_x" });
  });
  it("reads an id that ends in an underscore", () => {
    expect(ApiToken.parse("moduli_sG9drTxWOD3__abc")).toEqual({ tokenId: "sG9drTxWOD3_", secret: "abc" });
  });
  it("still reads an ordinary token, whose secret may contain underscores", () => {
    expect(ApiToken.parse("moduli_abcdefghijkl_se_cr_et")).toEqual({ tokenId: "abcdefghijkl", secret: "se_cr_et" });
  });
  it("still reads an id of another length", () => {
    expect(ApiToken.parse("moduli_t-new_secret")).toEqual({ tokenId: "t-new", secret: "secret" });
  });
  it("refuses what is not a token", () => {
    expect(ApiToken.parse("bearer xyz")).toBeNull();
    expect(ApiToken.parse("moduli_")).toBeNull();
  });
});

describe("ApiToken.authenticate", () => {
  it("accepts a minted token whose id contains an underscore", async () => {
    const secret = "the_secret";
    const hash = await bcrypt.hash(secret, 4);
    const doc = { tokenId: "ab_cdefghijk", hash, lastUsedAt: new Date(), save: async () => {} };
    vi.spyOn(ApiToken, "findOne").mockImplementation(async (q) => {
      const ids = q.tokenId?.$in || [q.tokenId];
      return ids.includes(doc.tokenId) ? doc : null;
    });
    expect(await ApiToken.authenticate(`moduli_ab_cdefghijk_${secret}`)).toBe(doc);
  });
  it("refuses a wrong secret", async () => {
    const hash = await bcrypt.hash("right", 4);
    const doc = { tokenId: "abcdefghijkl", hash, lastUsedAt: new Date(), save: async () => {} };
    vi.spyOn(ApiToken, "findOne").mockImplementation(async () => doc);
    expect(await ApiToken.authenticate("moduli_abcdefghijkl_wrong")).toBeNull();
  });
});

describe("ApiToken.mint", () => {
  it("every minted token parses back to the id it was saved under", async () => {
    vi.spyOn(ApiToken.prototype, "save").mockImplementation(async function () { return this; });
    vi.spyOn(bcrypt, "hash").mockImplementation(async () => "h");
    for (let i = 0; i < 300; i++) {
      const { rawToken, tokenDoc } = await ApiToken.mint({ userId: "u1" });
      expect(ApiToken.parse(rawToken).tokenId).toBe(tokenDoc.tokenId);
    }
  });
});
