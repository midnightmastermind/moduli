// The search routes, driven through the REAL router — the same in-process
// dispatch the other API tests use. A STUB provider stands in for the network:
// what is under test is the routing and the merge, not Wikipedia.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { makeApiV1Router } from "../routes/apiV1.js";
import { registerProvider, PROVIDERS } from "../utils/searchProviders.js";

const USER = "u1";
let searchCalls = [];

function makeRouter() {
  return makeApiV1Router({
    getUserCache: async () => ({ _loaded: true }),
    peekUserCache: () => null,
    io: { to: () => ({ emit: () => {} }), sockets: { adapter: { rooms: new Map() } } },
    userRoom: (u) => `user:${u}`,
    opRunBridge: { await: async () => ({}) },
  });
}

/** Unlike the ingest harness, this one PARSES the query string — the routes read it. */
function call(router, path) {
  return new Promise((resolve) => {
    const [pathname, qs = ""] = path.split("?");
    const query = Object.fromEntries(new URLSearchParams(qs));
    const req = { method: "GET", url: path, originalUrl: path, path: pathname,
      headers: {}, apiToken: { tokenId: "t1", scopes: ["read", "write"] },
      userId: USER, body: {}, query, params: {}, get: () => undefined };
    let statusCode = 200;
    const res = {
      get statusCode() { return statusCode; },
      status(c) { statusCode = c; return this; },
      json(p) { resolve({ status: statusCode, body: p }); return this; },
      send(p) { resolve({ status: statusCode, body: p }); return this; },
      setHeader() { return this; }, getHeader() { return null; },
      end() { resolve({ status: statusCode, body: null }); return this; },
    };
    router.handle(req, res, () => resolve({ status: 404, body: null }));
  });
}

beforeEach(() => {
  searchCalls = [];
  registerProvider({
    id: "stub", label: "Stub",
    search: async (q, opts) => {
      searchCalls.push({ q, opts });
      return [
        { provider: "stub", externalId: "1", title: "Alpha", subtitle: null, thumbnail: null, url: null, fields: {} },
        { provider: "stub", externalId: "2", title: "Beta", subtitle: null, thumbnail: null, url: null, fields: {} },
      ];
    },
    detail: async ({ externalId }) => (externalId === "1"
      ? { provider: "stub", externalId: "1", title: "Alpha", fields: { Director: "Someone" } } : null),
  });
});
afterEach(() => { delete PROVIDERS.stub; });

describe("GET /search/:provider", () => {
  it("returns the provider's results", async () => {
    const r = await call(makeRouter(), "/search/stub?q=al");
    expect(r.status).toBe(200);
    expect(r.body.results.map((x) => x.title)).toEqual(["Alpha", "Beta"]);
  });

  it("APPLIES THE MERGE RULE — a result the grid already holds is not offered", async () => {
    // The caller passes the keys its board already carries.
    const r = await call(makeRouter(), "/search/stub?q=al&have=stub:1");
    expect(r.body.results.map((x) => x.externalId)).toEqual(["2"]);
  });

  it("an EMPTY query returns an empty list and never calls the provider", async () => {
    // Every provider treats a "" search differently and none of them usefully.
    const r = await call(makeRouter(), "/search/stub?q=%20");
    expect(r.body.results).toEqual([]);
    expect(searchCalls).toHaveLength(0);
  });

  it("caps the limit so one keystroke cannot ask for a thousand rows", async () => {
    await call(makeRouter(), "/search/stub?q=a&limit=999");
    expect(searchCalls[0].opts.limit).toBe(20);
  });

  it("forwards location bias as NUMBERS, for the provider that can use it", async () => {
    // Measured live: unbiased, "Whole Foods" answers Los Gatos before Milwaukee
    // and "Central Park" surfaces a stadium in Scotland. The geocoder has taken
    // this pair since `0054`; only the adapter and the route dropped it.
    await call(makeRouter(), "/search/stub?q=a&lat=43.0389&lon=-87.9065");
    expect(searchCalls[0].opts.lat).toBe(43.0389);
    expect(searchCalls[0].opts.lon).toBe(-87.9065);
  });

  it("passes UNDEFINED when the caller does not know where the user is", async () => {
    // The discriminating case: `Number(undefined)` is NaN and `Number("")` is 0 —
    // and 0,0 is a real coordinate in the Gulf of Guinea. Either would bias every
    // unlocated search toward the wrong hemisphere instead of not biasing at all.
    await call(makeRouter(), "/search/stub?q=a");
    expect(searchCalls[0].opts.lat).toBeUndefined();
    await call(makeRouter(), "/search/stub?q=a&lat=&lon=");
    expect(searchCalls[1].opts.lat).toBeUndefined();
    expect(searchCalls[1].opts.lon).toBeUndefined();
  });

  it("404s an unknown provider rather than guessing one", async () => {
    const r = await call(makeRouter(), "/search/nope?q=a");
    expect(r.status).toBe(404);
  });

  it("reports a provider that THREW as 502, not 500 — it is upstream, not us", async () => {
    registerProvider({ id: "broken", label: "B", search: async () => { throw new Error("upstream is down"); } });
    const r = await call(makeRouter(), "/search/broken?q=a");
    expect(r.status).toBe(502);
    delete PROVIDERS.broken;
  });
});

describe("GET /search/:provider/detail", () => {
  it("returns the picked result's fields", async () => {
    const r = await call(makeRouter(), "/search/stub/detail?title=Alpha&externalId=1");
    expect(r.status).toBe(200);
    expect(r.body.result.fields).toEqual({ Director: "Someone" });
  });

  it("404s when the provider can make nothing of it", async () => {
    const r = await call(makeRouter(), "/search/stub/detail?title=Zeta&externalId=9");
    expect(r.status).toBe(404);
  });

  it("is not shadowed by the search route", async () => {
    // `/search/:provider` matches ONE segment, so a two-segment path must reach
    // the detail handler — worth pinning, because route order is invisible.
    const r = await call(makeRouter(), "/search/stub/detail?title=Alpha&externalId=1");
    expect(r.body.result).toBeTruthy();
  });
});

describe("GET /search/providers", () => {
  it("lists the keyless providers", async () => {
    const r = await call(makeRouter(), "/search/providers");
    expect(r.status).toBe(200);
    expect(r.body.providers.map((p) => p.id)).toContain("wikipedia");
  });

  it("is not swallowed by /search/:provider", async () => {
    const r = await call(makeRouter(), "/search/providers");
    expect(Array.isArray(r.body.providers)).toBe(true);
  });
});
