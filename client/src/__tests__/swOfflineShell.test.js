// @vitest-environment node
// public/sw.js's offline shell: page loads network-first with the last good page as fallback,
// hashed assets cache-first. Runs the REAL file in a simulated worker scope.
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

function fakeCaches() {
  const stores = new Map();
  const key = (k) => (typeof k === "string" ? k : new URL(k.url).pathname);
  return {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        put: async (k, res) => { m.set(key(k), res); },
        match: async (k) => { const r = m.get(key(k)); return r ? r.clone() : undefined; },
        delete: async (k) => m.delete(typeof k === "string" ? k : key(k)),
        keys: async () => [...m.keys()],
      };
    },
  };
}
function worker(fetchImpl, caches = fakeCaches()) {
  const listeners = {};
  const self = { location: { origin: "https://viafluere.com" }, addEventListener: (t, fn) => { listeners[t] = fn; }, skipWaiting() {}, clients: { claim: async () => {} } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8"),
    { self, caches, fetch: fetchImpl, Response, URL, encodeURIComponent, String, Math, Date });
  const run = async (request) => { let p = null; listeners.fetch({ request, respondWith: (x) => { p = x; } }); return p ? await p : null; };
  return { run, caches };
}
// A Request whose mode reads "navigate" (the constructor refuses to set it).
const nav = (u) => new Proxy(new Request(u), { get: (t, k) => (k === "mode" ? "navigate" : typeof t[k] === "function" ? t[k].bind(t) : t[k]) });
const html = (t) => new Response(`<html>${t}</html>`, { headers: { "content-type": "text/html" } });

describe("sw offline shell", () => {
  it("serves the network page online, and the last good page when offline", async () => {
    let online = true;
    const f = vi.fn(async () => { if (!online) throw new TypeError("offline"); return html("v1"); });
    const w = worker(f);
    expect(await (await w.run(nav("https://viafluere.com/"))).text()).toBe("<html>v1</html>");
    online = false;
    expect(await (await w.run(nav("https://viafluere.com/"))).text()).toBe("<html>v1</html>");
  });
  it("caches an asset on first fetch and serves it from cache after", async () => {
    const f = vi.fn(async () => new Response("js"));
    const w = worker(f);
    await w.run(new Request("https://viafluere.com/assets/app-abc.js"));
    expect(await (await w.run(new Request("https://viafluere.com/assets/app-abc.js"))).text()).toBe("js");
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("leaves files, uploads and the API to the network (control)", async () => {
    const w = worker(vi.fn());
    expect(await w.run(nav("https://viafluere.com/uploads/a.png"))).toBe(null);
    expect(await w.run(nav("https://viafluere.com/api/v1/grids"))).toBe(null);
    expect(await w.run(new Request("https://viafluere.com/api/v1/grids"))).toBe(null);
  });
  it("does not cache a failed page as the shell", async () => {
    let fail = false;
    const f = vi.fn(async () => (fail ? new Response("down", { status: 502, headers: { "content-type": "text/html" } }) : html("ok")));
    const w = worker(f);
    await w.run(nav("https://viafluere.com/"));
    fail = true;
    await w.run(nav("https://viafluere.com/"));
    const f2 = vi.fn(async () => { throw new TypeError("offline"); });
    // a new worker over the SAME caches, now offline, still has the good page
    const w2 = worker(f2, w.caches);
    expect(await (await w2.run(nav("https://viafluere.com/"))).text()).toBe("<html>ok</html>");
  });
});
