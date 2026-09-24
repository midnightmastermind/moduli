// Sharing from the phone / Windows (share plan 3): the service worker, the
// hand-off helpers, the pending page and the manifest.
//
// The service worker is the REAL public/sw.js, run in a simulated worker scope
// (a vm context with a fake Cache Storage) — a worker cannot be registered in a
// test, and an untested one is where a share would silently vanish.
// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {
  SHARE_CACHE, stashUrl, takeStashedShare, buildShareForm, partsFromForm,
  shareSourceFor, describeShareResult,
} from "../helpers/shareHandoff";

// A minimal Cache Storage: named caches holding Responses by URL path.
function fakeCaches() {
  const stores = new Map();
  const key = (k) => (typeof k === "string" ? k : new URL(k.url).pathname);
  return {
    stores,
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        put: async (k, res) => { m.set(key(k), res); },
        match: async (k) => { const r = m.get(key(k)); return r ? r.clone() : undefined; },
        delete: async (k) => m.delete(key(k)),
      };
    },
  };
}

// Load the REAL sw.js into a worker-like scope.
function loadWorker(caches) {
  const listeners = {};
  const self = {
    addEventListener: (t, fn) => { listeners[t] = fn; },
    skipWaiting: vi.fn(), clients: { claim: vi.fn(async () => {}) },
    crypto: { randomUUID: () => "stash-1" },
  };
  const src = fs.readFileSync(path.resolve(__dirname, "../../public/sw.js"), "utf8");
  vm.runInNewContext(src, { self, caches, Response, URL, encodeURIComponent, String, Math, Date });
  const fetchEvent = async (request) => {
    let responded = null;
    listeners.fetch({ request, respondWith: (p) => { responded = p; } });
    return responded ? await responded : null;
  };
  return { listeners, fetchEvent, src };
}

const shareForm = () => {
  const fd = new FormData();
  fd.append("title", "An article"); fd.append("url", "https://x.test/a");
  fd.append("files", new File(["BEGIN:VCALENDAR"], "invite.ics", { type: "text/calendar" }));
  return fd;
};

describe("public/sw.js", () => {
  let caches, sw;
  beforeEach(() => { caches = fakeCaches(); sw = loadWorker(caches); });

  it("stashes a share_target POST and redirects (303) to the pending page", async () => {
    const res = await sw.fetchEvent(new Request("https://viafluere.com/share-target", { method: "POST", body: shareForm() }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toMatch(/\/share-pending\?id=stash-1$/);
    // …and what it stashed is the ORIGINAL form, file included.
    const form = await takeStashedShare("stash-1", caches);
    expect(form.get("title")).toBe("An article");
    expect(await form.get("files").text()).toContain("VCALENDAR");
  });

  it("leaves every other request alone — no caching, no offline mode", async () => {
    expect(await sw.fetchEvent(new Request("https://viafluere.com/share-target"))).toBe(null);           // GET
    expect(await sw.fetchEvent(new Request("https://viafluere.com/api/v1/share", { method: "POST", body: "x" }))).toBe(null);
    expect(await sw.fetchEvent(new Request("https://viafluere.com/assets/app.js"))).toBe(null);
  });

  it("an unreadable share still ends on the pending page, with the reason (§12)", async () => {
    const bad = { method: "POST", url: "https://viafluere.com/share-target", formData: async () => { throw new Error("boom"); } };
    const res = await sw.fetchEvent(bad);
    expect(res.status).toBe(303);
    expect(decodeURIComponent(res.headers.get("location"))).toMatch(/error=.*boom/);
  });

  it("uses the SAME cache name and key as the page (they cannot import each other)", () => {
    expect(sw.src).toContain(`"${SHARE_CACHE}"`);
    expect(sw.src).toMatch(/`\/__share-stash\/\$\{encodeURIComponent\(id\)\}`/);
    expect(stashUrl("a b")).toBe("/__share-stash/a%20b");
  });
});

describe("takeStashedShare", () => {
  it("is consumed on read — a reload cannot post the share twice", async () => {
    const caches = fakeCaches();
    await (await caches.open(SHARE_CACHE)).put(stashUrl("s"), new Response(shareForm()));
    expect(await takeStashedShare("s", caches)).toBeTruthy();
    expect(await takeStashedShare("s", caches)).toBe(null);
  });
  it("an unknown id is null, not a throw", async () => {
    expect(await takeStashedShare("nope", fakeCaches())).toBe(null);
  });
});

describe("buildShareForm", () => {
  it("carries the OS's parts plus source and timezone", () => {
    const fd = buildShareForm(partsFromForm(shareForm()), { source: "android", timeZone: "America/Chicago" });
    expect(fd.get("title")).toBe("An article");
    expect(fd.get("url")).toBe("https://x.test/a");
    expect(fd.get("files").name).toBe("invite.ics");
    expect(fd.get("source")).toBe("android");
    expect(fd.get("timeZone")).toBe("America/Chicago");
  });
  it("drops empty fields rather than sending blanks", () => {
    const fd = buildShareForm({ title: " ", text: "hi" });
    expect(fd.get("title")).toBe(null);
    expect(fd.get("text")).toBe("hi");
  });
});

describe("shareSourceFor", () => {
  it("names the device", () => {
    expect(shareSourceFor("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
    expect(shareSourceFor("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/129")).toBe("windows");
  });
});

describe("describeShareResult — never looks like success when it was not (§12)", () => {
  it("a landed share names the count and the rule", () => {
    const r = describeShareResult(201, { label: "Dentist", ran: [{ ruleName: "Share: calendar (.ics)", ok: true, created: [{ occurrenceId: "a", status: "created" }] }] });
    expect(r.ok).toBe(true);
    expect(r.message).toBe("Filed 1 item via “Share: calendar (.ics)”.");
  });
  it("a shared FILE counts even when no rule created anything", () => {
    expect(describeShareResult(201, { fileOccurrenceId: "f", ran: [{ ok: true, created: [] }] }).ok).toBe(true);
  });
  it("a 2xx that wrote NOTHING is a failure", () => {
    expect(describeShareResult(201, { ran: [{ ok: true, created: [] }] }).ok).toBe(false);
  });
  it("signed out says so", () => {
    expect(describeShareResult(401, { error: "unauthorized" }).message).toMatch(/Sign in/);
  });
  it("passes calendar notices through", () => {
    const r = describeShareResult(201, { notices: ["recurrence not imported — first occurrence only"], ran: [{ ok: true, created: [{ occurrenceId: "a" }] }] });
    expect(r.notices).toHaveLength(1);
  });
});

describe("the manifest", () => {
  const m = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../public/manifest.json"), "utf8"));
  it("is a share target that POSTs multipart to the path the worker answers", () => {
    expect(m.share_target).toMatchObject({ action: "/share-target", method: "POST", enctype: "multipart/form-data" });
    expect(m.share_target.params.files[0].name).toBe("files");       // what partsFromForm reads
  });
  it("opens .ics files and webcal:// links on Windows", () => {
    expect(m.file_handlers[0].accept["text/calendar"]).toContain(".ics");
    expect(m.protocol_handlers[0]).toEqual({ protocol: "webcal", url: "/share-target?url=%s" });
  });
  it("main.jsx routes both share paths to the pending page and registers the worker", () => {
    const main = fs.readFileSync(path.resolve(__dirname, "../main.jsx"), "utf8");
    expect(main).toMatch(/"\/share-pending", "\/share-target"/);
    expect(main).toMatch(/serviceWorker\.register\("\/sw\.js"\)/);
  });
});
